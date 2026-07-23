/*!
 * mycelium-scenery — 場景背景（捲動迫升 + 環境粒子）
 * 一張自帶天空的圖，用遮罩從畫面底部迫升；可選塵粒/落葉/雲影。
 * 宣告式：<div data-fx="scenery" data-fx-src="…" data-fx-anchor=".x" …>
 * MIT © 林亞澤
 */
(function (global) {
  'use strict';
  var reduce = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function num(el, attr, fallback, min, max) {
    var v = parseFloat(el.getAttribute(attr));
    if (isNaN(v)) return fallback;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  }

  function mount(el) {
    var src = el.getAttribute('data-fx-src');
    if (!src) return;
    var rise = num(el, 'data-fx-rise', 44, 0, 100);
    var anchorSel = el.getAttribute('data-fx-anchor');

    // 固定全視窗背景層；遮罩由 --rev 控制露出高度（由下往上）。
    var bg = document.createElement('div');
    bg.className = 'mfx-scenery-bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.style.backgroundImage = "url('" + src + "')";
    bg.style.setProperty('--rev', '0%');
    document.body.insertBefore(bg, document.body.firstChild);
    el._mfxBg = bg;

    var anchor = anchorSel && document.querySelector(anchorSel);
    // 減少動態：不是升到 rise 那個「捲到底」高度，是直接整張完全露出、無動畫。
    if (reduce) { bg.style.setProperty('--rev', '100%'); return; }
    if (!anchor) { bg.style.setProperty('--rev', rise + '%'); return; }

    function onScroll() {
      var r = anchor.getBoundingClientRect(), h = global.innerHeight;
      var t = Math.max(0, Math.min(1, (h - r.top) / (h * 0.8)));
      bg.style.setProperty('--rev', (t * rise).toFixed(2) + '%');
    }
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', onScroll);
    onScroll();
    el._mfxScroll = onScroll;
  }

  function start() {
    var list = document.querySelectorAll('[data-fx="scenery"]');
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  var ns = global.MyceliumFX = global.MyceliumFX || {};
  ns.scenery = { start: start };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})(window);
