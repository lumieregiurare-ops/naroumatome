// なろう系のニュースを集めて docs/data/news.json を作り、小説家になろうのランキングを
// docs/data/ranking.json に書く。記事本文は保存せず、見出し・要約の一部・元記事へのリンクだけを持つ。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, writeJson, idOf, hostOf, log, truncate } from "./lib/util.mjs";
import { fetchAll } from "./lib/sources.mjs";
import { enrichImages } from "./lib/enrich.mjs";
import { buildTopics } from "./lib/cluster.mjs";
import { updateArchive } from "./lib/archive.mjs";
import { updateNarou } from "./lib/novels.mjs";
import { renderPages } from "./lib/pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "data", "news.json");
const OTHER_OUT = join(ROOT, "docs", "data", "other.json");
const RUN = join(ROOT, "data", "last-run.json");
const STATE = join(ROOT, "data", "state.json");

const started = Date.now();
const config = await readJson(join(ROOT, "config.json"));
const now = new Date();
const nowIso = now.toISOString();

const WATCHDOG_MIN = config.watchdogMinutes ?? 15;
setTimeout(() => {
  console.error(`[watchdog] ${WATCHDOG_MIN} 分を超えたため中断します`);
  process.exit(2);
}, WATCHDOG_MIN * 60 * 1000).unref();

const works = config.works || [];
const workDefs = works.map((w) => ({ id: w.id, re: (w.keywords || []).map((k) => new RegExp(k, "i")) }));
const topicRe = (config.keywords || []).map((k) => new RegExp(k, "i"));
const strictRe = [/なろう/, ...workDefs.flatMap((w) => w.re)];
const cats = (config.categories || []).map((c) => ({ id: c.id, label: c.label, re: (c.keywords || []).map((k) => new RegExp(k, "i")) }));
const fallback = config.fallbackCategory || { id: "other", label: "その他" };
const blockRe = (config.blockTitlePatterns || []).map((k) => new RegExp(k));
const prRe = (config.prSources || []).map((s) => new RegExp(s, "i"));
const blockSourceRe = (config.blockSources || []).map((s) => new RegExp(s, "i"));

// 重複判定用に見出しを正規化する（全角英数を半角に、空白と末尾の媒体名を落とす）
function normTitle(t) {
  return t
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（(][^（()）]{2,12}[)）]\s*$/, "")
    .replace(/[\s　]+/g, "")
    .toLowerCase()
    .slice(0, 40);
}

// 要約が見出しの繰り返しになっている媒体があるので、その場合は要約を出さない
function cleanSummary(title, summary) {
  let s = summary || "";
  const bare = (x) => x.replace(/[\s　]+/g, "").slice(0, 40);
  if (s && bare(s).startsWith(bare(title))) {
    s = s.replace(/[\s　]+/g, " ").slice(title.length).replace(/^[\s　:：|｜ー-]+/, "");
  }
  if (bare(s) === bare(title) || s.length < 12) return "";
  return truncate(s, 160);
}

function isTopic(text, strict) {
  return (strict ? strictRe : [...topicRe, ...strictRe]).some((re) => re.test(text));
}

// どの作品の話かを見出しから見分ける（複数当たることもある）
function detectWorks(text) {
  return workDefs.filter((w) => w.re.some((re) => re.test(text))).map((w) => w.id);
}

