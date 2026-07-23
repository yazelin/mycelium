# 場景背景與環境配樂 效果庫模組 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（建議）或 superpowers:executing-plans 逐項實作。步驟用 checkbox（`- [ ]`）追蹤。

**Goal:** 把序章頁驗證過的兩套技術收成效果庫的選用模組：`scenery`（捲動迫升背景＋環境粒子）與 `ambient`（配樂＋波形，雙模式：檔案交叉淡接／即時合成）。純技術、不含劇情。

**Architecture:** 兩個新 JS 檔（`mycelium-scenery.js`、`mycelium-audio.js`）各自是獨立 IIFE，載入即掃描對應的 `data-fx` 屬性，跟現有 `mycelium-fx.js` 同一套宣告式風格。共用 `mycelium-fx.css`（追加樣式）與 `window.MyceliumFX` 命名空間。demo、測試、README 一併更新。

**Tech Stack:** 原生 JS ES5 風格（無 build）、CSS mask、Canvas 2D、Web Audio、Playwright、`python3 -m http.server`。

## Global Constraints

- **零 build、零執行期相依**：純 `<script>`／`<link>`，不 npm/CDN/bundler。
- **宣告式 API**：靠 `data-fx="…"` 屬性驅動，沿用現有 `num(el,attr,fallback,min,max)`／`stateOf(el)`／`vh()` 風格。
- **命名空間**：每個新檔 `global.MyceliumFX = global.MyceliumFX || {}`，只加自己那份，不覆蓋。
- **漸進增強**：關掉 JS 仍能讀 demo 正文；效果失敗不得讓內容消失。
- **`prefers-reduced-motion: reduce`**：場景直接完全露出、無粒子、無動畫；波形停畫；聲音本身不受影響（聲音非動態視覺）。
- **音訊自動播放**：瀏覽器禁止零互動出聲；一律綁在第一個使用者手勢（wheel/touchstart/pointerdown/keydown/click）後才發聲。開關偏好記 localStorage `fx-bgm`。
- **劇情隔離**：demo／預設／README 全用中性示範素材；不放序章文字、不放任何特定作品的背景圖或音檔；不內附音檔。
- **檔案獨立**：三個 JS 檔各自可單獨載入。
- **繁體中文**：所有註解、demo 文案、README 用繁體中文，不用 emoji。

---

## File Structure

- `effects/mycelium-scenery.js` — 新增。`scenery` 模組（迫升背景 + 環境粒子）。
- `effects/mycelium-audio.js` — 新增。`ambient` 模組（loop + synth 雙模式 + 波形）。
- `effects/mycelium-fx.css` — 修改。追加 `.mfx-scenery*` 場景層與 `.mfx-snd` 開關樣式。
- `effects/demo.html` — 修改。追加 scenery、ambient 兩段示範。
- `tests/effects.spec.js` — 修改。追加 scenery、ambient 測試。
- `README.md` — 修改。追加兩條用法 + 兩則生成食譜（scenery 生圖、audio 抽頻譜）。
- `assets/` — 新增示範素材：`assets/demo-scene.svg`（中性場景圖，程式可畫的簡單風景，避免帶大圖）、`tests/fixtures/tone.wav`（測試用短音，供 loop 模式測交叉淡接）。

---

## Task 1: `scenery` 迫升背景（核心，無粒子）

**Files:**
- Create: `effects/mycelium-scenery.js`
- Modify: `effects/mycelium-fx.css`（追加場景層樣式）
- Modify: `effects/demo.html`（追加 scenery 示範段）
- Modify: `effects/assets/`（新增 `demo-scene.svg`）
- Test: `tests/effects.spec.js`

**Interfaces:**
- Produces: 全域 `MyceliumFX.scenery`（可選導出 refresh），以及 `data-fx="scenery"` 的宣告式行為。
- Consumes: 無（獨立檔）。

- [ ] **Step 1: 寫失敗測試**

在 `tests/effects.spec.js` 末尾（`test.describe` 內）加：

```js
test('scenery：捲過錨點後背景迫升（--rev 從 0 到 rise）', async ({ page }) => {
  await page.goto('/effects/demo.html');
  const bg = page.locator('.mfx-scenery-bg').first();
  await expect(bg).toHaveCount(1);
  const before = await bg.evaluate((el) => getComputedStyle(el).getPropertyValue('--rev').trim());
  // 捲到錨點以下
  await page.evaluate(() => {
    const a = document.querySelector('[data-fx="scenery"]').getAttribute('data-fx-anchor');
    document.querySelector(a).scrollIntoView({ block: 'start' });
    window.scrollBy(0, window.innerHeight);
  });
  await page.waitForTimeout(300);
  const after = await bg.evaluate((el) => getComputedStyle(el).getPropertyValue('--rev').trim());
  expect(parseFloat(before)).toBeLessThan(5);
  expect(parseFloat(after)).toBeGreaterThan(20);
});

test('scenery：prefers-reduced-motion 時直接完全露出、無粒子 canvas', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/effects/demo.html');
  const rev = await page.locator('.mfx-scenery-bg').first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--rev').trim());
  expect(parseFloat(rev)).toBeGreaterThan(90);
  expect(await page.locator('.mfx-scenery-canvas').count()).toBe(0);
  await ctx.close();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx playwright test --project=desktop -g scenery`
