// なろうランキングのページ。日間・週間などの切り替えと、大ジャンルでのしぼりこみ。
(function () {
  "use strict";
  var tabs = document.querySelectorAll(".rank-tabs [data-rank]");
  var panels = document.querySelectorAll(".rank-panel");
  var filters = document.querySelectorAll(".rank-filter [data-big]");
  var big = "";

  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll(".rank-row"), function (li) {
      li.hidden = !!big && li.getAttribute("data-big") !== big;
    });
  }
  Array.prototype.forEach.call(tabs, function (t) {
    t.addEventListener("click", function () {
      var id = t.getAttribute("data-rank");
      Array.prototype.forEach.call(tabs, function (x) {
        x.setAttribute("aria-selected", String(x === t));
      });
      Array.prototype.forEach.call(panels, function (p) {
        p.hidden = p.getAttribute("data-panel") !== id;
      });
    });
  });
  Array.prototype.forEach.call(filters, function (f) {
    f.addEventListener("click", function () {
      big = f.getAttribute("data-big");
      Array.prototype.forEach.call(filters, function (x) {
        x.classList.toggle("active", x === f);
      });
      apply();
    });
  });
})();
