// 作品ページのコメント欄。api/comments.php と話す。
// 自分が書いたコメントを消せるように、書き込むたびに作る削除キーをこのブラウザに残しておく。
(function () {
  "use strict";

  var API = "/api/comments.php";
  var $ = function (id) {
    return document.getElementById(id);
  };

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
      /* 保存できないときは削除ボタンが出ないだけ */
    }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function when(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600000);
    return d.getUTCFullYear() + "/" + pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()) + "(" + "日月火水木金土"[d.getUTCDay()] + ") " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }
  function randomKey() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map
      .call(a, function (b) {
        return (b < 16 ? "0" : "") + b.toString(16);
      })
      .join("");
  }
  function post(params) {
    var body = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      body.append(k, params[k]);
    });
    return fetch(API, { method: "POST", body: body, credentials: "same-origin" }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return { ok: false, message: "サーバーから正しい返事がありませんでした。" };
        })
        .then(function (j) {
          if (!j.ok) throw new Error(j.message || "うまくいきませんでした。");
          return j;
        });
    });
  }

  // ---------- 作品一覧のコメント数 ----------
  function fillCounts() {
    var els = document.querySelectorAll("[data-count-for]");
    if (!els.length) return;
    fetch(API + "?recent=1")
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var counts = (j && j.counts) || {};
        Array.prototype.forEach.call(els, function (el) {
          var n = counts[el.getAttribute("data-count-for")];
          if (n) el.textContent = "コメント" + n;
        });
      })
      .catch(function () {});
  }

  // ---------- コメント欄 ----------
  function initComments() {
    var sec = $("comments");
    if (!sec) return;
    var work = sec.getAttribute("data-work");
    var keys = load("narou:ckeys", {});
    var reported = load("narou:reported", {});
    var form = $("cForm");
    var msg = $("cMsg");
    var items = [];

    var savedName = load("narou:cname", "");
    if (savedName) form.name.value = savedName;

    function render() {
      $("cCount").textContent = items.length ? "（" + items.length + "）" : "";
      if (!items.length) {
        $("cList").innerHTML = '<p class="c-empty">まだコメントはありません。</p>';
        return;
      }
      $("cList").innerHTML = items
        .map(function (c) {
          var mine = !!keys[c.id];
          var body = esc(c.body).replace(/\n/g, "<br>");
          return (
            '<article class="c-item' + (mine ? " is-mine" : "") + '" id="c-' + c.no + '">' +
            '<div class="c-head"><span class="c-no">' + c.no + '</span>：<b class="c-name">' + esc(c.name) + '</b>：<time datetime="' + esc(c.at) + '">' + when(c.at) + '</time> <span class="c-uid">ID:' + esc(c.uid) + "</span></div>" +
            (c.sp ? '<details class="c-spoiler"><summary>ネタバレ（クリックで表示）</summary><p class="c-text">' + body + "</p></details>" : '<p class="c-text">' + body + "</p>") +
            '<div class="c-acts">' +
            (mine
              ? '<button type="button" data-act="delete" data-id="' + c.id + '">削除</button>'
              : reported[c.id]
              ? '<span class="c-done">通報しました</span>'
              : '<button type="button" data-act="report" data-id="' + c.id + '">通報</button>') +
            "</div></article>"
          );
        })
        .join("");
    }

    function refresh() {
      return fetch(API + "?work=" + encodeURIComponent(work), { cache: "no-store" })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          if (!j.ok) throw new Error(j.message);
          items = j.items || [];
          render();
        })
        .catch(function () {
          $("cList").innerHTML = '<p class="c-empty">コメントを読み込めませんでした。</p>';
        });
    }

    form.body.addEventListener("input", function () {
      $("cLen").textContent = form.body.value.length + " / 500";
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = form.body.value.trim();
      if (!body) {
        msg.textContent = "コメントを入力してください。";
        msg.className = "c-msg is-err";
        return;
      }
      var key = randomKey();
      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      msg.textContent = "書き込んでいます…";
      msg.className = "c-msg";
      post({
        action: "post",
        work: work,
        name: form.name.value.trim(),
        body: body,
        spoiler: form.spoiler.checked ? "1" : "",
        website: form.website.value,
        key: key,
      })
        .then(function (j) {
          keys[j.item.id] = key;
          save("narou:ckeys", keys);
          save("narou:cname", form.name.value.trim());
          form.body.value = "";
          form.spoiler.checked = false;
          $("cLen").textContent = "0 / 500";
          msg.textContent = "書き込みました。";
          items.push(j.item);
          render();
          if (window.gtag) window.gtag("event", "comment_post", { work: work });
        })
        .catch(function (err) {
          msg.textContent = err.message;
          msg.className = "c-msg is-err";
        })
        .then(function () {
          btn.disabled = false;
        });
    });

    $("cList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var id = b.getAttribute("data-id");
      var act = b.getAttribute("data-act");
      if (act === "delete" && !confirm("このコメントを削除しますか？")) return;
      if (act === "report" && !confirm("このコメントを不適切なものとして通報しますか？")) return;
      b.disabled = true;
      post({ action: act, work: work, id: id, key: keys[id] || "" })
        .then(function () {
          if (act === "delete") {
            delete keys[id];
            save("narou:ckeys", keys);
            items = items.filter(function (c) {
              return c.id !== id;
            });
          } else {
            reported[id] = 1;
            save("narou:reported", reported);
          }
          render();
        })
        .catch(function (err) {
          alert(err.message);
          b.disabled = false;
        });
    });

    refresh();
  }

  function init() {
    initComments();
    fillCounts();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
