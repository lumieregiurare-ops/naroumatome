// 一度だけ使う: git の履歴に残っている data/novels/<ncode>.json の過去の値から、
// 作品ごとの history（日ごとのポイント・ブックマーク・話数）を作り直す。
//   node scripts/backfill-history.mjs
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addHistory, novelText } from "./lib/novels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const jstDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);

for (const w of config.works || []) {
  if (!w.ncode) continue;
  const rel = `data/novels/${w.ncode.toLowerCase()}.json`;
  let cur;
  try {
    cur = JSON.parse(await readFile(join(ROOT, rel), "utf8"));
  } catch {
    continue;
  }
  let history = [];
  const commits = git("log", "--reverse", "--format=%H", "--", rel).trim().split("\n").filter(Boolean);
  for (const c of commits) {
    try {
      const n = JSON.parse(git("show", `${c}:${rel}`));
      if (n.fetchedAt) history = addHistory(history, jstDay(n.fetchedAt), n);
    } catch {
      /* その時点では無い・壊れている */
    }
  }
  if (cur.fetchedAt) history = addHistory(history, jstDay(cur.fetchedAt), cur);
  for (const x of cur.history || []) if (!history.some((y) => y[0] === x[0])) history.push(x);
  history.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  cur.history = history;
  await writeFile(join(ROOT, rel), novelText(cur), "utf8");
  console.log(`${w.id}: ${history.length} 日分`);
}
