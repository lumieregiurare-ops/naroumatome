// 作品ページに出す画像と YouTube の PV を探す。
// その作品のニュース記事（手元の記事と、Google ニュースで「作品名 PV」を検索した記事）を開き、
// 記事の og:image と、記事に埋め込まれている YouTube の動画を拾う。
// 動画は YouTube の oEmbed で確かめ、埋め込みが許可されていて、動画名に作品名と
// PV・予告などの語が入っているものだけを使う。結果は data/works-media.json に残す。
import { join } from "node:path";
import { fetchText, readJson, writeJson, log as defaultLog } from "./util.mjs";
import { ogImage, resolveGoogleNewsUrl } from "./enrich.mjs";
import { fetchGoogleNews } from "./sources.mjs";
import { loadArchive } from "./archive.mjs";

const RECHECK_DAYS = 3;
const YT_RE = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
// 動画名の点数。アニメの PV・予告を優先し、OP 映像や CM は PV が無いときだけ使う。
// 同じ作品名でもぱちんこ・スマホゲームの PV が出てくるので、アニメの動画だと読めないものは使わない
const ANIME_RE = /アニメ|劇場版|放送|ON AIR|第\d+期|Season|クール|第\d+話/i;
const ANIME_CH = /anime|アニメ|pictures|film|aniplex|アニプレックス|toho|kadokawa|pony|ぽにきゃん|avex|mappa|東映|frontier|overlap|オーバーラップ|nbcuniversal|showgate|dmm/i;
const NOT_ANIME = /ぱちんこ|パチンコ|パチスロ|スロット|製品PV|新作ゲーム|ゲーム化|事前登録|ブラウザゲーム|スマホゲーム|アプリ/;
function videoScore(title, channel) {
  if (NOT_ANIME.test(title) || /ぱちんこ|パチンコ|スロット|G123/i.test(channel)) return 0;
  if (!ANIME_RE.test(title) && !ANIME_CH.test(channel)) return 0;
  if (/PV|ティザー|トレーラー|trailer/i.test(title)) return 4;
  if (/予告/.test(title)) return 3;
  if (/ノンクレジット|OP|ED|オープニング|エンディング/i.test(title)) return 2;
  if (/CM|映像/.test(title)) return 1;
  return 0;
}
// サイト共通のロゴなど、作品の画像ではないものを弾く
const BAD_IMAGE = /logo|noimage|no_image|default|common\/|ogp\.png$|og-?image\.png$|favicon/i;
// 記事の見出しから、画像が作品の絵（キービジュアル・PV・書影）か、声優などの写真かを見当づける。
// 声優の出演・イベントの記事の画像は人物写真で、作品の画像に見えないので使わない
export function imageScore(title) {
  if (/声優|キャスト(が|の)|登壇|イベント|レポート|インタビュー|ステージ|生放送|配信番組|挑戦|対談|舞台挨拶|握手|サイン会|コスプレ|実写|料理|たこ焼|オーディオドラマ|ドラマCD|朗読|ラジオ/.test(title)) return -1;
  let score = 1;
  if (/キービジュアル|ビジュアル|KV|ティザー|PV|アニメ化|放送決定|放送開始|制作決定/.test(title)) score = 3;
  else if (/書影|表紙|コミカライズ|単行本|最新刊|\d+巻/.test(title)) score = 2;
  // ゲーム版の絵はアニメ・原作の絵より後にする
  if (/ゲーム|事前登録|G123|スマホ|アプリ/.test(title)) score = Math.min(score, 1);
  return score;
}

async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; // 401 は埋め込み不可、404 は非公開・削除
    const j = await r.json();
    return { title: j.title || "", channel: j.author_name || "" };
  } catch {
    return null;
  }
}

function plainKeyword(k) {
  return k.replace(/\(\?[!=][^)]*\)|\[[^\]]*\]|[\\^$.*+?()|{}]/g, "").trim();
}