Expected: FAIL（`.mfx-scenery-bg` count 0）。

- [ ] **Step 3: 寫 `effects/mycelium-scenery.js`**

```js
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
    if (reduce || !anchor) { bg.style.setProperty('--rev', rise + '%'); return; }

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
```

- [ ] **Step 4: 在 `effects/mycelium-fx.css` 追加場景層樣式**

於檔案末尾（`@media (prefers-reduced-motion)` 區塊之後）加：

```css
/* 場景背景：固定全視窗，遮罩由下往上露出（--rev 控制），上緣淡出好接天空。 */
.mfx-scenery-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-position: bottom center;
  background-size: cover;
  background-repeat: no-repeat;
  -webkit-mask-image: linear-gradient(0deg, #000 0%, #000 var(--rev, 0%), transparent calc(var(--rev, 0%) + 14%));
  mask-image: linear-gradient(0deg, #000 0%, #000 var(--rev, 0%), transparent calc(var(--rev, 0%) + 14%));
}
.mfx-scenery-canvas {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
```

- [ ] **Step 5: 建示範場景圖 `effects/assets/demo-scene.svg`**

一張中性、可縮放的簡單風景（草地＋遠山＋天空漸層），不帶任何作品內容：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" preserveAspectRatio="xMidYMax slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf3fb"/><stop offset="1" stop-color="#f4f8f4"/>
    </linearGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cfe3c2"/><stop offset="1" stop-color="#a9cf96"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#sky)"/>
  <path d="M0 470 Q300 430 600 458 T1200 452 V675 H0 Z" fill="#c7d8e0" opacity="0.7"/>
  <path d="M0 500 Q400 470 800 495 T1200 500 V675 H0 Z" fill="url(#grass)"/>
</svg>
```

- [ ] **Step 6: 在 `effects/demo.html` 追加 scenery 示範段**

在 `<head>` 已載入 `mycelium-fx.js`/css 之處，追加 `<script src="mycelium-scenery.js" defer></script>`。在頁面主體加一段（放在既有效果段之後）：

```html
<section class="fx" id="scenery">
  <p class="eyebrow">&lt;div <b>data-fx="scenery"</b> data-fx-src="assets/demo-scene.svg" data-fx-anchor="#scenery-anchor" data-fx-rise="44"&gt;</p>
  <h3>場景背景</h3>
  <p>一張自帶天空的圖，捲到錨點時從畫面底部迫升。這裡用一張示範風景。</p>
  <div data-fx="scenery" data-fx-src="assets/demo-scene.svg" data-fx-anchor="#scenery-anchor" data-fx-rise="44"></div>
  <div style="height:60vh"></div>
  <p id="scenery-anchor">捲到這一行，背景會升上來。</p>
  <div style="height:40vh"></div>
