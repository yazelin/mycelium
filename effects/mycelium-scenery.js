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
    if (el._mfxMounted) return; // 冪等：start() 可能被重複呼叫（例如動態插入新場景）
    var src = el.getAttribute('data-fx-src');
    if (!src) return;
    el._mfxMounted = true;
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

    var nMotes = num(el, 'data-fx-motes', 0, 0, 400) | 0;
    var nLeaves = num(el, 'data-fx-leaves', 0, 0, 60) | 0;
    var shade = num(el, 'data-fx-shade', 0, 0, 1) | 0;
    if (nMotes || nLeaves) buildParticles(el, nMotes, nLeaves);
    if (shade) buildShade(el);
  }

  function buildParticles(el, nMotes, nLeaves) {
    var c = document.createElement('canvas');
    c.className = 'mfx-scenery-canvas';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    var x = c.getContext('2d'), W = 0, H = 0,
        dpr = Math.min(global.devicePixelRatio || 1, 2), motes = [], leaves = [], t = 0, run = true;

    function size() {
      W = global.innerWidth; H = global.innerHeight;
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + 'px'; c.style.height = H + 'px';
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function mote(reset) {
      return { x: Math.random() * W, y: reset ? H * (0.75 + Math.random() * 0.25) : H + 8,
        r: 1.1 + Math.random() * 2.6, a: 0.22 + Math.random() * 0.42,
        vy: -(0.10 + Math.random() * 0.22), gp: Math.random() * 6.28, gs: 0.010 + Math.random() * 0.022 };
    }
    function leaf(reset) {
      return { x: Math.random() * W, y: reset ? Math.random() * H : -20,
        s: 4 + Math.random() * 4, a: 0.10 + Math.random() * 0.14,
        vy: 0.20 + Math.random() * 0.22, vx: -0.14 - Math.random() * 0.2,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.012 };
    }
    size(); global.addEventListener('resize', size);
    var i;
    for (i = 0; i < nMotes; i++) motes.push(mote(1));
    for (i = 0; i < nLeaves; i++) leaves.push(leaf(1));
    document.addEventListener('visibilitychange', function () { run = !document.hidden; if (run) tick(); });

    function tick() {
      if (!run) return;
      t++; x.clearRect(0, 0, W, H);
      for (var k = 0; k < motes.length; k++) {
        var m = motes[k]; m.y += m.vy; m.x += Math.sin(t * 0.006 + m.gp) * 0.09;
        if (m.y < H * 0.60) motes[k] = mote(0);
        var tw = 0.55 + 0.45 * Math.sin(t * m.gs + m.gp);
        var fade = Math.max(0, Math.min(1, (m.y - H * 0.60) / (H * 0.14)));
        var al = m.a * tw * fade;
        if (m.r > 2) {
          var gd = x.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 3.4);
          gd.addColorStop(0, 'rgba(255,254,246,' + (al * 0.5).toFixed(3) + ')');
          gd.addColorStop(1, 'rgba(255,254,246,0)');
          x.fillStyle = gd; x.beginPath(); x.arc(m.x, m.y, m.r * 3.4, 0, 6.284); x.fill();
        }
        x.beginPath(); x.arc(m.x, m.y, m.r, 0, 6.284);
        x.fillStyle = 'rgba(255,254,246,' + al.toFixed(3) + ')'; x.fill();
      }
      for (var j = 0; j < leaves.length; j++) {
        var l = leaves[j]; l.y += l.vy; l.x += l.vx + Math.sin(t * 0.004 + l.rot) * 0.35; l.rot += l.vr;
        if (l.y > H + 24 || l.x < -24) leaves[j] = leaf(0);
        x.save(); x.translate(l.x, l.y); x.rotate(l.rot); x.beginPath();
        x.ellipse(0, 0, l.s, l.s * 0.42, 0, 0, 6.284);
        x.fillStyle = 'rgba(104,122,84,' + l.a + ')'; x.fill(); x.restore();
      }
      requestAnimationFrame(tick);
    }
    tick();
  }

  function buildShade(el) {
    var d = document.createElement('div');
    d.className = 'mfx-scenery-shade';
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
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
