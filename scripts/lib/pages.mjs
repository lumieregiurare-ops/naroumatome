// 検索エンジン向けの静的ページを docs/ に書き出す。収集（collect.mjs）とビルド（build.mjs）の最後に呼ぶ。
// トップの画面は app.js が news.json を読んで描くが、それだけだと検索エンジンからは中身が
// 見えないので、記事の一覧を HTML にも書いておく（app.js が描き直す）。
// あわせて、作品ページ・なろうランキング・ランキング作品のページ・ジャンル別・日別の過去ニュースのページと、
// sitemap.xml・feed.xml・コメント API が使う作品の一覧（data/works-index.json）を作る。
// Node の標準機能だけで動く（GitHub Actions の収集で npm ci しないため）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { loadArchive, jstDay } from "./archive.mjs";
import { loadNovels } from "./novels.mjs";
import { GENRES, BIG_GENRES, RANK_TYPES } from "./narou.mjs";
import { readJson } from "./util.mjs";
import { imageScore } from "./workmedia.mjs";

export function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const LIST_MAX = 60;
// 画像が読み込めないとき。data-fb（PV のサムネイル）があればそれに替え、無ければ作品名の札にする
const IMG_ONERROR = "var f=this.getAttribute('data-fb');if(f){this.removeAttribute('data-fb');this.src=f}else{this.parentNode.classList.add('noimg');this.remove()}";
// ページの先頭へ戻るボタン（少しスクロールしたら出す）
const TOTOP = `<button type="button" class="to-top" id="toTop" aria-label="ページの先頭へ" hidden>▲</button><script>(function(){var b=document.getElementById("toTop");addEventListener("scroll",function(){b.hidden=scrollY<400},{passive:true});b.onclick=function(){scrollTo({top:0,behavior:"smooth"})}})()</script>`;
const LIST_DAYS = 180;
const MIN_INDEXABLE = 3;

