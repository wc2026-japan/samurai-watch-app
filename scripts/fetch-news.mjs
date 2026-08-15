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
const TRANSFER_MAX_AGE_DAYS = 7;
const SCORE_WHEN = "3d";
const TRANSFER_WHEN = "7d";

// Roundup / evergreen / explainer articles rank well for generic queries
// but aren't the individual match/transfer news this app is meant to show.
// Titles matching these are filtered out.
const SUMMARY_TITLE_PATTERN = /まとめ|一覧|総括|振り返り|完全ガイド|特集|決定した移籍は|相次ぐ.*ニュース/;

function readConfig() {
  const raw = fs.readFileSync(path.join(dataDir, "config.json"), "utf-8");
  return JSON.parse(raw);
}

function googleNewsUrl(query, when) {
  const params = new URLSearchParams({ q: `${query} when:${when}`, hl: "ja", gl: "JP", ceid: "JP:ja" });
  return `https://news.google.com/rss/search?${params.toString()}`;
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
    .filter((item) => isFresh(item.pubDate, maxAgeDays))
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

async function main() {
  const config = readConfig();
  const now = new Date().toISOString();

  const [scores, transfers] = await Promise.all([
    fetchFeed(config.scoreQuery, SCORE_WHEN, SCORE_MAX_AGE_DAYS),
    fetchFeed(config.transferQuery, TRANSFER_WHEN, TRANSFER_MAX_AGE_DAYS),
  ]);

  // Failsafe: if a fetch genuinely comes back empty (e.g. a quiet news day,
  // or Google News hiccups), don't overwrite good existing data with an
  // empty list — keep what was there and just leave updatedAt as-is for
  // that feed.
  const existingScores = readExisting("scores.json");
  const existingTransfers = readExisting("transfers.json");

  const scoresOut = scores.length > 0
    ? { updatedAt: now, items: scores }
    : (existingScores || { updatedAt: now, items: [] });

  const transfersOut = transfers.length > 0
    ? { updatedAt: now, items: transfers }
    : (existingTransfers || { updatedAt: now, items: [] });

  fs.writeFileSync(
    path.join(dataDir, "scores.json"),
    JSON.stringify(scoresOut, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(dataDir, "transfers.json"),
    JSON.stringify(transfersOut, null, 2) + "\n"
  );

  console.log(`scores: ${scores.length} fresh item(s) fetched (kept ${scoresOut.items.length})`);
  console.log(`transfers: ${transfers.length} fresh item(s) fetched (kept ${transfersOut.items.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
