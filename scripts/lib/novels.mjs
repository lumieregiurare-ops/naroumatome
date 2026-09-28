// なろうのランキングと作品の情報を貯める。
//  - data/novels/<ncode>.json  作品ごとの情報（API の値と、ランキングに入った記録）
//  - docs/data/ranking.json    いまのランキング（トップの画面が読む）
// 作品ごとにファイルを分けているのは、書き換わるのをその日ランキングに入った作品だけにするため。
// ポイントは取るたびに変わるので、取りに行くのは 12 時間に 1 回にとどめる（リポジトリが膨らまないように）。
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJson } from "./util.mjs";
import { fetchNarou, RANK_TYPES } from "./narou.mjs";

const MIN_INTERVAL_H = 12;

export async function updateNarou(root, config, now, { log = () => {}, force = false } = {}) {
  const dir = join(root, "data", "novels");
  const statePath = join(root, "data", "narou-state.json");
  const state = (await readJson(statePath, {})) || {};
  if (!force && state.fetchedAt && now.getTime() - new Date(state.fetchedAt).getTime() < MIN_INTERVAL_H * 3600000) {
    log(`narou: 前回の取得から ${MIN_INTERVAL_H} 時間たっていないので取りに行かない`);
    return false;
  }

  const works = config.works || [];
  const workByNcode = new Map(works.filter((w) => w.ncode).map((w) => [w.ncode.toLowerCase(), w.id]));
  const { rankings, novels } = await fetchNarou({ limit: config.narou?.rankLimit ?? 30, extraNcodes: [...workByNcode.keys()] }, now);
  if (!Object.keys(rankings).length && !novels.size) {
    log("narou: ランキングも作品の情報も取れなかった");
    return false;
  }

  await mkdir(dir, { recursive: true });
  let written = 0;
  for (const [ncode, info] of novels) {
    const file = join(dir, `${ncode}.json`);
    const prevText = await readFile(file, "utf8").catch(() => "");
    const prev = prevText ? JSON.parse(prevText) : {};
    const ranks = { ...(prev.ranks || {}) };
    for (const [t, r] of Object.entries(rankings)) {
      const hit = r.list.find((x) => x.ncode === ncode);
      if (!hit) continue;
      const old = ranks[t] || {};
      ranks[t] = {
        best: Math.min(old.best || Infinity, hit.rank),
        bestDate: !old.best || hit.rank < old.best ? r.date : old.bestDate,
        last: hit.rank,
        lastDate: r.date,
      };
    }
    const next = { ...info, workId: workByNcode.get(ncode) || null, ranks, firstSeenAt: prev.firstSeenAt || now.toISOString(), fetchedAt: now.toISOString() };
    const text = JSON.stringify(next, null, 1);
    if (text !== prevText) {
      await writeFile(file, text, "utf8");
      written++;
    }
  }

  const out = { updatedAt: now.toISOString(), rankings: {} };
  for (const t of RANK_TYPES) {
    const r = rankings[t.id];
    if (!r) continue;
    out.rankings[t.id] = {
      label: r.label,
      date: r.date,
      list: r.list.map((x) => {
        const n = novels.get(x.ncode) || {};
        return {
          rank: x.rank,
          pt: x.pt,
          ncode: x.ncode,
          title: n.title || x.ncode,
          writer: n.writer || "",
          genre: n.genre ?? null,
          bigGenre: n.bigGenre ?? null,
          episodes: n.episodes ?? 0,
          finished: !!n.finished,
          short: !!n.short,
          workId: workByNcode.get(x.ncode) || null,
        };
      }),
    };
  }
  await writeJson(join(root, "docs", "data", "ranking.json"), out);
  await writeJson(statePath, { fetchedAt: now.toISOString(), dates: Object.fromEntries(Object.entries(rankings).map(([k, v]) => [k, v.date])) });
  log(`narou: ランキング ${Object.keys(rankings).length} 種・作品 ${novels.size} 件（書き換え ${written} 件）`);
  return true;
}

// 貯めた作品の情報をすべて読む（ncode → 情報）
export async function loadNovels(root) {
  const dir = join(root, "data", "novels");
  const map = new Map();
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return map;
  }
  for (const f of files.filter((x) => /^n[0-9a-z]+\.json$/.test(x))) {
    try {
      const n = JSON.parse(await readFile(join(dir, f), "utf8"));
      map.set(n.ncode, n);
    } catch {
      /* 壊れたファイルは飛ばす */
    }
  }
  return map;
}
