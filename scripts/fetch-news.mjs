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

function readConfig() {
  const raw = fs.readFileSync(path.join(dataDir, "config.json"), "utf-8");
  return JSON.parse(raw);
}

function googleNewsUrl(query) {
  const params = new URLSearchParams({ q: query, hl: "ja", gl: "JP", ceid: "JP:ja" });
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

async function fetchFeed(query, limit = 15) {
  const url = googleNewsUrl(query);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SamuraiWatchBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch feed for "${query}": HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseRssItems(text)
    .filter((item) => item.title && item.link)
    .slice(0, limit);
}

async function main() {
  const config = readConfig();
  const now = new Date().toISOString();

  const [scores, transfers] = await Promise.all([
    fetchFeed(config.scoreQuery),
    fetchFeed(config.transferQuery),
  ]);

  fs.writeFileSync(
    path.join(dataDir, "scores.json"),
    JSON.stringify({ updatedAt: now, items: scores }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(dataDir, "transfers.json"),
    JSON.stringify({ updatedAt: now, items: transfers }, null, 2) + "\n"
  );

  console.log(`Updated data/scores.json (${scores.length} items)`);
  console.log(`Updated data/transfers.json (${transfers.length} items)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