function categorize(text) {
  const scored = cats
    .map((c) => ({ id: c.id, n: c.re.reduce((a, re) => a + (re.test(text) ? 1 : 0), 0) }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n);
  return scored.length ? scored.slice(0, 2).map((s) => s.id) : [fallback.id];
}

// ---------- 1. 収集 ----------
const { items: raw, stats: sourceStats } = await fetchAll(config);
log(`fetched ${raw.length} items`);

// ---------- 2. 絞り込み・整形・重複除去 ----------
const maxAge = (config.maxArticleAgeDays ?? 5) * 86400000;
const byId = new Map();
const otherById = new Map();
let dropped = { offTopic: 0, notJa: 0, tooOld: 0, dup: 0, noTitle: 0, blocked: 0 };
const JA_RE = /[぀-ゟ゠-ヿ一-鿿]/;

for (const r of raw) {
  if (!r.title || !/^https?:\/\//.test(r.url || "")) {
    dropped.noTitle++;
    continue;
  }
  if (r.publishedAt && now.getTime() - new Date(r.publishedAt).getTime() > maxAge) {
    dropped.tooOld++;
    continue;
  }
  if (blockRe.some((re) => re.test(r.title)) || blockSourceRe.some((re) => re.test(r.source || ""))) {
    dropped.blocked++;
    continue;
  }
  if (!r.always && !JA_RE.test(r.title)) {
    dropped.notJa++;
    continue;
  }
  const text = `${r.title} ${r.summary || ""}`;
  // アニメ・漫画の総合メディアも読んでいるので、なろう系に関係する記事だけを残す
  if (!r.always && !isTopic(text, r.strict)) {
    dropped.offTopic++;
    continue;
  }

  // 同じ記事が元フィードと Google ニュースの両方から来るので、見出しで重複を判定する
  const id = idOf(`t:${normTitle(r.title)}`);
  const prev = byId.get(id);
  const isPR = prRe.some((re) => re.test(r.source));

  if (prev) {
    dropped.dup++;
    if (r.url !== prev.url) {
      const oid = idOf(`u:${r.url}`);
      if (!otherById.has(oid)) {
        otherById.set(oid, {
          id: oid,
          title: truncate(r.title, 120),
          url: r.url,
          host: r.sourceHost || hostOf(r.url),
          source: r.source,
          publishedAt: r.publishedAt || nowIso,
          isPR,
        });
      }
    }
    if (prev.viaGoogle && !r.viaGoogle) {
      prev.url = r.url;
      prev.viaGoogle = false;
      prev.host = hostOf(r.url);
      prev.source = r.source;
      prev.isPR = isPR;
    }
    if (!prev.summary) prev.summary = cleanSummary(r.title, r.summary);
    if (!prev.image && r.image) prev.image = r.image;
    continue;
  }

  byId.set(id, {
    id,
    title: truncate(r.title, 120),
    url: r.url,
    host: r.sourceHost || hostOf(r.url),
    source: r.source,
    summary: cleanSummary(r.title, r.summary),
    publishedAt: r.publishedAt || nowIso,
    image: r.image || "",
    categories: categorize(text),
    // 作品の判定は見出しだけで行う（要約には関連作品の名前が並ぶことがあるため）
    works: detectWorks(r.title),
    isPR,
    viaGoogle: !!r.viaGoogle,
    sourceKind: r.sourceKind || "news",
  });
}

const items = [...byId.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
log(`kept ${items.length} (対象外 ${dropped.offTopic} / 古い ${dropped.tooOld} / 除外 ${dropped.blocked} / 重複 ${dropped.dup})`);

const primaryUrls = new Set(items.map((it) => it.url));
for (const [oid, it] of otherById) if (primaryUrls.has(it.url)) otherById.delete(oid);
const otherNews = [...otherById.values()]
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .slice(0, 300);
log(`other news (同一ニュースの別媒体記事): ${otherNews.length}`);

// ---------- 2.5 画像の補完 ----------
try {
  const enriched = await enrichImages(items);
  log(`images enriched: ${enriched}`);
} catch (e) {
  log("画像の補完に失敗:", e.message);
}

// ---------- 3. 同じ話題をまとめる ----------
let topics = [];
if (config.cluster?.enabled !== false) {
  const entities = [...(config.entities || []), ...works.map((w) => w.short).filter(Boolean)];
  topics = buildTopics(items, config.cluster, entities);
  log(`topics: ${topics.length}（最大 ${topics[0]?.sourceCount || 0} 媒体）`);
}

// ---------- 3.5 前回の収集と比べて、新着を見分ける ----------
const prev = (await readJson(STATE, { ranAt: "", ids: [] })) || { ranAt: "", ids: [] };
const prevIds = new Set(prev.ids || []);
for (const it of items) it.isNew = prevIds.size > 0 && !prevIds.has(it.id);
const churn = {
  previousAt: prev.ranAt || "",
  previousCount: prevIds.size,
  newCount: items.filter((i) => i.isNew).length,
};
// 次の更新の目安は、cron の設定値ではなく「実際に走った間隔の中央値」から出す
const RECENT_GAPS = 6;
const runs = [...(prev.runs || []), nowIso].slice(-24);
function medianGapMin(runList) {
  const ts = runList.map((t) => new Date(t).getTime()).filter((n) => n > 0);
  ts.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 60000);
  if (!gaps.length) return null;
  const recent = gaps.slice(-RECENT_GAPS).sort((a, b) => a - b);
  return Math.round(recent[Math.floor((recent.length - 1) / 2)]);
}
const updateGapMin = medianGapMin(runs);
const nextUpdateAt = updateGapMin ? new Date(now.getTime() + updateGapMin * 60000).toISOString() : "";

// ---------- 4. 保存 ----------
const catCounts = {};
for (const it of items) for (const c of it.categories) catCounts[c] = (catCounts[c] || 0) + 1;
const workCounts = {};
for (const it of items) for (const w of it.works || []) workCounts[w] = (workCounts[w] || 0) + 1;
const sourceCounts = {};
for (const it of items) sourceCounts[it.source] = (sourceCounts[it.source] || 0) + 1;

const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
await writeJson(OUT, {
  updatedAt: nowIso,
  site: config.site || {},
  total: items.length,
  todayCount: items.filter((i) => new Date(new Date(i.publishedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) === today).length,
  categories: [...cats.map((c) => ({ id: c.id, label: c.label })), fallback].map((c) => ({ ...c, count: catCounts[c.id] || 0 })),
  works: works.map((w) => ({ id: w.id, title: w.title, short: w.short || w.title, count: workCounts[w.id] || 0 })),
  sources: Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count })),
  topics,
  churn,
  updateGapMin,
  nextUpdateAt,
  items,
});

await writeJson(OTHER_OUT, {
  updatedAt: nowIso,
  site: config.site || {},
  total: otherNews.length,
  items: otherNews,
});

await writeJson(STATE, { ranAt: nowIso, runs, ids: items.map((i) => i.id) });

// ---------- 5. なろうのランキングと作品の情報 ----------
// ランキングは 1 日 1 回しか変わらないので、前回から日付が変わっていなければ API を呼ばない
if (config.narou?.enabled !== false) {
  try {
    await updateNarou(ROOT, config, now, { log });
  } catch (e) {
    log("なろうの情報の取得に失敗:", e.stack || e.message);
  }
}

// ---------- 6. 過去の記事を貯めて、検索エンジン向けのページを作り直す ----------
try {
  const n = await updateArchive(join(ROOT, "data", "archive"), items);
  log(`archive: ${n} day files updated`);
  await renderPages(ROOT, { log });
} catch (e) {
  log("ページの生成に失敗:", e.stack || e.message);
}

const summary = { ranAt: nowIso, durationSec: Math.round((Date.now() - started) / 1000), fetched: raw.length, kept: items.length, topics: topics.length, dropped, sources: sourceStats };
await writeJson(RUN, summary);
log(`done in ${summary.durationSec}s: ${items.length} articles, ${topics.length} topics`);