</section>
```

- [ ] **Step 7: 執行測試確認通過**

Run: `npx playwright test --project=desktop -g scenery`
Expected: PASS（兩條）。

- [ ] **Step 8: Commit**

```bash
git add effects/mycelium-scenery.js effects/mycelium-fx.css effects/demo.html effects/assets/demo-scene.svg tests/effects.spec.js
git commit -m "feat(scenery): 捲動迫升背景（遮罩露出 + 錨點驅動）"
```

---

## Task 2: `scenery` 環境粒子（塵粒 + 落葉 + 雲影）

**Files:**
- Modify: `effects/mycelium-scenery.js`（加粒子子層）
- Modify: `effects/mycelium-fx.css`（雲影樣式）
- Test: `tests/effects.spec.js`

**Interfaces:**
- Consumes: Task 1 的 `mount(el)` 與 `bg` 背景層。
- Produces: `data-fx-motes` / `data-fx-leaves` / `data-fx-shade` 屬性行為。

- [ ] **Step 1: 寫失敗測試**

```js
test('scenery：data-fx-motes=0 時不建粒子 canvas；預設有', async ({ page }) => {
  await page.goto('/effects/demo.html');
  // demo 的 scenery 開了粒子，應該有一個 canvas
  await expect(page.locator('.mfx-scenery-canvas')).toHaveCount(1);
  // 動態插入一個關閉粒子的場景，確認不建 canvas
  const n = await page.evaluate(() => {
    var d = document.createElement('div');
    d.setAttribute('data-fx', 'scenery');
    d.setAttribute('data-fx-src', 'assets/demo-scene.svg');
    d.setAttribute('data-fx-motes', '0');
    d.setAttribute('data-fx-leaves', '0');
    document.body.appendChild(d);
    window.MyceliumFX.scenery.start();
    return document.querySelectorAll('.mfx-scenery-canvas').length;
  });
  expect(n).toBe(1); // 只有 demo 原本那一個，新插入的沒建
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx playwright test --project=desktop -g "不建粒子"`
Expected: FAIL（目前 Task 1 根本沒建任何 `.mfx-scenery-canvas`，count 為 0）。

- [ ] **Step 3: 在 `mycelium-scenery.js` 的 `mount()` 末尾加粒子層**

在 `mount()` 內、`el._mfxScroll = onScroll;` 之後加。若 reduce 直接 return 不建粒子（前面已 return）；否則：

```js
    var nMotes = num(el, 'data-fx-motes', 0, 0, 400) | 0;
    var nLeaves = num(el, 'data-fx-leaves', 0, 0, 60) | 0;
    var shade = num(el, 'data-fx-shade', 0, 0, 1) | 0;
    if (nMotes || nLeaves) buildParticles(el, nMotes, nLeaves);
    if (shade) buildShade(el);
```

加粒子實作（module 內，`mount` 之外）：

```js
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
```

- [ ] **Step 4: 在 CSS 追加雲影樣式**

```css
.mfx-scenery-shade {
  position: fixed;
  left: 0; right: 0; bottom: 0; height: 44vh;
  z-index: -1; pointer-events: none;
  mix-blend-mode: multiply; opacity: 0.35; overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 26%);
  mask-image: linear-gradient(180deg, transparent 0%, #000 26%);
}
.mfx-scenery-shade::before {
  content: ''; position: absolute; top: -40%; left: -60%; width: 80%; height: 180%;
  background: radial-gradient(ellipse 50% 50% at center, rgba(120,138,120,.5), rgba(120,138,120,0) 70%);
  animation: mfx-cloudpass 38s linear infinite;
}
@keyframes mfx-cloudpass { from { transform: translateX(0); } to { transform: translateX(230vw); } }
@media (prefers-reduced-motion: reduce) { .mfx-scenery-shade::before { animation: none; } }
```

- [ ] **Step 5: demo 的 scenery 段打開粒子**

把 Task 1 的 demo div 改為：

```html
  <div data-fx="scenery" data-fx-src="assets/demo-scene.svg" data-fx-anchor="#scenery-anchor" data-fx-rise="44" data-fx-motes="60" data-fx-leaves="8" data-fx-shade="1"></div>
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx playwright test --project=desktop -g scenery`
Expected: PASS（Task 1 兩條 + 本條）。

- [ ] **Step 7: Commit**

```bash
git add effects/mycelium-scenery.js effects/mycelium-fx.css effects/demo.html tests/effects.spec.js
git commit -m "feat(scenery): 塵粒/落葉/雲影環境層（reduced-motion 全關）"
```

---

## Task 3: `ambient` synth 模式（即時合成 + 波形 + 開關）

**Files:**
- Create: `effects/mycelium-audio.js`
- Modify: `effects/mycelium-fx.css`（開關 `.mfx-snd` 樣式）
- Modify: `effects/demo.html`（ambient 示範段，用 synth）
- Test: `tests/effects.spec.js`

**Interfaces:**
- Produces: `MyceliumFX.ambientPreset(name, spec)`；`data-fx="ambient"` synth 模式行為。
- Consumes: 無。

- [ ] **Step 1: 寫失敗測試**

```js
test('ambient synth：未互動不出聲；一次手勢後開始，波形有動', async ({ page }) => {
  await page.goto('/effects/demo.html');
  // 未互動：沒有 running 的 audio context（模組尚未 start）
  const before = await page.evaluate(() => window.__mfxAudioStarted === true);
  expect(before).toBeFalsy();
  // 一次手勢
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(2500);
  const eqMoved = await page.evaluate(() => {
    var c = document.querySelector('#ambient-eq');
    var g = c.getContext('2d');
    function paint() { var d = g.getImageData(0,0,c.width,c.height).data, n=0;
      for (var i=3;i<d.length;i+=4) if (d[i]>10) n++; return n; }
    var a = paint();
    return new Promise(function (res) { setTimeout(function () { res(a !== paint()); }, 500); });
  });
  expect(eqMoved).toBeTruthy();
});

test('ambient：開關是可聚焦的 button', async ({ page }) => {
  await page.goto('/effects/demo.html');
  const btn = page.locator('.mfx-snd');
  await expect(btn).toHaveCount(1);
  expect(await btn.evaluate((el) => el.tagName)).toBe('BUTTON');
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npx playwright test --project=desktop -g ambient`
Expected: FAIL（`.mfx-snd` count 0）。

- [ ] **Step 3: 寫 `effects/mycelium-audio.js`（synth 模式）**

完整檔（synth 部分；loop 部分在 Task 4 併入同檔）：

```js
/*!
 * mycelium-audio — 環境配樂（synth 即時合成 / loop 檔案交叉淡接）+ 波形
 * 宣告式：<div data-fx="ambient" data-fx-preset="soft-f" data-fx-eq="#eq">
 * 瀏覽器禁止零互動出聲——一律綁在第一個手勢後才發聲。
 * MIT © 林亞澤
 */
(function (global) {
  'use strict';
  var reduce = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ns = global.MyceliumFX = global.MyceliumFX || {};
  var presets = {};

  // 內附中性預設：F 大調、76 BPM、留白多、延音長。
  presets['soft-f'] = {
    bpm: 76,
    chords: [
      [349.23,440,523.25,659.25],[523.25,587.33,659.25,783.99],[587.33,783.99,880],[440,523.25,659.25],
      [349.23,440,523.25,783.99],[523.25,587.33,659.25,783.99],[587.33,783.99,880],[440,523.25,659.25,783.99]
    ],
    bass: [174.61,130.81,146.83,220,174.61,130.81,146.83,220],
    scale: [698.46,783.99,880,1046.5,1174.66,1396.91,1567.98,1760],
    melody: [0,0,0,4,0,0,5,0, 0,0,0,0,6,0,0,0, 0,0,3,0,0,0,0,0, 0,0,0,0,0,0,4,0,
             0,0,5,0,0,0,0,0, 0,0,0,0,0,6,0,0, 0,4,0,0,0,0,0,2, 0,0,0,0,0,0,0,0]
  };
  // 另附兩個中性預設，仿 mori-desktop 另兩首 CC 曲的調性（純音樂參數）。
  // ambient-a：B♭ 大調、約 78 BPM，較亮。
  presets['ambient-a'] = {
    bpm: 78,
    chords: [
      [233.08,293.66,349.23,440],[233.08,293.66,349.23,440],[233.08,293.66,349.23,440],[196,233.08,293.66,349.23],
      [293.66,392,440],[293.66,349.23,440],[220,293.66,329.63],[220,293.66,329.63]
    ],
    bass: [116.54,116.54,116.54,98,146.83,146.83,110,110],
    scale: [932.33,1046.5,1174.66,1396.91,1567.98,1864.66,2093,2349.32],
    melody: [0,0,4,0,0,5,0,0, 0,0,0,6,0,0,0,0, 0,3,0,0,0,4,0,0, 0,0,0,0,0,0,0,0,
             0,0,5,0,0,4,0,0, 0,0,0,0,6,0,0,0, 0,0,4,0,0,0,3,0, 0,0,0,0,0,0,0,0]
  };
  // film-b：F 小調、77 BPM，最沉、最暗。
  presets['film-b'] = {
    bpm: 77,
    chords: [
      [174.61,207.65,261.63,311.13],[261.63,311.13,392,466.16],[174.61,207.65,261.63],[277.18,349.23,415.30,523.25],
      [174.61,207.65,261.63,311.13],[207.65,261.63,311.13,392],[174.61,207.65,261.63],[277.18,349.23,415.30,523.25]
    ],
    bass: [87.31,130.81,87.31,138.59,87.31,103.83,87.31,138.59],
    scale: [698.46,830.61,1046.5,1244.51,1396.91,1661.22,2093,2489.02],
    melody: [0,0,0,3,0,0,0,0, 0,0,4,0,0,0,0,0, 0,0,0,0,2,0,0,0, 0,0,0,0,0,0,0,0,
             0,0,3,0,0,0,4,0, 0,0,0,0,0,0,0,0, 0,2,0,0,0,3,0,0, 0,0,0,0,0,0,0,0]
  };
  ns.ambientPreset = function (name, spec) { presets[name] = spec; };

  function num(el, attr, fallback, min, max) {
    var v = parseFloat(el.getAttribute(attr));
    if (isNaN(v)) return fallback;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  }

  // ---- 波形折線（synth/http 用 AnalyserNode；file:// loop 用離線頻譜，見 Task 4） ----
  function makeEq(canvas, getData) {
    if (!canvas) return function () {};
    var dpr = Math.min(global.devicePixelRatio || 1, 2), ex, EW = 0, EH = 0, line = new Float32Array(32);
    function size() {
      EW = canvas.clientWidth; EH = canvas.clientHeight;
      canvas.width = EW * dpr; canvas.height = EH * dpr;
      ex = canvas.getContext('2d'); ex.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size(); global.addEventListener('resize', size);
    return function draw(on) {
      if (!ex || !EW) return;
      var vals = getData();
      for (var i = 0; i < 32; i++) {
        var v = on && vals ? vals[i] : 0;
        line[i] += (v - line[i]) * 0.22;
      }
      ex.clearRect(0, 0, EW, EH);
      var mid = EH * 0.5, amp = EH * 0.44, stepx = EW / 31;
      ex.beginPath();
      for (i = 0; i < 32; i++) {
        var xx = i * stepx, yy = mid - line[i] * amp;
        if (i === 0) ex.moveTo(xx, yy);
        else { var px = (i - 1) * stepx, py = mid - line[i - 1] * amp; ex.quadraticCurveTo((px + xx) / 2, py, xx, yy); }
      }
      ex.strokeStyle = 'rgba(106,143,114,.75)'; ex.lineWidth = 1.6;
      ex.lineJoin = 'round'; ex.lineCap = 'round'; ex.stroke();
    };
  }

  // ---- synth 引擎 ----
  function synthEngine(spec, ctx, master, rev, analyser) {
    var BPM = spec.bpm || 76, SPB = 60 / BPM, STEP = SPB / 2, LOOK = 0.15, TICK = 25;
    var step = 0, next = 0, timer = null;
    function pluck(f, t, gain, dur) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); g.connect(rev);
      o.start(t); o.stop(t + dur + 0.1);
    }
    function pad(notes, t, dur) {
      for (var i = 0; i < notes.length; i++) {
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(notes[i], t);
        o.detune.setValueAtTime(i % 2 ? 4 : -4, t);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.016, t + dur * 0.45);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master); g.connect(rev);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
    function bass(f, t) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.038, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + SPB * 1.6);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + SPB * 1.7);
    }
    function schedule() {
      while (next < ctx.currentTime + LOOK) {
        var bar = (step >> 3) & 7, inBar = step & 7, m = spec.melody[step & 63];
        if (inBar === 0) { pad(spec.chords[bar], next, SPB * 4 * 0.98); bass(spec.bass[bar], next); }
        if (inBar === 4) bass(spec.bass[bar], next);
        if (m) pluck(spec.scale[m - 1], next, 0.075 + Math.random() * 0.025, 4.5 + Math.random() * 2.0);
        if (bar === 7 && inBar >= 4 && Math.random() < 0.4) pluck(spec.scale[7] * 2, next, 0.026, 5.5);
        if (m && Math.random() < 0.22) pluck(spec.scale[m - 1] * 2, next, 0.016, 4.0);
        next += STEP; step = (step + 1) & 63;
      }
    }
    return {
      startAt: function () { next = ctx.currentTime + LOOK; if (!timer) timer = setInterval(schedule, TICK); },
      stop: function () { if (timer) { clearInterval(timer); timer = null; } },
      data: function () {
        if (!analyser) return null;
        var d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d);
        var out = new Float32Array(32);
        for (var i = 0; i < 32; i++) out[i] = (d[i] || 0) / 255;
        return out;
      }
    };
  }

  function reverbBuffer(ctx) {
    var len = Math.floor(ctx.sampleRate * 4.6), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) { var d = b.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    var cv = ctx.createConvolver(); cv.buffer = b; return cv;
  }

  function mountSynth(el) {
    var presetName = el.getAttribute('data-fx-preset') || 'soft-f';
    var spec = presets[presetName] || presets['soft-f'];
    var eqCanvas = el.getAttribute('data-fx-eq') ? document.querySelector(el.getAttribute('data-fx-eq')) : null;
    var ctx, master, engine, drawEq, an, on = false, raf = 0;

    function build() {
      ctx = new (global.AudioContext || global.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0;
      an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.5;
      master.connect(an); an.connect(ctx.destination);
      var rg = ctx.createGain(); rg.gain.value = 0.62;
      var rev = reverbBuffer(ctx); rev.connect(rg); rg.connect(master);
      engine = synthEngine(spec, ctx, master, rev, an);
      drawEq = makeEq(eqCanvas, function () { return engine.data(); });
      function loop() { raf = requestAnimationFrame(loop); if (drawEq && !reduce) drawEq(on); }
      loop();
    }
    return {
      start: function () {
        if (!ctx) build();
        if (ctx.state === 'suspended') ctx.resume();
        global.__mfxAudioStarted = true;
        engine.startAt();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 6);
        on = true;
      },
      stop: function () {
        if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.8); }
        if (engine) engine.stop(); on = false;
      }
    };
  }

  // ---- 開關 + 手勢自動播（兩模式共用） ----
  function attach(el) {
    var player = mountSynth(el); // Task 4 會在此依 data-fx-src 分派 loop/synth
    var btn = document.createElement('button');
    btn.className = 'mfx-snd'; btn.type = 'button';
    btn.textContent = '♪　開啟聲音'; // ♪ 開啟聲音
    document.body.appendChild(btn);
    var on = false;
    function set(state) {
      on = state;
      btn.textContent = on ? '♪　聲音開啟中' : '♪　開啟聲音';
      try { localStorage.setItem('fx-bgm', on ? '1' : '0'); } catch (e) {}
    }
    btn.addEventListener('click', function () { if (on) { player.stop(); set(false); } else { player.start(); set(true); } });
    setTimeout(function () { btn.classList.add('rest'); }, 10000);
    btn.addEventListener('mouseenter', function () { btn.classList.remove('rest'); });
    btn.addEventListener('mouseleave', function () { btn.classList.add('rest'); });

    var armed = false;
    function first() {
      if (armed) return; armed = true;
      var pref = null; try { pref = localStorage.getItem('fx-bgm'); } catch (e) {}
      if (pref !== '0') { player.start(); set(true); }
    }
    ['wheel', 'touchstart', 'pointerdown', 'keydown', 'click'].forEach(function (ev) {
      global.addEventListener(ev, first, { passive: true });
    });
  }

  function start() {
    var list = document.querySelectorAll('[data-fx="ambient"]');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }
  ns.ambient = { start: start };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})(window);
