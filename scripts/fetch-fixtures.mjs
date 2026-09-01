// scripts/fetch-fixtures.mjs
// Runs in GitHub Actions (Node 20+). Fetches real fixtures/results from
// football-data.org for the clubs our tracked overseas players belong to.
//
// Requires a FOOTBALL_DATA_API_KEY environment variable (free tier key
// from https://www.football-data.org/client/register).
//
// Run locally with:  FOOTBALL_DATA_API_KEY=xxxx node scripts/fetch-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

const API_BASE = "https://api.football-data.org/v4";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// football-data.org's free tier covers exactly these 12 competitions.
// Belgian Pro League, Danish Superliga, and Scottish Premiership are NOT
// included, so players at those clubs (谷口彰悟, 伊東純也, 鈴木淳之介,
// 旗手怜央 etc.) simply won't have fixture data — that's a real
// limitation of the free API, not a bug.
const FREE_COMPETITIONS = ["PL", "BL1", "FL1", "SA", "PD", "DED", "ELC"];

// Japanese club name (as written in players.json) -> English name/alias
// to match against football-data.org's team list. Only clubs in a
// FREE_COMPETITIONS league are worth listing here.
const CLUB_NAME_MAP = {
  "クリスタル・パレス": "Crystal Palace",
  "リバプールFC": "Liverpool",
  "リーズ・ユナイテッド": "Leeds United",
  "トッテナム・ホットスパー": "Tottenham",
  "イプスウィッチ・タウン": "Ipswich Town",
  "ブライトン": "Brighton",
  "ハル・シティ": "Hull City",
  "SCフライブルク": "Freiburg",
  "マインツ05": "Mainz 05",
  "ボルシアMG": "Borussia Mönchengladbach",
  "バイエルン・ミュンヘン": "Bayern München",
  "ヴェルダー・ブレーメン": "Werder Bremen",
  "VfLヴォルフスブルク": "Wolfsburg",
  "ホッフェンハイム": "Hoffenheim",
  "FCザンクトパウリ": "St. Pauli",
  "アイントラハト・フランクフルト": "Eintracht Frankfurt",
  "スタッド・ランス": "Reims",
  "ル・アーヴルAC": "Le Havre",
  "ASモナコ": "Monaco",
  "パルマ・カルチョ": "Parma",
  "アストン・ヴィラ": "Aston Villa",
  "レアル・ソシエダード": "Real Sociedad",
  "バレンシアCF": "Valencia",
  "アヤックス": "Ajax",
  "フェイエノールト": "Feyenoord",
  "NECナイメヘン": "NEC Nijmegen",
};

// Japanese player name -> expected romanized name as it's likely to
// appear in football-data.org's scorers list. Only players who actually
// rank among their league's top scorers will ever be matched — this
// dictionary just makes the match possible when they do; it never
// fabricates a stat for someone who isn't in the list.
const PLAYER_NAME_EN = {
  "鈴木 彩艶": "zion suzuki",
  "菅原 由勢": "yukinari sugawara",
  "谷口 彰悟": "shogo taniguchi",
  "板倉 滉": "ko itakura",
  "長友 佑都": "yuto nagatomo",
  "渡辺 剛": "go watanabe",
  "瀬古 歩夢": "ayumu seko",
  "伊藤 洋輝": "hiroki ito",
  "冨安 健洋": "takehiro tomiyasu",
  "鈴木 淳之介": "junnosuke suzuki",
  "遠藤 航": "wataru endo",
  "田中 碧": "ao tanaka",
  "久保 建英": "takefusa kubo",
  "堂安 律": "ritsu doan",
  "中村 敬斗": "keito nakamura",
  "伊東 純也": "junya ito",
  "鎌田 大地": "daichi kamada",
  "鈴木 唯人": "yuito suzuki",
  "佐野 海舟": "kaishu sano",
  "佐藤 龍之介": "ryunosuke sato",
  "山本 理仁": "rihito yamamoto",
  "藤田 譲瑠チマ": "joel chima fujita",
  "守田 英正": "hidemasa morita",
  "旗手 怜央": "reo hatate",
  "町野 修斗": "shuto machino",
  "後藤 啓介": "keisuke goto",
  "前田 大然": "daizen maeda",
  "上田 綺世": "ayase ueda",
  "小川 航基": "koki ogawa",
  "塩貝 健人": "kento shiogai",
  "三笘 薫": "kaoru mitoma",
  "南野 拓実": "takumi minamino",
  "水多 海斗": "kaito mizuta",
  "中村 草太": "sota nakamura",
  "高井 幸大": "kota takai",
  "安藤 智哉": "tomoya ando",
  "町田 浩樹": "hiroki machida",
};

