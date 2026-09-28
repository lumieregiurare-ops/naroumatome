// 小説家になろうの公式 API（なろう小説 API・なろう小説ランキング API）から、
// 作品の情報とランキングを取る。R18 作品は別の API なので含まれない。
// https://dev.syosetu.com/man/api/ ・ https://dev.syosetu.com/man/rankapi/
import { fetchJson, log } from "./util.mjs";

const NOVEL_API = "https://api.syosetu.com/novelapi/api/";
const RANK_API = "https://api.syosetu.com/rank/rankget/";
// t:タイトル n:Nコード w:作者 s:あらすじ bg:大ジャンル g:ジャンル k:キーワード gf:初回掲載 gl:最終掲載
// nt:連載/短編 e:完結 ga:話数 l:文字数 gp:総合ポイント f:ブックマーク数
const FIELDS = "t-n-w-s-bg-g-k-gf-gl-nt-e-ga-l-gp-f";

export const BIG_GENRES = { 1: "恋愛", 2: "ファンタジー", 3: "文芸", 4: "SF", 98: "ノンジャンル", 99: "その他" };
export const GENRES = {
  101: "異世界〔恋愛〕",
  102: "現実世界〔恋愛〕",
  201: "ハイファンタジー",
  202: "ローファンタジー",
  301: "純文学",
  302: "ヒューマンドラマ",
  303: "歴史",
  304: "推理",
  305: "ホラー",
  306: "アクション",
  307: "コメディー",
  401: "VRゲーム",
  402: "宇宙",
  403: "空想科学",
  404: "パニック",
  9801: "ノンジャンル",
  9901: "童話",
  9902: "詩",
  9903: "エッセイ",
  9904: "リプレイ",
  9999: "その他",
};

// なろうの日付は「2020-07-04 00:08:50」（日本時間）
function jstToIso(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "+09:00");
  return isNaN(d) ? "" : d.toISOString();
}

// あらすじは長いものがあるので、紹介として載せるのは冒頭だけにする
function storyExcerpt(s, n = 200) {
  const t = String(s || "").replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim();
  return t.length > n ? t.slice(0, n).replace(/\s+$/, "") + "…" : t;
}

function shape(n) {
  return {
    ncode: String(n.ncode || "").toLowerCase(),
    title: n.title || "",
    writer: n.writer || "",
    story: storyExcerpt(n.story),
    bigGenre: n.biggenre ?? null,
    genre: n.genre ?? null,
    keywords: String(n.keyword || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12),
    firstUp: jstToIso(n.general_firstup),
    lastUp: jstToIso(n.general_lastup),
    short: n.noveltype === 2,
    // end は「短編と完結済みが 0、連載中が 1」
    finished: n.end === 0,
    episodes: n.general_all_no ?? 0,
    length: n.length ?? 0,
    points: n.global_point ?? 0,
    bookmarks: n.fav_novel_cnt ?? 0,
  };
}

// ncode をまとめて引く（API は 1 回で 500 件まで。ncode はハイフンでつなぐ）
export async function fetchNovels(ncodes) {
  const out = new Map();
  const list = [...new Set(ncodes.map((c) => c.toLowerCase()))];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const url = `${NOVEL_API}?out=json&lim=${chunk.length}&of=${FIELDS}&ncode=${chunk.join("-")}`;
    const j = await fetchJson(url, { timeoutMs: 20000 });
    for (const n of j.slice(1)) {
      const s = shape(n);
      out.set(s.ncode, s);
    }
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

// ランキングの日付の決まり。日間は毎日、週間は火曜日、月間・四半期は 1 日の日付で出る。
// その日の分がまだ出ていない（朝の集計前）ときは、ひとつ前の回を使う。
function rankDates(type, now) {
  const j = new Date(now.getTime() + 9 * 3600000);
  const base = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
  const out = [];
  if (type === "d") {
    for (let i = 0; i < 3; i++) out.push(new Date(base.getTime() - i * 86400000));
  } else if (type === "w") {
    const back = (base.getUTCDay() - 2 + 7) % 7; // 直近の火曜日
    const tue = new Date(base.getTime() - back * 86400000);
    out.push(tue, new Date(tue.getTime() - 7 * 86400000));
  } else if (type === "m") {
    out.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)));
    out.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1)));
  } else if (type === "q") {
    out.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)));
    out.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1)));
  }
  return out;
}

export const RANK_TYPES = [
  { id: "d", label: "日間" },
  { id: "w", label: "週間" },
  { id: "m", label: "月間" },
  { id: "q", label: "四半期" },
];

async function fetchRank(type, now) {
  for (const d of rankDates(type, now)) {
    const rtype = `${ymd(d)}-${type}`;
    try {
      const j = await fetchJson(`${RANK_API}?out=json&rtype=${rtype}`, { timeoutMs: 20000 });
      if (Array.isArray(j) && j.length) {
        return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, list: j.map((r) => ({ ncode: String(r.ncode).toLowerCase(), pt: r.pt, rank: r.rank })) };
      }
    } catch (e) {
      log(`narou rank failed (${rtype}): ${e.message}`);
    }
  }
  return null;
}

// ランキング（上位 limit 件）と、その作品と登録作品の情報を取る
export async function fetchNarou({ limit = 30, extraNcodes = [] } = {}, now = new Date()) {
  const rankings = {};
  for (const t of RANK_TYPES) {
    const r = await fetchRank(t.id, now);
    if (r) rankings[t.id] = { label: t.label, date: r.date, list: r.list.slice(0, limit) };
  }
  const codes = [...extraNcodes, ...Object.values(rankings).flatMap((r) => r.list.map((x) => x.ncode))];
  const novels = codes.length ? await fetchNovels(codes) : new Map();
  return { rankings, novels };
}