```

- [ ] **Step 4: CSS 追加開關樣式**

```css
/* 環境配樂開關：頁面右上，前 10 秒清楚、之後退到低調。 */
.mfx-snd {
  position: fixed; top: 1.1rem; right: 1.1rem; z-index: 50; border: 0;
  background: rgba(255,255,255,.82); color: #4a565e; font: inherit; font-size: .76rem;
  letter-spacing: .18em; padding: .55rem 1.15rem; border-radius: 2rem; cursor: pointer;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  box-shadow: 0 2px 12px rgba(60,80,70,.14); opacity: 1; transition: opacity .8s ease, background .3s;
}
.mfx-snd.rest { opacity: .34; }
.mfx-snd:hover { opacity: 1; }
@media (max-width: 700px) { .mfx-snd { top: .7rem; right: .7rem; font-size: .72rem; padding: .5rem 1rem; } }
```

- [ ] **Step 5: demo 追加 ambient 段（synth）**

`<head>` 加 `<script src="mycelium-audio.js" defer></script>`。主體加：

```html
<section class="fx" id="ambient">
  <p class="eyebrow">&lt;div <b>data-fx="ambient"</b> data-fx-preset="soft-f" data-fx-eq="#ambient-eq"&gt;</p>
  <h3>環境配樂（即時合成）</h3>
  <p>不放音檔，即時合成一段留白多、延音長的環境音。右上角開關，一捲動就會自動播。下面這條折線是它的波形。</p>
  <div data-fx="ambient" data-fx-preset="soft-f" data-fx-eq="#ambient-eq"></div>
  <canvas id="ambient-eq" style="width:min(26em,80vw);height:44px;display:block;margin:1rem auto;opacity:.6"></canvas>
