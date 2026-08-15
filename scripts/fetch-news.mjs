// scripts/fetch-news.mjs
// Runs in GitHub Actions (Node 20+). Fetches RSS server-side (no browser CORS
// restrictions apply here) and writes the results to data/*.json.
//
// Run locally with:  node scripts/fetch-news.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

// Scores/match reports go stale fast, so they're kept tight. Transfer news
// stays meaningfully "current" for longer, so it gets a wider window.
const SCORE_MAX_AGE_DAYS = 3;
const TRANSFER_MAX_AGE_DAYS = 30;
const SCORE_WHEN = "3d";
const TRANSFER_WHEN = "30d";
const ARTICLES_LIMIT = 20;

// Roundup / evergreen / explainer articles rank well for generic queries
// but aren't the individual match/transfer news this app is meant to show.
// Titles matching these are filtered out.
const SUMMARY_TITLE_PATTERN = /まとめ|一覧|総括|振り返り|完全ガイド|特集|決定した移籍は|相次ぐ.*ニュース/;

// This app is specifically about 海外組 (Japanese players based overseas).
// Domestic J-League match reports sometimes slip through the broad search
// query, so they're filtered out here as a safety net regardless of what
// the query itself returns.
const DOMESTIC_LEAGUE_PATTERN = /J1リーグ|J2リーグ|J3リーグ|Ｊ1リーグ|Ｊ2リーグ|Ｊ3リーグ|Jリーグ|Ｊリーグ|天皇杯|ルヴァンカップ/;

function readConfig() {
  const raw = fs.readFileSync(path.join(dataDir, "config.json"), "utf-8");
  return JSON.parse(raw);
}

function googleNewsUrl(query, when) {
  const params = new URLSearchParams({ q: `${query} when:${when}`, hl: "ja", gl: "JP", ceid: "JP:ja" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function noteRssUrl(user) {
  return `https://note.com/${encodeURIComponent(user)}/rss`;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";
  let content = match[1].trim();
  const cdata = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) content = cdata[1];
  return decodeEntities(content).trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, "").trim();
}

function parseRssItems(xmlText) {
  const blocks = xmlText.split(/<item[\s>]/i).slice(1);
  return blocks.map((block) => {
    const itemXml = block.split(/<\/item>/i)[0];
    return {
      title: extractTag(itemXml, "title"),
      link: extractTag(itemXml, "link"),
      pubDate: extractTag(itemXml, "pubDate"),
      description: stripHtml(extractTag(itemXml, "description")).slice(0, 160),
      source: extractTag(itemXml, "source") || "Google News",
    };
  });
}

function isFresh(pubDateStr, maxAgeDays) {
  const d = new Date(pubDateStr);
  if (isNaN(d.getTime())) return false;
  const ageMs = Date.now() - d.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Reject anything older than maxAgeDays, and reject anything from the
  // future (clock skew / bad parse) beyond a small tolerance.
  return ageDays >= -0.5 && ageDays <= maxAgeDays;
}

async function fetchFeed(query, when, maxAgeDays, limit = 15) {
  const url = googleNewsUrl(query, when);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SamuraiWatchBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch feed for "${query}": HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseRssItems(text)
    .filter((item) => item.title && item.link)
    .filter((item) => !SUMMARY_TITLE_PATTERN.test(item.title))
    .filter((item) => !DOMESTIC_LEAGUE_PATTERN.test(item.title))
    .filter((item) => isFresh(item.pubDate, maxAgeDays))
    .slice(0, limit);
}

async function fetchNoteArticles(user, limit = ARTICLES_LIMIT) {
  if (!user) return [];
  const url = noteRssUrl(user);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SamuraiWatchBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch note.com feed for "${user}": HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseRssItems(text)
    .filter((item) => item.title && item.link)
    .map((item) => ({ ...item, source: item.source === "Google News" ? "note.com" : item.source }))
    .slice(0, limit);
}

function readExisting(fileName) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, fileName), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeWithFailsafe(fileName, freshItems, now) {
  const existing = readExisting(fileName);
  const out = freshItems.length > 0
    ? { updatedAt: now, items: freshItems }
    : (existing || { updatedAt: now, items: [] });
  fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(out, null, 2) + "\n");
  return out;
}

async function main() {
  const config = readConfig();
  const now = new Date().toISOString();

  const [scores, transfers, articles] = await Promise.all([
    fetchFeed(config.scoreQuery, SCORE_WHEN, SCORE_MAX_AGE_DAYS),
    fetchFeed(config.transferQuery, TRANSFER_WHEN, TRANSFER_MAX_AGE_DAYS),
    fetchNoteArticles(config.noteUser),
  ]);

  // Failsafe: if a fetch genuinely comes back empty (e.g. a quiet news day,
  // or a feed hiccup), don't overwrite good existing data with an empty
  // list — keep what was there.
  const scoresOut = writeWithFailsafe("scores.json", scores, now);
  const transfersOut = writeWithFailsafe("transfers.json", transfers, now);
  const articlesOut = writeWithFailsafe("articles.json", articles, now);

  console.log(`scores: ${scores.length} fresh item(s) fetched (kept ${scoresOut.items.length})`);
  console.log(`transfers: ${transfers.length} fresh item(s) fetched (kept ${transfersOut.items.length})`);
  console.log(`articles: ${articles.length} fresh item(s) fetched (kept ${articlesOut.items.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