// ---------- 小物 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function jst(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000);
}
const pad = (n) => String(n).padStart(2, "0");
function hhmm(iso) {
  const d = jst(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function dayParts(day) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d, wd: WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
const mdw = (day) => {
  const p = dayParts(day);
  return `${p.m}/${p.d}（${p.wd}）`;
};
const jpDay = (day) => {
  const p = dayParts(day);
  return `${p.y}年${p.m}月${p.d}日（${p.wd}）`;
};
const jpDate = (iso) => {
  const p = dayParts(jstDay(iso));
  return `${p.y}年${p.m}月${p.d}日`;
};
function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
const num = (n) => Number(n || 0).toLocaleString("ja-JP");
function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}
async function readText(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}
async function verOf(p) {
  const t = (await readText(p)).replace(/\r\n/g, "\n");
  return t ? createHash("sha1").update(t).digest("hex").slice(0, 8) : "0";
}
const narouUrl = (ncode) => `https://ncode.syosetu.com/${ncode}/`;

// 画像が無い記事のための札（ジャンルの頭文字を置くだけ）
const CAT_INK = { anime: "#e4007f", comic: "#0091db", book: "#1b9e3e", web: "#f08c00", game: "#7b3fa0", goods: "#d9302c", other: "#777777" };
function thumb(it, cls, catLabel) {
  if (it.image) {
    return `<div class="${cls}"><img src="${esc(it.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('thumb-ph');this.remove()"></div>`;
  }
  const c = (it.categories || [])[0] || "other";
  return `<div class="${cls} thumb-ph" style="--tint:${CAT_INK[c] || CAT_INK.other}"><span>${esc((catLabel(c) || "話題").slice(0, 2))}</span></div>`;
}

// ---------- 本体 ----------
export async function renderPages(root, { log = () => {} } = {}) {
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const DOCS = join(root, "docs");
  const SITE = config.site?.title || "なろう系まとめ";
  const BASE = (config.site?.url || "/").replace(/\/?$/, "/");
  const abs = (path) => BASE + path.replace(/^\//, "");
  const now = new Date();
  const year = jst(now.toISOString()).getUTCFullYear();

  let news = null;
  try {
    news = JSON.parse(await readFile(join(DOCS, "data", "news.json"), "utf8"));
  } catch {
    /* まだ収集していない */
  }
  let ranking = null;
  try {
    ranking = JSON.parse(await readFile(join(DOCS, "data", "ranking.json"), "utf8"));
  } catch {
    /* まだ取っていない */
  }
  const archive = await loadArchive(join(root, "data", "archive"));
  const novels = await loadNovels(root);
  const indexTpl = await readText(join(root, "site", "index.html"));
  const GA = (indexTpl.match(/gtag\/js\?id=(G-[A-Z0-9]+)/) || [])[1] || "";
  const ver = {
    css: await verOf(join(DOCS, "assets", "app.css")),
    app: await verOf(join(DOCS, "assets", "app.js")),
    comments: await verOf(join(DOCS, "assets", "comments.js")),
    ranking: await verOf(join(DOCS, "assets", "ranking.js")),
  };

  const cats = (config.categories || []).map((c) => ({ ...c, ...(config.pages?.genres?.[c.id] || {}) }));
  const catLabel = (id) => cats.find((c) => c.id === id)?.label || "";
  const works = (config.works || []).map((w) => ({ ...w, novel: w.ncode ? novels.get(w.ncode.toLowerCase()) : null }));
  const workOf = (id) => works.find((w) => w.id === id);
  const workByNcode = new Map(works.filter((w) => w.ncode).map((w) => [w.ncode.toLowerCase(), w]));

  // 過去の記事をひとつの列にする（新しい順・同じ記事は 1 回だけ）
  const seen = new Set();
  const all = [];
  for (const d of archive)
    for (const it of d.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      all.push(it);
    }
  all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const recentLimit = now.getTime() - LIST_DAYS * 86400000;
  const recent = all.filter((it) => new Date(it.publishedAt).getTime() >= recentLimit);

  const written = [];
  const sitemap = [];
  async function out(path, html, { lastmod, index = true } = {}) {
    const file = path.endsWith("/") ? join(DOCS, path, "index.html") : join(DOCS, path);
    const text = /\.(xml|json)$/.test(path) ? html : minifyHtml(html);
    if ((await readText(file)).replace(/\r\n/g, "\n") !== text) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
      written.push(path);
    }
    if (index) sitemap.push({ loc: abs(path), lastmod });
  }

  // ---------- 共通の部品 ----------
  const genreLinks = cats.filter((c) => config.pages?.genres?.[c.id]);
  function navHtml() {
    const links = [["/works/", "作品一覧"], ["/ranking/", "なろうランキング"], ...genreLinks.map((c) => [`/${c.id}/`, c.label]), ["/archive/", "過去のニュース"]];
    return `<nav class="site-nav" aria-label="ページ"><div class="wrap nav-inner">${links.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("")}</div></nav>`;
  }
  function footerLinks() {
    const sisters = (config.sisterSites || [])
      .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>`)
      .join("");
    return `<nav class="footer-nav" aria-label="サイト内のページ">
      <a href="/">トップ</a><a href="/works/">作品一覧</a><a href="/ranking/">なろうランキング</a>
      ${genreLinks.map((c) => `<a href="/${c.id}/">${esc(c.title || c.label)}</a>`).join("")}
      <a href="/archive/">過去のニュース</a><a href="/about/">このサイトについて</a><a href="/feed.xml">RSS</a>
    </nav>
    ${sisters ? `<nav class="footer-nav footer-sisters" aria-label="運営サイト"><span class="footer-nav-label">運営サイト</span>${sisters}</nav>` : ""}
    ${config.site?.contactUrl ? `<p class="contact"><a href="${esc(config.site.contactUrl)}" target="_blank" rel="noopener noreferrer">お問い合わせはこちら</a></p>` : ""}`;
  }
  const verify = config.pages?.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(config.pages.googleSiteVerification)}">` : "";
  const gtag = GA
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA}');</script>`
    : "";
  const logoHtml = `<a class="logo" href="/">なろう系<span>まとめ</span></a>`;

  function page({ path, title, desc, h1, lead = "", body, crumbs = [], jsonld = [], noindex = false, side = true, scripts = [], ogType = "website", h1Html = "" }) {
    const fullTitle = `${title}｜${SITE}`;
    const trail = [{ name: SITE, path: "/" }, ...crumbs];
    const bc =
      crumbs.length > 0
        ? {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })),
          }
        : null;
    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${gtag}
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="${noindex ? "noindex, follow" : "max-image-preview:large"}">
  ${verify}
  <meta name="theme-color" content="#2c6fbb">
  ${path === "/404.html" ? "" : `<link rel="canonical" href="${abs(path)}">`}
  <meta property="og:site_name" content="${esc(SITE)}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${abs(path)}">
  <meta property="og:image" content="${abs("/assets/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(fullTitle)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${abs("/assets/og.png")}">
  <link rel="alternate" type="application/atom+xml" title="${esc(SITE)}" href="/feed.xml">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ${bc ? ld(bc) : ""}
  ${jsonld.map(ld).join("")}
  <link rel="stylesheet" href="/assets/app.css?v=${ver.css}">