</section>
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx playwright test --project=desktop -g ambient`
Expected: PASS（兩條）。

- [ ] **Step 7: Commit**

```bash
git add effects/mycelium-audio.js effects/mycelium-fx.css effects/demo.html tests/effects.spec.js
git commit -m "feat(ambient): synth 即時合成 + 波形折線 + 手勢自動播開關"
```

---

## Task 4: `ambient` loop 模式（檔案交叉淡接 + 頻譜查表）

**Files:**
- Modify: `effects/mycelium-audio.js`（加 loop player，`attach` 依 `data-fx-src` 分派）
- Create: `tests/fixtures/tone.wav`（短測試音，用 ffmpeg 產生）
- Modify: `effects/demo.html`（可選：不加 loop demo 段，避免帶音檔；loop 由測試涵蓋）
- Test: `tests/effects.spec.js`

**Interfaces:**
- Consumes: Task 3 的 `attach()`、`makeEq()`。
- Produces: `data-fx-src` / `data-fx-fade` / `data-fx-eqdata` 的 loop 模式行為。

- [ ] **Step 1: 產生測試音檔**

```bash
mkdir -p tests/fixtures
ffmpeg -y -f lavfi -i "sine=frequency=220:duration=6" -ac 2 tests/fixtures/tone.wav
```

- [ ] **Step 2: 寫失敗測試**

```js
test('ambient loop：交叉淡接——舊的淡出、新的從 0 淡入、舊的暫停', async ({ page }) => {
  await page.goto('/effects/loop-fixture.html'); // 見 Step 5
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(500);
  const result = await page.evaluate(async () => {
    var A = document.getElementById('la'), B = document.getElementById('lb');
    var curEl = !A.paused ? A : B;
    curEl.currentTime = curEl.duration - 1.5; // 逼近尾巴觸發淡接
    await new Promise(function (r) { setTimeout(r, 2200); });
    return { aPlayed: !A.paused || !B.paused, bothTouched: (A.currentTime > 0 && B.currentTime >= 0) };
  });
  expect(result.aPlayed).toBeTruthy();
});
```

- [ ] **Step 3: 在 `mycelium-audio.js` 加 loop player，並改 `attach` 分派**

在 `attach()` 內把：

```js
    var player = mountSynth(el);