async function scanWork(w, articles, { timeoutMs = 8000, budgetEnd }) {
  const kw = (w.keywords || []).map((k) => new RegExp(k, "i"));
  const images = [];
  const videos = new Map();
  for (const a of articles) {
    if (Date.now() > budgetEnd) break;
    if (!kw.some((re) => re.test(a.title))) continue;
    try {
      let url = a.url;
      if (a.viaGoogle) {
        url = await resolveGoogleNewsUrl(url, timeoutMs);
        if (!url) continue;
      }
      const html = await fetchText(url, { timeoutMs });
      const img = a.image || ogImage(html);
      const score = imageScore(a.title);
      if (img && score > 0 && !BAD_IMAGE.test(img) && !images.some((x) => x.url === img)) images.push({ url: img, from: url, title: a.title, score, at: a.publishedAt || "" });
      for (const m of html.matchAll(YT_RE)) if (!videos.has(m[1])) videos.set(m[1], a.publishedAt || "");
    } catch {
      /* 開けない記事は飛ばす */
    }
    if (images.length >= 6 && videos.size >= 10) break;
  }
  let pv = null;
  for (const [id, at] of [...videos].slice(0, 16)) {
    const o = await oembed(id);
    if (!o || !kw.some((re) => re.test(o.title))) continue;
    const score = videoScore(o.title, o.channel);
    if (!score) continue;
    if (!pv || score > pv.score || (score === pv.score && at > pv.at)) pv = { id, title: o.title, channel: o.channel, score, at };
  }
  // 作品の絵らしいものを先に、同じ点なら新しいものを先に
  images.sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1));
  return { images: images.slice(0, 4), pv };
}

// 前に調べてから RECHECK_DAYS 日たった作品を、古いものから maxWorks 件だけ調べ直す
export async function updateWorkMedia(root, config, now = new Date(), { log = defaultLog, maxWorks = 6, budgetMs = 90000 } = {}) {
  const path = join(root, "data", "works-media.json");
  const media = (await readJson(path, {})) || {};
  const works = config.works || [];
  const due = works
    .filter((w) => !media[w.id]?.checkedAt || now.getTime() - new Date(media[w.id].checkedAt).getTime() > RECHECK_DAYS * 86400000)
    .sort((a, b) => (media[a.id]?.checkedAt || "").localeCompare(media[b.id]?.checkedAt || ""))
    .slice(0, maxWorks);
  if (!due.length) return 0;

  const archive = await loadArchive(join(root, "data", "archive"));
  const all = archive.flatMap((d) => d.items);
  const budgetEnd = Date.now() + budgetMs;
  let done = 0;
  for (const w of due) {
    if (Date.now() > budgetEnd) break;
    // 手元の記事は PV・映像の記事を先に
    const own = all
      .filter((it) => (it.works || []).includes(w.id))
      .sort((a, b) => (/PV|映像|予告|ビジュアル/.test(b.title) ? 1 : 0) - (/PV|映像|予告|ビジュアル/.test(a.title) ? 1 : 0) || (a.publishedAt < b.publishedAt ? 1 : -1))
      .slice(0, 6);
    let searched = [];
    const base = plainKeyword(w.keywords?.[0] || w.title);
    for (const q of [`${base} アニメ PV`, `${base} PV`]) {
      try {
        searched.push(...(await fetchGoogleNews(q, { within: "", perQuery: 8 })));
      } catch (e) {
        log(`work media: 検索に失敗 (${w.id}): ${e.message}`);
      }
    }
    searched = searched.filter((a, i) => searched.findIndex((b) => b.title === a.title) === i);
    const r = await scanWork(w, [...own, ...searched], { budgetEnd });
    const prev = media[w.id] || {};
    media[w.id] = {
      // 見つからなかったときは前回の結果を残す
      images: r.images.length ? r.images : (prev.images || []).filter((x) => x.score > 0),
      pv: r.pv ? { id: r.pv.id, title: r.pv.title, channel: r.pv.channel } : prev.pv || null,
      checkedAt: now.toISOString(),
    };
    done++;
  }
  await writeJson(path, media);
  log(`work media: ${done} 作品を調べた（PV あり ${Object.values(media).filter((m) => m.pv).length} / 画像あり ${Object.values(media).filter((m) => m.images?.length).length}）`);
  return done;
}