function readPlayers() {
  try {
    const raw = fs.readFileSync(path.join(dataDir, "players.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Builds { clubNameJP: [playerName, ...] } for clubs that have a mapping
// above (i.e. clubs we can actually look up).
function buildTrackedClubs(playersData) {
  const clubs = {};
  if (!playersData) return clubs;
  for (const group of playersData.positions || []) {
    for (const p of group.players || []) {
      if (!CLUB_NAME_MAP[p.club]) continue;
      if (!clubs[p.club]) clubs[p.club] = [];
      clubs[p.club].push(p.name);
    }
  }
  return clubs;
}

// Flat list of every tracked player name (regardless of club mapping —
// stats matching only needs the name dictionary above, not the club
// lookup used for fixtures).
function listAllPlayerNames(playersData) {
  const names = [];
  if (!playersData) return names;
  for (const group of playersData.positions || []) {
    for (const p of group.players || []) {
      if (PLAYER_NAME_EN[p.name]) names.push(p.name);
    }
  }
  return names;
}

async function fetchScorers(competitionCode) {
  try {
    const data = await apiGet(`/competitions/${competitionCode}/scorers?limit=50`);
    return data.scorers || [];
  } catch (err) {
    console.error(`Failed to fetch scorers for ${competitionCode}: ${err.message}`);
    return [];
  }
}

// Matches our tracked players against every free competition's top-scorer
// list. A player who isn't among their league's leading scorers simply
// won't appear in the output — never filled in with a guessed/zero stat.
async function buildPlayerStats(playerNames) {
  const stats = {};
  const nameToJP = {};
  for (const jp of playerNames) {
    nameToJP[PLAYER_NAME_EN[jp]] = jp;
  }

  for (const code of FREE_COMPETITIONS) {
    const scorers = await fetchScorers(code);
    for (const entry of scorers) {
      const fullName = (entry.player?.name || "").toLowerCase();
      const jp = nameToJP[fullName];
      if (!jp) continue;
      stats[jp] = {
        goals: entry.goals ?? 0,
        assists: entry.assists ?? null,
        competition: entry.player?.name ? (COMPETITION_LABELS[code] || code) : code,
        club: entry.team?.name ? toJa(entry.team.name) : "",
      };
    }
    await sleep(6500); // stay under 10 req/min
  }
  return stats;
}

const COMPETITION_LABELS = {
  PL: "プレミアリーグ", BL1: "ブンデスリーガ", FL1: "リーグ・アン",
  SA: "セリエA", PD: "ラ・リーガ", DED: "エールディビジ", ELC: "EFLチャンピオンシップ",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (res.status === 429) {
    // Free tier is 10 req/min — back off and retry once.
    await sleep(15000);
    return apiGet(pathname);
  }
  if (!res.ok) {
    throw new Error(`football-data.org ${pathname} -> HTTP ${res.status}`);
  }
  return res.json();
}

// Fetches the team roster for every free competition and builds a single
// { normalizedName: teamId } lookup. Doing this instead of hardcoding team
// IDs means promotions/relegations between seasons don't silently break
// the mapping.
async function buildTeamIdLookup() {
  const lookup = []; // [{ id, names: [name, shortName, tla] }]
  for (const code of FREE_COMPETITIONS) {
    try {
      const data = await apiGet(`/competitions/${code}/teams`);
      for (const team of data.teams || []) {
        lookup.push({
          id: team.id,
          names: [team.name, team.shortName, team.tla].filter(Boolean).map((n) => n.toLowerCase()),
        });
      }
    } catch (err) {
      console.error(`Failed to fetch teams for competition ${code}: ${err.message}`);
    }
    await sleep(6500); // stay under 10 req/min
  }
  return lookup;
}

function findTeamId(lookup, searchName) {
  const needle = searchName.toLowerCase();
  const match = lookup.find((team) => team.names.some((n) => n.includes(needle) || needle.includes(n)));
  return match ? match.id : null;
}

function toJstIso(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchClubMatches(teamId) {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const data = await apiGet(`/teams/${teamId}/matches?dateFrom=${fmt(from)}&dateTo=${fmt(to)}`);
  return data.matches || [];
}

// Best-effort English -> Japanese katakana team name dictionary, covering
// the clubs most likely to appear as opponents across the 7 free-tier
// leagues. Anything not listed here is displayed in English rather than
// guessed — a wrong translation is worse than none.
const TEAM_NAME_JA = {
  // Premier League
  "Arsenal FC": "アーセナル", "Aston Villa FC": "アストン・ヴィラ", "AFC Bournemouth": "ボーンマス",
  "Brentford FC": "ブレントフォード", "Brighton & Hove Albion FC": "ブライトン", "Burnley FC": "バーンリー",
  "Chelsea FC": "チェルシー", "Crystal Palace FC": "クリスタル・パレス", "Everton FC": "エヴァートン",
  "Fulham FC": "フラム", "Leeds United FC": "リーズ・ユナイテッド", "Liverpool FC": "リヴァプール",
  "Manchester City FC": "マンチェスター・シティ", "Manchester United FC": "マンチェスター・ユナイテッド",
  "Newcastle United FC": "ニューカッスル・ユナイテッド", "Nottingham Forest FC": "ノッティンガム・フォレスト",
  "Sunderland AFC": "サンダーランド", "Tottenham Hotspur FC": "トッテナム・ホットスパー",
  "West Ham United FC": "ウェストハム・ユナイテッド", "Wolverhampton Wanderers FC": "ウルヴァーハンプトン",
  "Ipswich Town FC": "イプスウィッチ・タウン",
  // Bundesliga
  "FC Bayern München": "バイエルン・ミュンヘン", "Bayer 04 Leverkusen": "バイエル・レヴァークーゼン",
  "RB Leipzig": "RBライプツィヒ", "Borussia Dortmund": "ボルシア・ドルトムント",
  "Eintracht Frankfurt": "アイントラハト・フランクフルト", "VfB Stuttgart": "VfBシュトゥットガルト",
  "Sport-Club Freiburg": "SCフライブルク", "Borussia Mönchengladbach": "ボルシアMG",
  "1. FC Union Berlin": "ウニオン・ベルリン", "SV Werder Bremen": "ヴェルダー・ブレーメン",
  "VfL Wolfsburg": "VfLヴォルフスブルク", "1. FSV Mainz 05": "マインツ05",
  "TSG 1899 Hoffenheim": "ホッフェンハイム", "FC Augsburg": "アウクスブルク",
  "1. FC Köln": "FCケルン", "FC St. Pauli 1910": "FCザンクトパウリ",
  "Hamburger SV": "ハンブルガーSV", "1. FC Heidenheim 1846": "ハイデンハイム",
  // Ligue 1
  "Paris Saint-Germain FC": "パリ・サンジェルマン", "Olympique de Marseille": "マルセイユ",
  "AS Monaco FC": "ASモナコ", "LOSC Lille": "リール", "Olympique Lyonnais": "リヨン",
  "OGC Nice": "ニース", "Stade Rennais FC 1901": "レンヌ", "RC Lens": "ランス",
  "RC Strasbourg Alsace": "ストラスブール", "Toulouse FC": "トゥールーズ", "FC Nantes": "ナント",
  "Stade de Reims": "スタッド・ランス", "Le Havre AC": "ル・アーヴルAC", "Angers SCO": "アンジェ",
  "AJ Auxerre": "オセール", "Stade Brestois 29": "ブレスト", "FC Metz": "メス", "Paris FC": "パリFC",
  // Serie A
  "Juventus FC": "ユヴェントス", "FC Internazionale Milano": "インテル", "AC Milan": "ACミラン",
  "SSC Napoli": "ナポリ", "AS Roma": "ASローマ", "SS Lazio": "ラツィオ", "Atalanta BC": "アタランタ",
  "ACF Fiorentina": "フィオレンティーナ", "Bologna FC 1909": "ボローニャ", "Torino FC": "トリノ",
  "Udinese Calcio": "ウディネーゼ", "US Sassuolo Calcio": "サッスオーロ", "Genoa CFC": "ジェノア",
  "Cagliari Calcio": "カリアリ", "Hellas Verona FC": "エラス・ヴェローナ", "Parma Calcio 1913": "パルマ・カルチョ",
  "Como 1907": "コモ", "US Cremonese": "クレモネーゼ", "US Lecce": "レッチェ", "AC Pisa 1909": "ピサ",
  // La Liga
  "Real Madrid CF": "レアル・マドリード", "FC Barcelona": "バルセロナ", "Club Atlético de Madrid": "アトレティコ・マドリード",
  "Real Sociedad de Fútbol": "レアル・ソシエダード", "Athletic Club": "アスレティック・ビルバオ",
  "Villarreal CF": "ビジャレアル", "Real Betis Balompié": "レアル・ベティス", "Sevilla FC": "セビージャ",
  "Valencia CF": "バレンシアCF", "RC Celta de Vigo": "セルタ・デ・ビーゴ", "Getafe CF": "ヘタフェ",
  "CA Osasuna": "オサスナ", "Girona FC": "ジローナ", "RCD Mallorca": "マジョルカ",
  "Rayo Vallecano de Madrid": "ラージョ・バジェカーノ", "RCD Espanyol de Barcelona": "エスパニョール",
  "Deportivo Alavés": "アラベス", "Levante UD": "レバンテ", "Elche CF": "エルチェ", "Real Oviedo": "レアル・オビエド",
  // Eredivisie
  "AFC Ajax": "アヤックス", "PSV": "PSVアイントホーフェン", "Feyenoord Rotterdam": "フェイエノールト",
  "AZ": "AZアルクマール", "FC Twente '65": "FCトゥエンテ", "FC Utrecht": "FCユトレヒト",
  "Sparta Rotterdam": "スパルタ・ロッテルダム", "NEC": "NECナイメヘン", "Go Ahead Eagles": "ゴー・アヘッド・イーグルス",
  "Fortuna Sittard": "フォルトゥナ・シッタルド", "sc Heerenveen": "ヘーレンフェーン",
  "Willem II Tilburg": "ヴィレムII", "NAC Breda": "NACブレダ", "PEC Zwolle": "PECズウォレ",
  "Telstar 1963": "テルスター", "FC Volendam": "フォレンダム", "FC Groningen": "フローニンゲン",
  "SBV Excelsior": "エクセルシオール",
  // EFL Championship
  "Leicester City FC": "レスター・シティ", "Sheffield United FC": "シェフィールド・ユナイテッド",
  "West Bromwich Albion FC": "ウェストブロムウィッチ・アルビオン", "Middlesbrough FC": "ミドルズブラ",
  "Norwich City FC": "ノリッジ・シティ", "Coventry City FC": "コヴェントリー・シティ",
  "Hull City AFC": "ハル・シティ", "Swansea City AFC": "スウォンジー・シティ", "Bristol City FC": "ブリストル・シティ",
  "Preston North End FC": "プレストン・ノースエンド", "Millwall FC": "ミルウォール", "Cardiff City FC": "カーディフ・シティ",
  "Blackburn Rovers FC": "ブラックバーン・ローヴァーズ", "Watford FC": "ワトフォード",
  "Queens Park Rangers FC": "QPR", "Stoke City FC": "ストーク・シティ", "Portsmouth FC": "ポーツマス",
  "Oxford United FC": "オックスフォード・ユナイテッド", "Derby County FC": "ダービー・カウンティ",
  "Sheffield Wednesday FC": "シェフィールド・ウェンズデー", "Charlton Athletic FC": "チャールトン・アスレティック",
};

function toJa(englishName) {
  return TEAM_NAME_JA[englishName] || englishName;
}

function mapMatch(match, clubNameJP, players) {
  return {
    competition: match.competition?.name || "",
    homeTeam: toJa(match.homeTeam?.name || ""),
    awayTeam: toJa(match.awayTeam?.name || ""),
    homeScore: match.score?.fullTime?.home ?? null,
    awayScore: match.score?.fullTime?.away ?? null,
    status: match.status,
    utcDate: toJstIso(match.utcDate),
    clubJP: clubNameJP,
    players,
  };
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
  if (!API_KEY) {
    console.log("FOOTBALL_DATA_API_KEY is not set — skipping fixture fetch (this is expected until the secret is configured).");
    const existingFixtures = readExisting("fixtures.json");
    const outFixtures = existingFixtures || { updatedAt: new Date().toISOString(), schedule: [], results: [], unsupportedNote: "" };
    fs.writeFileSync(path.join(dataDir, "fixtures.json"), JSON.stringify(outFixtures, null, 2) + "\n");

    const existingStats = readExisting("stats.json");
    const outStats = existingStats || { updatedAt: new Date().toISOString(), players: {} };
    fs.writeFileSync(path.join(dataDir, "stats.json"), JSON.stringify(outStats, null, 2) + "\n");
    return;
  }

  const playersData = readPlayers();
  const trackedClubs = buildTrackedClubs(playersData);
  const clubNames = Object.keys(trackedClubs);
  console.log(`Tracking ${clubNames.length} clubs across free-tier-covered leagues.`);

  const teamLookup = await buildTeamIdLookup();

  const schedule = [];
  const results = [];

  for (const clubJP of clubNames) {
    const searchName = CLUB_NAME_MAP[clubJP];
    const teamId = findTeamId(teamLookup, searchName);
    if (!teamId) {
      console.log(`No football-data.org match found for ${clubJP} (${searchName}) — skipping.`);
      continue;
    }
    try {
      const matches = await fetchClubMatches(teamId);
      for (const m of matches) {
        const mapped = mapMatch(m, clubJP, trackedClubs[clubJP]);
        if (m.status === "FINISHED") results.push(mapped);
        else if (["SCHEDULED", "TIMED", "POSTPONED"].includes(m.status)) schedule.push(mapped);
      }
    } catch (err) {
      console.error(`Failed to fetch matches for ${clubJP} (team ${teamId}): ${err.message}`);
    }
    await sleep(6500); // stay under 10 req/min
  }

  schedule.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  results.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

  const out = {
    updatedAt: new Date().toISOString(),
    schedule: schedule.slice(0, 40),
    results: results.slice(0, 40),
    unsupportedNote: "ベルギー1部リーグ・デンマークスーペルリーガ・スコティッシュプレミアシップ所属選手の試合は、現在のデータソースでは対応していません。",
  };

  fs.writeFileSync(path.join(dataDir, "fixtures.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${out.schedule.length} upcoming and ${out.results.length} recent matches.`);

  const statsPlayerNames = listAllPlayerNames(playersData);
  const playerStats = await buildPlayerStats(statsPlayerNames);
  const statsOut = { updatedAt: new Date().toISOString(), players: playerStats };
  fs.writeFileSync(path.join(dataDir, "stats.json"), JSON.stringify(statsOut, null, 2) + "\n");
  console.log(`Wrote stats for ${Object.keys(playerStats).length} player(s) who rank among their league's top scorers.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