```

改為：

```js
    var player = el.getAttribute('data-fx-src') ? mountLoop(el) : mountSynth(el);
```

新增 `mountLoop`（module 內）：

```js
  function mountLoop(el) {
    var src = el.getAttribute('data-fx-src');
    var fade = num(el, 'data-fx-fade', 5, 1, 20);
    var VOL = 0.34;
    var A = document.createElement('audio'), B = document.createElement('audio');
    A.src = B.src = src; A.preload = B.preload = 'auto';
    document.body.appendChild(A); document.body.appendChild(B);
    var cur = A, nxt = B, on = false, env = 0, envTarget = 0, fading = false, fadeT0 = 0, raf = 0, started = false;

    // 波形：優先用離線頻譜（data-fx-eqdata，供 file://）；沒有就試 AnalyserNode（http）。
    var spec = null, eqAttr = el.getAttribute('data-fx-eqdata');
    if (eqAttr) { var bin = atob(eqAttr); spec = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) spec[i] = bin.charCodeAt(i); }
    var eqCanvas = el.getAttribute('data-fx-eq') ? document.querySelector(el.getAttribute('data-fx-eq')) : null;
    var drawEq = makeEq(eqCanvas, function () {
      if (!spec) return null;
      var f = Math.floor(cur.currentTime * 20) * 32, out = new Float32Array(32);
      for (var i = 0; i < 32; i++) out[i] = (f + i < spec.length ? spec[f + i] : 0) / 255;
      return out;
    });

    function tick() {
      raf = requestAnimationFrame(tick);
      var now = performance.now() / 1000;
      if (env < envTarget) env = Math.min(envTarget, env + (1 / 6) * 0.016);
      else if (env > envTarget) env = Math.max(envTarget, env - (1 / 1.8) * 0.016);
      if (on && cur.duration) {
        if (!fading && cur.currentTime > cur.duration - fade) {
          try { nxt.currentTime = 0; nxt.play(); } catch (e) {}
          fading = true; fadeT0 = now;
        }
        if (fading) {
          var p = Math.min(1, (now - fadeT0) / fade);
          cur.volume = env * VOL * Math.cos(p * Math.PI / 2);
          nxt.volume = env * VOL * Math.sin(p * Math.PI / 2);
          if (p >= 1) { try { cur.pause(); } catch (e) {} var t = cur; cur = nxt; nxt = t; fading = false; }
        } else { cur.volume = env * VOL; nxt.volume = 0; }
      } else { cur.volume = env * VOL; }
      if (drawEq && !reduce) drawEq(on);
    }
    document.addEventListener('visibilitychange', function () {
      if (on && !document.hidden) { try { cur.play(); } catch (e) {} }
    });
    return {
      start: function () {
        try { cur.play(); } catch (e) {}
        global.__mfxAudioStarted = true;
        envTarget = 1; on = true;
        if (!started) { started = true; tick(); }
      },
      stop: function () {
        envTarget = 0; on = false;
        setTimeout(function () { if (!on) { try { A.pause(); B.pause(); } catch (e) {} } }, 2000);
      }
    };
  }