</head>
<body>
  <header class="header">
    <div class="wrap header-inner">
      ${logoHtml}
      <p class="tagline">なろう系作品のアニメ・漫画・書籍ニュース</p>
    </div>
    ${navHtml()}
  </header>
  <main class="wrap">
    ${
      crumbs.length
        ? `<nav class="crumbs" aria-label="パンくずリスト"><ol>${trail
            .map((c, i) => (i === trail.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`))
            .join("")}</ol></nav>`
        : ""
    }
    <div class="layout${side ? "" : " layout-single"}">
      <div class="col-main">
        <div class="page-intro">
          <h1 class="page-title">${h1Html || esc(h1)}</h1>
          ${lead ? `<p class="page-lead">${lead}</p>` : ""}
        </div>
        ${body}
      </div>
      ${side ? sideHtml() : ""}
    </div>
  </main>
  <footer class="footer">
    <div class="wrap">
      ${footerLinks()}
      <p>${esc(SITE)}は、小説家になろう発の作品のニュースを集めている非公式のまとめサイトです。記事の本文は転載していません。画像・動画の権利は各権利者に帰属します。</p>
      <p class="copy">© ${year} ${esc(SITE)}</p>
    </div>
  </footer>
  ${TOTOP}
  ${scripts.map((s) => `<script src="${s}" defer></script>`).join("")}
</body>
</html>`;
  }

  // サイドバーは全ページに入るので、収集のたびに変わる値（件数など）は入れない
  function sideHtml() {
    const gl = genreLinks.map((c) => `<li><a href="/${c.id}/">${esc(c.label)}</a></li>`).join("");
    const wl = works
      .slice(0, 16)
      .map((w) => `<li><a href="/works/${w.id}/">${esc(w.short || w.title)}</a></li>`)
      .join("");
    return `<aside class="side">
      <section class="mod"><h2 class="mod-head">ジャンル</h2><ul class="side-links">${gl}</ul></section>
      <section class="mod"><h2 class="mod-head">作品</h2><ul class="side-links side-works">${wl}</ul><a class="mod-link" href="/works/">作品一覧へ</a></section>
      <section class="mod"><h2 class="mod-head">メニュー</h2><ul class="side-links">
        <li><a href="/">トップ</a></li><li><a href="/ranking/">なろうランキング</a></li><li><a href="/archive/">過去のニュース</a></li><li><a href="/about/">このサイトについて</a></li>
      </ul></section>
    </aside>`;
  }

  function badgesOf(it, { skipWork } = {}) {
    const b = [];
    const c0 = (it.categories || [])[0];
    if (c0 && c0 !== "other" && catLabel(c0)) b.push(`<span class="badge cat-${c0}">${esc(catLabel(c0))}</span>`);
    for (const id of (it.works || []).slice(0, 2)) {
      if (id === skipWork) continue;
      const w = workOf(id);
      if (w) b.push(`<a class="badge badge-work" href="/works/${w.id}/">${esc(w.short || w.title)}</a>`);
    }
    if (it.isPR) b.push('<span class="badge badge-pr">PR</span>');
    return b;
  }
  function rowHtml(it, opts = {}) {
    const badges = badgesOf(it, opts);
    return `<article class="row">${thumb(it, "row-thumb", catLabel)}<div class="row-body">
      ${badges.length ? `<div class="row-top">${badges.join("")}</div>` : ""}
      <a class="row-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      ${opts.withSum !== false && it.summary ? `<p class="row-sum">${esc(it.summary)}</p>` : ""}
      <div class="row-meta">${esc(it.source)} ・ <time datetime="${esc(it.publishedAt)}">${mdw(jstDay(it.publishedAt))} ${hhmm(it.publishedAt)}</time></div>
    </div></article>`;
  }
  function groupedHtml(items, tag = "h2", opts = {}) {
    const groups = new Map();
    for (const it of items) {
      const k = jstDay(it.publishedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    let html = "";
    for (const [day, list] of groups) {
      html += `<section class="day"><${tag} class="day-head"><span class="day-label">${mdw(day)}</span><span class="day-n">${list.length} 件</span></${tag}><div class="rows">${list.map((it) => rowHtml(it, opts)).join("")}</div></section>`;
    }
    return html;
  }
  function itemList(items, name) {
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name,
      numberOfItems: Math.min(items.length, 20),
      itemListElement: items.slice(0, 20).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: it.url, name: it.title })),
    };
  }
  const lastOf = (items) => items.reduce((a, it) => (it.publishedAt > a ? it.publishedAt : a), "") || now.toISOString();

  // なろうの作品情報の表（作品ページとランキング作品のページで使う）
  function novelFacts(n) {
    if (!n) return "";
    const rows = [
      ["作者", esc(n.writer)],
      ["ジャンル", esc([BIG_GENRES[n.bigGenre], GENRES[n.genre]].filter(Boolean).join(" ／ "))],
      ["状態", n.short ? "短編" : n.finished ? "完結済み" : "連載中"],
      ["話数", n.short ? "—" : `全 ${num(n.episodes)} 話`],
      ["文字数", `${num(n.length)} 文字`],
      ["総合ポイント", `${num(n.points)} pt`],
      ["ブックマーク", `${num(n.bookmarks)} 件`],
      ["掲載開始", n.firstUp ? jpDate(n.firstUp) : "—"],
      ["最終掲載", n.lastUp ? jpDate(n.lastUp) : "—"],
    ];
    const ranks = RANK_TYPES.filter((t) => n.ranks?.[t.id])
      .map((t) => `${t.label} 最高 ${n.ranks[t.id].best} 位`)
      .join("・");
    if (ranks) rows.push(["ランキング", `${ranks}`]);
    return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  }
  function storyHtml(n) {
    if (!n?.story) return "";
    return `<figure class="story"><blockquote cite="${narouUrl(n.ncode)}">${esc(n.story).replace(/\n/g, "<br>")}</blockquote>
      <figcaption>小説家になろうより（冒頭のみ）</figcaption></figure>`;
  }
  function tagsHtml(n) {
    const k = (n?.keywords || []).filter((x) => !/^R15$|^残酷な描写あり$|^ボーイズラブ$|^ガールズラブ$/.test(x));
    return k.length ? `<ul class="nkeys" aria-label="作者が付けたキーワード">${k.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  }
  function commentsHtml(id, title) {
    return `<section class="comments page-sec" id="comments" data-work="${esc(id)}" data-title="${esc(title)}">
      <h2 class="sec-title">コメント<span class="c-count" id="cCount"></span></h2>
      <p class="c-rule">ネタバレを含むときは「ネタバレ」にチェックを入れてください。URLは書き込めません。</p>
      <div class="c-list" id="cList"><p class="c-empty">コメントを読み込んでいます…</p></div>
      <form class="c-form" id="cForm" novalidate>
        <div class="c-row"><label>名前<input type="text" name="name" maxlength="20" placeholder="名無しの読者" autocomplete="nickname"></label>
          <label class="c-sp"><input type="checkbox" name="spoiler" value="1"> ネタバレ</label></div>
        <label class="c-body-label">コメント<textarea name="body" rows="4" maxlength="500" required placeholder="感想など"></textarea></label>
        <input type="text" name="website" class="c-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="c-foot"><span class="c-len" id="cLen">0 / 500</span><button type="submit">書き込む</button></div>
        <p class="c-msg" id="cMsg" role="status"></p>
      </form>
      <noscript><p class="c-empty">コメントを見る・書くには JavaScript を有効にしてください。</p></noscript>
    </section>`;
  }

  // ---------- 作品の画像と PV ----------
  // data/works-media.json（workmedia.mjs が記事から拾ったもの）より、config.json の image / pv を優先する
  const media = (await readJson(join(root, "data", "works-media.json"), {})) || {};
  // 複数の作品で同じ画像が出てくるのは媒体のロゴなどなので使わない
  const imgCount = new Map();
  for (const m of Object.values(media)) for (const im of m.images || []) imgCount.set(im.url, (imgCount.get(im.url) || 0) + 1);
  function visualOf(w, newsItems = []) {
    const m = media[w.id] || {};
    const pv = w.pv ? { id: w.pv, title: "", channel: "" } : m.pv || null;
    // 記事の画像が無い・読み込めないときは PV のサムネイルを使う
    const fallback = pv ? `https://img.youtube.com/vi/${pv.id}/hqdefault.jpg` : "";
    if (w.image) return { src: w.image, fallback, pv };
    // 見出しの判定は後から直すことがあるので、ここでも付け直して並べる
    const im = (m.images || [])
      .map((x) => ({ ...x, score: imageScore(x.title || "") }))
      .filter((x) => x.score > 0 && imgCount.get(x.url) === 1)
      .sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1))[0];
    if (im) return { src: im.url, fallback, pv };
    if (fallback) return { src: fallback, fallback: "", pv };
    const it = newsItems.find((x) => x.image);
    if (it) return { src: it.image, fallback: "", pv };
    return { src: "", fallback: "", pv };
  }
  function visualHtml(v, title, cls) {
    if (!v.src) return `<div class="${cls} noimg"><span>${esc(title)}</span></div>`;
    return `<div class="${cls}"><img src="${esc(v.src)}"${v.fallback ? ` data-fb="${esc(v.fallback)}"` : ""} alt="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="${IMG_ONERROR}"></div>`;
  }
  const statusOf = (n) => (n ? (n.short ? "短編" : n.finished ? "完結済み" : "連載中") : "");

  // ---------- 作品ページ ----------
  const index = {};
  const workNews = new Map(works.map((w) => [w.id, all.filter((it) => (it.works || []).includes(w.id))]));
  const workCards = [];
  for (const w of works) {
    const n = w.novel;
    const allNews = workNews.get(w.id);
    const items = allNews.slice(0, LIST_MAX);
    const path = `/works/${w.id}/`;
    const v = visualOf(w, allNews);
    index[w.id] = { title: w.title, short: w.short || w.title, path, image: v.src, fallback: v.fallback };
    const catCount = {};
    for (const it of allNews) for (const c of it.categories || []) catCount[c] = (catCount[c] || 0) + 1;
    const catSummary = cats
      .filter((c) => catCount[c.id])
      .map((c) => `<span class="badge cat-${c.id}">${esc(c.label)} ${catCount[c.id]}</span>`)
      .join("");
    workCards.push({
      w,
      n,
      recentCount: allNews.filter((it) => new Date(it.publishedAt).getTime() >= now.getTime() - 30 * 86400000).length,
      html: `<li class="wcard"><a href="${path}">
        ${visualHtml(v, w.short || w.title, "wcard-img")}
        <span class="wcard-title">${esc(w.title)}</span></a>
        <span class="wcard-meta">${n ? `${esc(n.writer)} / ${statusOf(n)}` : ""}</span>
        <span class="wcard-n">${allNews.length ? `ニュース${allNews.length}件` : ""}<span class="wcard-c" data-count-for="${w.id}"></span></span></li>`,
    });
    const desc = truncate(`『${w.title}』${n ? `（${n.writer}）` : ""}のアニメ・コミカライズ・書籍化などのニュースと、小説家になろうでの連載情報、読者のコメント。`, 120);
    const pvHtml = v.pv
      ? `<div class="pv"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v.pv.id)}" title="${esc(v.pv.title || `${w.title} PV`)}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
        ${v.pv.title ? `<p class="pv-cap">${esc(v.pv.title)}${v.pv.channel ? `（${esc(v.pv.channel)}）` : ""}</p>` : ""}`
      : "";
    const body = `
      <div class="work-top">
        <div class="work-visual">${visualHtml(v, w.title, "work-img")}
</div>
        <div class="work-info">
          ${novelFacts(n)}
          ${w.ncode ? `<p class="work-links"><a class="link-btn" href="${narouUrl(w.ncode)}" target="_blank" rel="noopener">小説家になろうで読む</a></p>` : ""}
        </div>
      </div>
      ${pvHtml ? `<h2 class="sec-title">PV</h2>${pvHtml}` : ""}
      ${n?.story ? `<h2 class="sec-title">あらすじ</h2>${storyHtml(n)}${tagsHtml(n)}` : ""}
      <h2 class="sec-title">ニュース${allNews.length ? `<span class="sec-n">${allNews.length}件</span>` : ""}</h2>
      ${catSummary ? `<p class="cat-summary">${catSummary}</p>` : ""}
      ${items.length ? groupedHtml(items, "h3", { skipWork: w.id }) : `<p class="empty">まだニュースはありません。</p>`}
      ${commentsHtml(w.id, w.title)}`;
    await out(
      path,
      page({
        path,
        title: `${w.title}の最新情報・アニメ・コミカライズまとめ`,
        desc,
        h1: w.title,
        body,
        crumbs: [
          { name: "作品一覧", path: "/works/" },
          { name: w.short || w.title, path },
        ],
        jsonld: [
          {
            "@context": "https://schema.org",
            "@type": "Book",
            name: w.title,
            ...(n ? { author: { "@type": "Person", name: n.writer }, genre: GENRES[n.genre] || undefined } : {}),
            ...(w.ncode ? { url: narouUrl(w.ncode) } : {}),
            inLanguage: "ja",
          },
          ...(items.length ? [itemList(items, `${w.title}のニュース`)] : []),
        ],
        scripts: [`/assets/comments.js?v=${ver.comments}`],
        ogType: "article",
      }),
      { lastmod: items.length ? lastOf(items) : n?.fetchedAt }
    );
  }

  // 作品一覧。この 30 日のニュースが多い順
  workCards.sort((a, b) => b.recentCount - a.recentCount || (b.n?.points || 0) - (a.n?.points || 0));
  await out(
    "/works/",
    page({
      path: "/works/",
      title: "作品一覧（なろう発のアニメ化・書籍化作品）",
      desc: "転生したらスライムだった件・無職転生・薬屋のひとりごと・本好きの下剋上など、小説家になろう発の作品ごとのニュースとコメント。",
      h1: "作品一覧",
      body: `<ul class="wgrid">${workCards.map((c) => c.html).join("")}</ul>`,
      crumbs: [{ name: "作品一覧", path: "/works/" }],
      jsonld: [
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "作品一覧",
          numberOfItems: workCards.length,
          itemListElement: workCards.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(`/works/${c.w.id}/`), name: c.w.title })),
        },
      ],
      scripts: [`/assets/comments.js?v=${ver.comments}`],
    }),
    { lastmod: news?.updatedAt }
  );

  // ---------- トップ ----------
  if (indexTpl) {
    const items = news?.items || [];
    const listHtml = items.length
      ? groupedHtml(items.slice(0, 30), "h3")
      : '<div class="loading"><span class="spinner" role="status" aria-label="読み込み中"></span><span>ニュースを読み込んでいます…</span></div>';
    let meta = "読み込み中…";
    if (news) {
      const u = jst(news.updatedAt);
      meta = `最終更新 ${u.getUTCMonth() + 1}/${u.getUTCDate()} ${hhmm(news.updatedAt)}（今日のニュース ${news.todayCount}件）`;
    }
    // ニュースが多い作品（この 7 日）と話題のニュースも HTML に書いておく（app.js が描き直す）
    const since = now.getTime() - 7 * 86400000;
    const wn = {};
    for (const it of items) {
      if (new Date(it.publishedAt).getTime() < since) continue;
      for (const id of it.works || []) wn[id] = (wn[id] || 0) + 1;
    }
    const movingIds = Object.keys(wn)
      .filter((id) => index[id])
      .sort((a, b) => wn[b] - wn[a])
      .slice(0, 6);
    const movingHtml = movingIds
      .map((id) => {
        const x = index[id];
        return `<li class="wcard"><a href="/works/${id}/">${visualHtml({ src: x.image, fallback: x.fallback }, x.short, "wcard-img")}<span class="wcard-title">${esc(x.title)}</span></a><span class="wcard-n">ニュース${wn[id]}件</span></li>`;
      })
      .join("");
    const topicsHtml = (news?.topics || [])
      .slice(0, 6)
      .map(
        (t, i) =>
          `<article class="topic${i === 0 ? " topic-lead" : ""}">${i === 0 && t.image ? `<div class="topic-img"><img src="${esc(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ""}<a class="topic-title" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a></article>`
      )
      .join("");
    const head = [
      verify,
      ld({ "@context": "https://schema.org", "@type": "Organization", name: SITE, url: BASE, logo: abs("/apple-touch-icon.png") }),
      items.length ? ld(itemList(items, "なろう系の新着ニュース")) : "",
    ].join("");
    const html = indexTpl
      .replace("<!--ssr:head-->", head)
      .replace("<!--ssr:nav-->", navHtml())
      .replace("<!--ssr:list-->", listHtml)
      .replace("<!--ssr:moving-->", movingHtml)
      .replace("<!--ssr:topics-->", topicsHtml)
      .replace('id="movingSection" hidden', movingHtml ? 'id="movingSection"' : 'id="movingSection" hidden')
      .replace('id="topicsSection" hidden', topicsHtml ? 'id="topicsSection"' : 'id="topicsSection" hidden')
      .replace("<!--ssr:footer-links-->", footerLinks())
      .replace("<!--ssr:totop-->", TOTOP)
      .replace('<span id="meta">読み込み中…</span>', `<span id="meta">${esc(meta)}</span>`)
      .replace(/href="assets\/app\.css"/, `href="assets/app.css?v=${ver.css}"`)
      .replace(/src="assets\/app\.js"/, `src="assets/app.js?v=${ver.app}"`);
    await out("/", html, { lastmod: news?.updatedAt });
  }

  // ---------- ランキング作品のページ ----------
  // 中身はなろうの API の値とあらすじの冒頭で、なろうの作品ページとほぼ同じになるので、
  // 検索には出さない（noindex）。コメント欄のためにページは作る。config.json の narou.indexNovelPages で切り替え
  const indexNovels = !!config.narou?.indexNovelPages;
  // 登録作品（works）に入っているものは作品ページがあるので作らない
  for (const n of novels.values()) {
    if (workByNcode.has(n.ncode) || !Object.keys(n.ranks || {}).length) continue;
    const path = `/novel/${n.ncode}/`;
    index[n.ncode] = { title: n.title, path };
    const rankRows = RANK_TYPES.filter((t) => n.ranks?.[t.id])
      .map((t) => {
        const r = n.ranks[t.id];
        return `<li><b>${t.label}</b> 最高 ${r.best} 位（${esc(r.bestDate)}）・直近 ${r.last} 位（${esc(r.lastDate)}）</li>`;
      })
      .join("");
    await out(
      path,
      page({
        path,
        title: `${truncate(n.title.replace(/^(【[^】]*】\s*)+|(\s*【[^】]*】)+$/g, ""), 50)}（${truncate(n.writer, 12)}）`,
        desc: truncate(`小説家になろうのランキングに入った『${n.title}』（${n.writer}）の作品情報とあらすじの冒頭、読者のコメント。${n.story || ""}`, 120),
        h1: n.title,
        body: `<div class="work-info work-info-wide">${novelFacts(n)}<p class="work-links"><a class="link-btn" href="${narouUrl(n.ncode)}" target="_blank" rel="noopener">小説家になろうで読む</a></p></div>
          ${n.story ? `<h2 class="sec-title">あらすじ</h2>${storyHtml(n)}${tagsHtml(n)}` : ""}
          ${rankRows ? `<h2 class="sec-title">ランキングの記録</h2><ul class="rank-log">${rankRows}</ul>` : ""}
          ${commentsHtml(n.ncode, n.title)}`,
        crumbs: [
          { name: "なろうランキング", path: "/ranking/" },
          { name: truncate(n.title, 24), path },
        ],
        jsonld: [{ "@context": "https://schema.org", "@type": "Book", name: n.title, author: { "@type": "Person", name: n.writer }, url: narouUrl(n.ncode), inLanguage: "ja" }],
        noindex: !indexNovels,
        scripts: [`/assets/comments.js?v=${ver.comments}`],
        ogType: "article",
      }),
      { lastmod: n.lastUp || undefined, index: indexNovels }
    );
  }

  // ---------- なろうランキング ----------
  {
    let body = "";
    const rk = ranking?.rankings || {};
    const types = RANK_TYPES.filter((t) => rk[t.id]);
    if (types.length) {
      const bigs = [...new Set(types.flatMap((t) => rk[t.id].list.map((x) => x.bigGenre)).filter((x) => x != null))];
      body += `<div class="rank-tabs" role="tablist" aria-label="ランキングの種類">${types
        .map((t, i) => `<button type="button" role="tab" data-rank="${t.id}" aria-selected="${i === 0}">${t.label}</button>`)
        .join("")}</div>
        <div class="rank-filter" aria-label="大ジャンルでしぼる"><button type="button" data-big="" class="active">すべて</button>${bigs
          .map((b) => `<button type="button" data-big="${b}">${esc(BIG_GENRES[b] || "その他")}</button>`)
          .join("")}</div>`;
      for (const [i, t] of types.entries()) {
        const r = rk[t.id];
        body += `<section class="rank-panel" data-panel="${t.id}"${i === 0 ? "" : " hidden"}>
          <p class="rank-date">${esc(r.date)} 集計</p>
          <ol class="rank-list">${r.list
            .map((x) => {
              const href = x.workId ? `/works/${x.workId}/` : `/novel/${x.ncode}/`;
              return `<li class="rank-row${x.rank <= 3 ? " is-top" : ""}" data-big="${x.bigGenre ?? ""}">
                <span class="rank-no">${x.rank}</span>
                <div class="rank-body"><a class="rank-title" href="${href}">${esc(x.title)}</a>
                <span class="rank-meta">${esc(x.writer)} ・ ${esc(GENRES[x.genre] || "")} ・ ${x.short ? "短編" : `${x.finished ? "完結" : "連載中"} ${num(x.episodes)} 話`}</span></div>
                <span class="rank-pt">${num(x.pt)}<small>pt</small></span></li>`;
            })
            .join("")}</ol></section>`;
      }
    } else {
      body = '<p class="empty">ランキングをまだ取得できていません。</p>';
    }
    body += `<p class="note">なろう小説ランキングAPIのデータです（R18作品は含みません）。</p>`;
    await out(
      "/ranking/",
      page({
        path: "/ranking/",
        title: "小説家になろう ランキング（日間・週間・月間・四半期）",
        desc: "小説家になろうの日間・週間・月間・四半期ランキングの上位作品を、ジャンル・話数・ポイントと一緒に一覧にしています。作品ごとのページでコメントもできます。",
        h1: "なろうランキング",
        lead: "小説家になろう公式ランキングの上位30作品です。",
        body,
        crumbs: [{ name: "なろうランキング", path: "/ranking/" }],
        jsonld: rk.d
          ? [
              {
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: "小説家になろう 日間ランキング",
                numberOfItems: rk.d.list.length,
                itemListElement: rk.d.list.map((x) => ({ "@type": "ListItem", position: x.rank, url: abs(x.workId ? `/works/${x.workId}/` : `/novel/${x.ncode}/`), name: x.title })),
              },
            ]
          : [],
        scripts: [`/assets/ranking.js?v=${ver.ranking}`],
      }),
      { lastmod: ranking?.updatedAt, index: types.length > 0 }
    );
  }

  // ---------- ジャンル別 ----------
  for (const c of genreLinks) {
    const items = recent.filter((it) => (it.categories || []).includes(c.id)).slice(0, LIST_MAX);
    await out(
      `/${c.id}/`,
      page({
        path: `/${c.id}/`,
        title: `${c.title}（最新ニュースまとめ）`,
        desc: truncate(`${c.desc}${items.length ? `最近の記事：${items.slice(0, 2).map((it) => `「${it.title}」`).join("")}` : ""}`, 120),
        h1: c.title,
        lead: esc(c.desc),
        body: items.length ? groupedHtml(items) : '<p class="empty">いまはこのジャンルのニュースがありません。</p>',
        crumbs: [{ name: c.label, path: `/${c.id}/` }],
        jsonld: items.length ? [itemList(items, c.title)] : [],
        noindex: items.length < MIN_INDEXABLE,
      }),
      { lastmod: lastOf(items), index: items.length >= MIN_INDEXABLE }
    );
  }

  // ---------- 過去のニュース（日別・月別） ----------
  const months = new Map();
  for (const d of archive) {
    const k = d.day.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  for (let i = 0; i < archive.length; i++) {
    const d = archive[i];
    const p = dayParts(d.day);
    const newer = archive[i - 1];
    const older = archive[i + 1];
    const path = `/archive/${p.y}/${pad(p.m)}/${pad(p.d)}/`;
    const pager = `<nav class="pager" aria-label="前後の日">
      ${older ? `<a href="/archive/${older.day.replace(/-/g, "/")}/">← ${mdw(older.day)}</a>` : "<span></span>"}
      <a href="/archive/${p.y}/${pad(p.m)}/">${p.y}年${p.m}月の一覧</a>
      ${newer ? `<a href="/archive/${newer.day.replace(/-/g, "/")}/">${mdw(newer.day)} →</a>` : "<span></span>"}
    </nav>`;
    await out(
      path,
      page({
        path,
        title: `${jpDay(d.day)}のなろう系ニュース ${d.items.length} 件`,
        desc: truncate(`${p.y}年${p.m}月${p.d}日のなろう系ニュース ${d.items.length} 件。${d.items.slice(0, 3).map((it) => it.title).join(" / ")}`, 120),
        h1: `${jpDay(d.day)}のなろう系ニュース`,
        body: `<div class="rows">${d.items.map((it) => rowHtml(it)).join("")}</div>${pager}`,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${p.y}年${p.m}月`, path: `/archive/${p.y}/${pad(p.m)}/` },
          { name: `${p.d}日`, path },
        ],
        jsonld: [itemList(d.items, `${jpDay(d.day)}のなろう系ニュース`)],
      }),
      { lastmod: lastOf(d.items) }
    );
  }
  for (const [k, days] of months) {
    const [y, m] = k.split("-").map(Number);
    const total = days.reduce((a, d) => a + d.items.length, 0);
    const body = `<ul class="archive-days">${days
      .map(
        (d) => `<li><a class="archive-day" href="/archive/${d.day.replace(/-/g, "/")}/"><span class="day-label">${mdw(d.day)}</span><span class="n">${d.items.length} 件</span></a>
        <ul>${d.items
          .slice(0, 3)
          .map((it) => `<li>${esc(truncate(it.title, 60))}</li>`)
          .join("")}</ul></li>`
      )
      .join("")}</ul>`;
    const path = `/archive/${y}/${pad(m)}/`;
    await out(
      path,
      page({
        path,
        title: `${y}年${m}月のなろう系ニュース一覧`,
        desc: `${y}年${m}月に出たなろう系作品のアニメ化・コミカライズ・書籍化のニュース ${total} 件を、日ごとにまとめています。`,
        h1: `${y}年${m}月のなろう系ニュース`,
        body,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${y}年${m}月`, path },
        ],
      }),
      { lastmod: lastOf(days.flatMap((d) => d.items)) }
    );
  }
  await out(
    "/archive/",
    page({
      path: "/archive/",
      title: "過去のなろう系ニュース",
      desc: "これまでに集めたなろう系作品のアニメ化・コミカライズ・書籍化・グッズのニュースを、月ごと・日ごとにさかのぼって見られます。",
      h1: "過去のニュース",
      body: months.size
        ? `<ul class="archive-months">${[...months]
            .map(([k, days]) => {
              const [y, m] = k.split("-").map(Number);
              return `<li><a href="/archive/${y}/${pad(m)}/">${y}年${m}月<span class="n">${days.reduce((a, d) => a + d.items.length, 0)} 件</span></a></li>`;
            })
            .join("")}</ul>`
        : '<p class="empty">まだありません。</p>',
      crumbs: [{ name: "過去のニュース", path: "/archive/" }],
    }),
    { lastmod: archive[0] ? lastOf(archive[0].items) : undefined }
  );

  // ---------- このサイトについて ----------
  const sourceNames = (news?.sources || []).map((s) => s.name);
  await out(
    "/about/",
    page({
      path: "/about/",
      title: "このサイトについて",
      desc: `${SITE}は、小説家になろう発の作品のアニメ化・コミカライズ・書籍化のニュースと、なろうのランキングを集めている非公式のまとめサイトです。`,
      h1: "このサイトについて",
      body: `<div class="prose">
        <p>${esc(SITE)}は、小説家になろう発の作品や異世界ものの作品のニュースを集めているまとめサイトです。30分おきに更新しています。個人の運営で、小説家になろう（株式会社ヒナプロジェクト）・作者・出版社とは関係ありません。</p>
        <h2>載せているもの</h2>
        <p>ニュースは見出しと要約の一部、元記事へのリンクだけです。本文は転載していません。作品ページの画像は、その作品を扱ったニュース記事の紹介用画像（og:image）か、YouTubeのPVのサムネイルです。PVはYouTubeの公式動画を埋め込んでいます。</p>
        <p>作品の情報・あらすじの冒頭・ランキングは、小説家になろうの公式APIのデータです。</p>
        <p>ジャンルや作品の振り分けは見出しの言葉から機械的に判定しているので、間違っていることがあります。</p>
        <h2>コメント</h2>
        <p>作品ページのコメント欄はどなたでも書き込めます。暴言・URL・メールアドレス・電話番号は書き込めません。通報が3件あったコメントは自動で非表示になります。自分のコメントは、書き込んだブラウザから削除できます。IPアドレスはそのまま保存せず、連投防止とIDの表示に使うハッシュ値にしています。</p>
        <h2>アクセス解析</h2>
        <p>Googleアナリティクスを使っています。</p>
        ${sourceNames.length ? `<h2>おもな収集元</h2><p>${sourceNames.slice(0, 40).map(esc).join(" / ")}</p>` : ""}
        ${config.site?.contactUrl ? `<h2>お問い合わせ</h2><p><a href="${esc(config.site.contactUrl)}" target="_blank" rel="noopener noreferrer">お問い合わせフォーム（Googleフォーム）</a></p>` : ""}
      </div>`,
      crumbs: [{ name: "このサイトについて", path: "/about/" }],
    }),
    { lastmod: undefined }
  );

  // ---------- 404 ----------
  await out(
    "/404.html",
    page({
      path: "/404.html",
      title: "ページが見つかりません",
      desc: "お探しのページは見つかりませんでした。",
      h1: "ページが見つかりません",
      lead: "お探しのページは、移動したか、なくなった可能性があります。",
      body: '<p><a class="link-btn" href="/">トップへもどる</a></p>',
      noindex: true,
    }),
    { index: false }
  );

  // ---------- コメント API が読む作品の一覧 ----------
  await out("/data/works-index.json", JSON.stringify(index), { index: false });

  // ---------- feed.xml（Atom） ----------
  {
    const items = (news?.items || []).slice(0, 50);
    const xe = (s) => esc(s);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
  <title>${xe(SITE)}</title>
  <subtitle>${xe(config.site?.tagline || "")}</subtitle>
  <link href="${BASE}" rel="alternate"/>
  <link href="${abs("/feed.xml")}" rel="self"/>
  <id>${BASE}</id>
  <updated>${news?.updatedAt || now.toISOString()}</updated>
  <author><name>${xe(SITE)}</name></author>
${items
  .map(
    (it) => `  <entry>
    <title>${xe(it.title)}</title>
    <link href="${xe(it.url)}"/>
    <id>${BASE}#${it.id}</id>
    <updated>${new Date(it.publishedAt).toISOString()}</updated>
    <summary>${xe(`${it.source}${it.summary ? ` ／ ${it.summary}` : ""}`)}</summary>
  </entry>`
  )
  .join("\n")}
</feed>
`;
    await out("/feed.xml", xml, { index: false });
  }

  // ---------- sitemap.xml ----------
  {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap
  .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().replace(/\.\d{3}Z$/, "+00:00")}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`;
    await out("/sitemap.xml", xml, { index: false });
  }

  log(`pages: ${sitemap.length} indexable, ${written.length} written`);
  return written;
}
