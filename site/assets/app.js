// なろう系まとめ — トップの画面。data/news.json・data/ranking.json と、コメント API の新着を読んで描く。
(function () {
  "use strict";

  var PAGE = 40;
  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  var CAT_INK = { anime: "#2f5d8a", comic: "#8a3f5d", book: "#1e6b52", web: "#6b5a1e", game: "#5a3f8a", goods: "#8a5a2f", other: "#55606e" };
  var GENRES = { 101: "異世界〔恋愛〕", 102: "現実世界〔恋愛〕", 201: "ハイファンタジー", 202: "ローファンタジー", 301: "純文学", 302: "ヒューマンドラマ", 303: "歴史", 304: "推理", 305: "ホラー", 306: "アクション", 307: "コメディー", 401: "VRゲーム", 402: "宇宙", 403: "空想科学", 404: "パニック", 9801: "ノンジャンル", 9901: "童話", 9902: "詩", 9903: "エッセイ", 9904: "リプレイ", 9999: "その他" };

  var $ = function (id) {
    return document.getElementById(id);
  };
  var state = { cat: "all", q: "", work: "", shown: PAGE };
  var news = null;
  var workMap = {};
  var catMap = {};
  var ng = [];

  // ---------- 保存（使えないブラウザでも動くように） ----------
  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {
      /* 保存できなくても表示は続ける */
    }
  }

  // ---------- 小物 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function jst(iso) {
    return new Date(new Date(iso).getTime() + 9 * 3600000);
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function dayKey(iso) {
    return jst(iso).toISOString().slice(0, 10);
  }
  function mdw(key) {
    var p = key.split("-").map(Number);
    var wd = WD[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
    return p[1] + "/" + p[2] + "（" + wd + "）";
  }
  function hhmm(iso) {
    var d = jst(iso);
    return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "いま";
    if (m < 60) return m + " 分前";
    if (m < 60 * 24) return Math.floor(m / 60) + " 時間前";
    return Math.floor(m / 1440) + " 日前";
  }
  function getJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function hidden(it) {
    if (!ng.length) return false;
    var t = (it.title + " " + (it.summary || "")).toLowerCase();
    return ng.some(function (w) {
      return t.indexOf(w.toLowerCase()) !== -1;
    });
  }

  // ---------- 記事の行 ----------
  function thumb(it) {
    if (it.image) {
      return '<div class="row-thumb"><img src="' + esc(it.image) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'thumb-ph\');this.remove()"></div>';
    }
    var c = (it.categories || [])[0] || "other";
    var label = (catMap[c] && catMap[c].label) || "話題";
    return '<div class="row-thumb thumb-ph" style="--tint:' + (CAT_INK[c] || CAT_INK.other) + '"><span>' + esc(label.slice(0, 2)) + "</span></div>";
  }
  function row(it) {
    var b = [];
    var c0 = (it.categories || [])[0];
    if (c0 && c0 !== "other" && catMap[c0]) b.push('<span class="badge cat-' + c0 + '">' + esc(catMap[c0].label) + "</span>");
    (it.works || []).slice(0, 2).forEach(function (id) {
      var w = workMap[id];
      if (w) b.push('<a class="badge badge-work" href="works/' + id + '/">' + esc(w.short) + "</a>");
    });
    if (it.isPR) b.push('<span class="badge badge-pr">PR</span>');
    if (it.isNew) b.push('<span class="badge badge-new">新着</span>');
    return (
      '<article class="row">' +
      thumb(it) +
      '<div class="row-body">' +
      (b.length ? '<div class="row-top">' + b.join("") + "</div>" : "") +
      '<a class="row-title" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + "</a>" +
      (it.summary ? '<p class="row-sum">' + esc(it.summary) + "</p>" : "") +
      '<div class="row-meta">' + esc(it.source) + ' ・ <time datetime="' + esc(it.publishedAt) + '">' + mdw(dayKey(it.publishedAt)) + " " + hhmm(it.publishedAt) + "</time></div>" +
      "</div></article>"
    );
  }

  // ---------- いま動いている作品 ----------
  function renderMoving(counts) {
    var since = Date.now() - 7 * 86400000;
    var latest = {};
    var n = {};
    news.items.forEach(function (it) {
      if (new Date(it.publishedAt).getTime() < since) return;
      (it.works || []).forEach(function (id) {
        n[id] = (n[id] || 0) + 1;
        if (!latest[id]) latest[id] = it;
      });
    });
    var list = Object.keys(n)
      .filter(function (id) {
        return workMap[id];
      })
      .sort(function (a, b) {
        return n[b] - n[a] || (latest[a].publishedAt < latest[b].publishedAt ? 1 : -1);
      })
      .slice(0, 8);
    if (!list.length) return;
    var max = n[list[0]];
    $("movingList").innerHTML = list
      .map(function (id, i) {
        var w = workMap[id];
        var it = latest[id];
        var cc = counts && counts[id] ? '<span class="mv-c">コメント ' + counts[id] + "</span>" : "";
        return (
          '<li class="mv' + (i === 0 ? " mv-lead" : "") + '">' +
          '<a class="mv-name" href="works/' + id + '/">' + esc(w.title) + "</a>" +
          '<span class="mv-bar" style="--pct:' + Math.max(8, Math.round((n[id] / max) * 100)) + '%"><b>' + n[id] + "</b> 本</span>" +
          '<a class="mv-latest" href="' + esc(it.url) + '" target="_blank" rel="noopener"><time>' + ago(it.publishedAt) + "</time>" + esc(it.title) + "</a>" +
          cc +
          "</li>"
        );
      })
      .join("");
    $("movingSection").hidden = false;
  }

  // ---------- 複数の媒体が報じた話題 ----------
  function renderTopics() {
    var topics = (news.topics || []).filter(function (t) {
      return !hidden(t);
    });
    if (!topics.length) return;
    $("topicList").innerHTML = topics
      .slice(0, 4)
      .map(function (t, i) {
        var others = (t.articles || [])
          .slice(0, 4)
          .map(function (a) {
            return '<li><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.source) + "</a></li>";
          })
          .join("");
        return (
          '<article class="topic' + (i === 0 ? " topic-lead" : "") + '">' +
          (i === 0 && t.image ? '<div class="topic-img"><img src="' + esc(t.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>' : "") +
          '<div class="topic-body"><span class="topic-n"><b>' + t.sourceCount + "</b> 媒体</span>" +
          '<a class="topic-title" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.title) + "</a>" +
          '<p class="topic-meta">' + esc(t.leadSource) + " ・ " + ago(t.publishedAt) + (others ? "</p><ul class=\"topic-others\">" + others + "</ul>" : "</p>") +
          "</div></article>"
        );
      })
      .join("");
    $("topicsSection").hidden = false;
  }

  // ---------- 新着ニュース ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return news.items.filter(function (it) {
      if (hidden(it)) return false;
      if (state.cat !== "all" && (it.categories || []).indexOf(state.cat) === -1) return false;
      if (state.work && (it.works || []).indexOf(state.work) === -1) return false;
      if (q && (it.title + " " + (it.summary || "") + " " + it.source).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function renderCats() {
    var cats = [{ id: "all", label: "すべて", count: news.items.length }].concat(
      news.categories.filter(function (c) {
        return c.count > 0;
      })
    );
    $("catList").innerHTML = cats
      .map(function (c) {
        return '<button type="button" data-cat="' + c.id + '" class="' + (state.cat === c.id ? "active" : "") + '">' + esc(c.label) + '<span class="n">' + c.count + "</span></button>";
      })
      .join("");
  }
  function renderWorkFilter() {
    var el = $("workFilter");
    if (!state.work || !workMap[state.work]) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<span>作品: <a href="works/' + state.work + '/">' + esc(workMap[state.work].title) + '</a></span><button type="button" id="workClear" aria-label="作品のしぼりこみをやめる">×</button>';
  }
  function renderList() {
    var items = filtered();
    var shown = items.slice(0, state.shown);
    var groups = [];
    var cur = null;
    shown.forEach(function (it) {
      var k = dayKey(it.publishedAt);
      if (!cur || cur.k !== k) {
        cur = { k: k, items: [] };
        groups.push(cur);
      }
      cur.items.push(it);
    });
    $("list").innerHTML = groups
      .map(function (g) {
        return '<section class="day"><h3 class="day-head"><span class="day-label">' + mdw(g.k) + '</span><span class="day-n">' + g.items.length + " 件</span></h3><div class=\"rows\">" + g.items.map(row).join("") + "</div></section>";
      })
      .join("");
    $("count").textContent = items.length + " 件" + (state.cat !== "all" || state.q || state.work ? "（しぼりこみ中）" : "");
    $("empty").hidden = items.length > 0;
    var more = $("listMore");
    more.hidden = items.length <= state.shown;
    more.textContent = "もっと見る（あと " + Math.max(0, items.length - state.shown) + " 件）";
    renderCats();
    renderWorkFilter();
  }
  function persist() {
    save("narou:state", { cat: state.cat, q: state.q });
  }

  // ---------- サイド ----------
  function renderRanking(data) {
    var r = data && data.rankings && data.rankings.d;
    if (!r || !r.list.length) return;
    $("rankDate").textContent = r.date.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, "$1年$2月$3日") + " 集計分";
    $("rankList").innerHTML = r.list
      .slice(0, 10)
      .map(function (x) {
        var href = x.workId ? "works/" + x.workId + "/" : "novel/" + x.ncode + "/";
        return '<li><span class="mr-no">' + x.rank + '</span><a href="' + href + '">' + esc(x.title) + '</a><span class="mr-meta">' + esc(GENRES[x.genre] || "") + " ・ " + x.pt.toLocaleString("ja-JP") + " pt</span></li>";
      })
      .join("");
    $("rankMod").hidden = false;
  }
  function renderRecentComments(data) {
    var items = (data && data.items) || [];
    if (!items.length) return;
    $("recentComments").innerHTML = items
      .slice(0, 6)
      .map(function (c) {
        return (
          '<li><a class="rc-work" href="' + esc(c.path) + '#comments">' + esc(c.title) + "</a>" +
          '<p class="rc-body">' + (c.sp ? '<span class="rc-sp">ネタバレを含むコメント</span>' : esc(c.body)) + "</p>" +
          '<span class="rc-meta">' + esc(c.name) + " ・ " + ago(c.at) + "</span></li>"
        );
      })
      .join("");
    $("commentMod").hidden = false;
  }
  function renderNg() {
    $("ngList").innerHTML = ng
      .map(function (w, i) {
        return '<span class="ng-chip">' + esc(w) + '<button type="button" data-ng="' + i + '" aria-label="' + esc(w) + ' を外す">×</button></span>';
      })
      .join("");
  }
  function renderOther(data) {
    var items = ((data && data.items) || []).slice(0, 8);
    if (!items.length) return;
    $("otherList").innerHTML = items
      .map(function (it) {
        return '<li><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a><span class="ol-src">' + esc(it.source) + "</span></li>";
      })
      .join("");
    $("otherMod").hidden = false;
  }

  // ---------- 操作 ----------
  function bind() {
    $("catList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cat]");
      if (!b) return;
      state.cat = b.getAttribute("data-cat");
      state.shown = PAGE;
      persist();
      renderList();
    });
    var timer = null;
    $("searchInput").addEventListener("input", function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = e.target.value;
        state.shown = PAGE;
        persist();
        renderList();
      }, 150);
    });
    $("searchForm").addEventListener("submit", function (e) {
      e.preventDefault();
    });
    $("workFilter").addEventListener("click", function (e) {
      if (e.target.id !== "workClear") return;
      state.work = "";
      history.replaceState(null, "", location.pathname);
      renderList();
    });
    $("listMore").addEventListener("click", function () {
      state.shown += PAGE;
      renderList();
    });
    $("ngForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("ngInput").value.trim();
      if (v && ng.indexOf(v) === -1) {
        ng.push(v);
        save("narou:ng", ng);
        renderNg();
        renderList();
      }
      $("ngInput").value = "";
    });
    $("ngList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-ng]");
      if (!b) return;
      ng.splice(Number(b.getAttribute("data-ng")), 1);
      save("narou:ng", ng);
      renderNg();
      renderList();
    });
  }

  // ---------- はじめ ----------
  function init() {
    $("year").textContent = new Date().getFullYear();
    var saved = load("narou:state", {});
    state.cat = saved.cat || "all";
    state.q = saved.q || "";
    var m = location.search.match(/[?&]work=([a-z0-9-]+)/);
    if (m) state.work = m[1];
    ng = load("narou:ng", []);
    $("searchInput").value = state.q;
    renderNg();
    bind();

    var comments = getJson("api/comments.php?recent=1").catch(function () {
      return null;
    });

    getJson("data/news.json")
      .then(function (data) {
        news = data;
        (data.works || []).forEach(function (w) {
          workMap[w.id] = w;
        });
        (data.categories || []).forEach(function (c) {
          catMap[c.id] = c;
        });
        if (state.cat !== "all" && !catMap[state.cat]) state.cat = "all";
        var u = jst(data.updatedAt);
        $("meta").textContent = data.total + " 本のニュース ・ きょう " + data.todayCount + " 本 ・ 最終更新 " + (u.getUTCMonth() + 1) + "/" + u.getUTCDate() + " " + hhmm(data.updatedAt);
        if (data.churn && data.churn.newCount > 0) {
          $("churn").textContent = "前回の更新から +" + data.churn.newCount + " 本";
          $("churn").hidden = false;
        }
        $("sourceList").textContent = (data.sources || [])
          .slice(0, 20)
          .map(function (s) {
            return s.name;
          })
          .join(" / ");
        renderTopics();
        renderList();
        return comments.then(function (c) {
          renderMoving(c && c.counts);
          renderRecentComments(c);
        });
      })
      .catch(function () {
        $("list").innerHTML = '<p class="empty">ニュースを読み込めませんでした。時間をおいて開き直してください。</p>';
      });

    getJson("data/ranking.json").then(renderRanking, function () {});
    getJson("data/other.json").then(renderOther, function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