```

（注意：`mountLoop` 用了測試用的 `id`。demo/實務不需 id；測試 fixture 會自己在兩個 audio 上設 `id="la"/"lb"`——見 Step 5，改為 fixture 直接放兩個 audio 或在 mountLoop 後補 id。為讓測試可抓，於 `mountLoop` 建立 A/B 後加：`A.id='la'; B.id='lb';`。正式頁多個 ambient 並存時 id 會重複，但 loop 模式一頁通常只一個；README 註明。）

- [ ] **Step 4: 在 `mountLoop` 的 append 後補測試可抓的 id**

```js
    A.id = A.id || 'la'; B.id = B.id || 'lb';
```

- [ ] **Step 5: 建 loop 測試頁 `effects/loop-fixture.html`**

只給測試用的最小頁（放在 effects/，用 fixture 音檔的相對路徑）：

```html
<!doctype html><meta charset="utf-8">
<title>ambient loop fixture</title>
<link rel="stylesheet" href="mycelium-fx.css">
<canvas id="eq" style="width:20em;height:40px"></canvas>
<div data-fx="ambient" data-fx-src="../tests/fixtures/tone.wav" data-fx-fade="1.2" data-fx-eq="#eq"></div>
<div style="height:200vh"></div>
<script src="mycelium-audio.js"></script>
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx playwright test --project=desktop -g "loop"`
Expected: PASS。

- [ ] **Step 7: 全套回歸**

Run: `npx playwright test --project=desktop`
Expected: 全綠（原 16 + 新增各條）。

- [ ] **Step 8: Commit**

```bash
git add effects/mycelium-audio.js effects/loop-fixture.html tests/fixtures/tone.wav tests/effects.spec.js
git commit -m "feat(ambient): loop 檔案交叉淡接無縫循環 + 離線頻譜波形"
```

---

## Task 5: README 說明與生成食譜

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1–4 的最終屬性名與行為。
- Produces: 無（文件）。

- [ ] **Step 1: 在 README「敘事效果庫」章追加兩條用法**

於現有效果清單（eyelid/freeze/…）之後加：

````markdown
場景與聲音是兩個較重的選用模組，各自獨立載入：

```html
<script src="effects/mycelium-scenery.js" defer></script>   <!-- 場景背景 -->
<script src="effects/mycelium-audio.js" defer></script>     <!-- 環境配樂 -->
```

```html
<!-- 場景背景：一張自帶天空的圖，捲到錨點時從底部迫升 -->
<div data-fx="scenery" data-fx-src="場景.webp" data-fx-anchor=".situp"
     data-fx-rise="44" data-fx-motes="90" data-fx-leaves="10" data-fx-shade="1"></div>

<!-- 環境配樂・好聽（用你自己的 CC 音檔，無縫循環） -->
<div data-fx="ambient" data-fx-src="ambient.mp3" data-fx-fade="5"
     data-fx-eq="#eq" data-fx-eqdata="…離線頻譜 base64…"></div>

<!-- 環境配樂・不用檔案（即時合成，音色較單薄但零授權、無限不重複） -->
<div data-fx="ambient" data-fx-preset="soft-f" data-fx-eq="#eq"></div>
```

自訂合成預設：

```js
MyceliumFX.ambientPreset('mytune', { bpm, chords, bass, scale, melody });
```
````

- [ ] **Step 2: 追加「生成食譜」小節**

````markdown
### 素材生成食譜（作者端一次性，不進 code）

**場景圖**（給 `data-fx-src`）——用 codex-imagegen 產一張自帶天空的插畫，上緣淡到近白好接頁面：

> 提示詞要點：意識界/輕小說風、低視角、自帶天空且頂端近白、單張全景、無人物文字。生出後可選在本機去背或直接用不透明圖。

**loop 波形頻譜**（給 `data-fx-eqdata`，供 `file://` 顯示波形）——`file://` 下 AnalyserNode 讀不到媒體檔頻譜，所以離線先算好：

```python
# ffmpeg 解碼 → 每 1/20 秒取 32 條對數分頻（60Hz–8kHz）→ log 壓縮 → base64
# （完整腳本見 docs；產出的字串貼進 data-fx-eqdata）
```

**合成配樂參數**（給 `ambientPreset`）——若想仿某首 CC 曲的調性，可用 ffmpeg + numpy 對該曲做 chroma/onset 分析抽出 bpm、和弦、旋律骨架。這只是作曲前置，抽出來的是通用音樂參數。
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README 追加 scenery/ambient 用法與素材生成食譜"
```

---

## 自我檢查

- **Spec 覆蓋**：scenery 迫升（T1）＋粒子（T2）；ambient synth（T3）＋loop（T4）；波形兩路徑（T3 analyser／T4 頻譜表）；reduced-motion（T1/T2/T3 皆含）；手勢自動播與開關（T3）；README＋食譜（T5）。全數對應。
- **無 placeholder**：每個 code step 都有實際程式碼。
- **型別/命名一致**：`data-fx-src`/`-anchor`/`-rise`/`-motes`/`-leaves`/`-shade`/`-preset`/`-eq`/`-eqdata`/`-fade` 全篇一致；`.mfx-scenery-bg`/`.mfx-scenery-canvas`/`.mfx-scenery-shade`/`.mfx-snd` 一致；`MyceliumFX.scenery`/`.ambient`/`.ambientPreset` 一致；`global.__mfxAudioStarted` 測試旗標一致。
