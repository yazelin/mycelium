/*!
 * mycelium-fx — 敘事效果庫（捲動驅動）
 * 讓頁面本身參與說故事：讀者不是讀到世界在劣化，是他的畫面在劣化。
 *
 * 零依賴、無 build。以 data-fx 屬性驅動：
 *   <section data-fx="eyelid">
 *   <p data-fx="freeze" data-fx-ms="300">
 *   <div data-fx="drag" data-fx-factor="2.5">
 *   <div data-fx="afterimage" data-fx-opacity="0.035">
 *   <p data-fx="scramble" data-fx-level="0.3">
 *   <p data-fx="stutter" data-fx-times="3">
 *
 * 硬性原則（不要在調參數時破壞掉）：
 *   1. prefers-reduced-motion: reduce → 全部效果關閉，內容完整可讀。
 *   2. 鍵盤捲動與捲軸拖曳絕不攔截；只攔 wheel / touchmove。
 *   3. 關掉 JS 也要能讀完整篇：所有效果都是這支腳本加上去的。
 *   4. scramble 的 DOM 一定是原文，亂序只做視覺位移。
 *   5. freeze 是「上膛→擊發」：進入視窗只上膛，下一次捲動輸入才擊發。
 *   6. 任何需要讀者主動輸入才會前進的效果，都必須同時有「提示」與
 *      「自動前進的保險」——目前只有 eyelid 屬於這類（見 #37）。
 *      加新效果時如果它也需要讀者動作才繼續，這條規則一樣適用。
 *
 * MIT © 林亞澤
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'mycelium-fx:off';

  // ---- 預設參數 --------------------------------------------------------
  // 這些數字是「手感」不是「架構」，示範頁 effects/demo.html 可以即時調。
  var config = {
    // 阻力：捲動輸入除以 factor。1 = 沒感覺，3 = 上限（再高就變成壞掉而不是重）。
    dragFactor: 1.8,
    dragFactorMax: 3,
    // 手機不能直接沿用桌機倍率：接管 touchmove 會殺掉原生慣性，
    // 同樣的倍率在手機上會被讀成「卡住」而不是「重」。折半再加回一點慣性。
    dragTouchRatio: 0.55,
    touchInertiaMs: 420,

    // 凍結：預設落在知覺門檻底下——讀者不該「發現」畫面停了，
    // 應該是身體先知道（推了一下，世界沒動）。
    freezeMs: 240,
    freezeMsMax: 3000,
    // 手機的捲動本來就有黏滯感，同樣毫秒數體感更長，縮一點。
    freezeTouchScale: 0.8,
    // 剛載入不准擊發：要等頁面靜下來，而且要等讀者真的動過一次。
    armDelayMs: 800,

    // 殘影：固定不動的內容複本，低到幾乎看不見，只在餘光裡。
    afterimageOpacity: 0.035,
    afterimageLag: 0.055, // 每幀追上真實位置的比例，越小拖得越久

    // 睜眼：一條縫（vh）→ 捲動 openVh 後全開。
    eyelidSlitVh: 10,
    eyelidOpenVh: 70,
    // 讀者不動的話：先給提示，再自己緩緩展開（#37）。
    // 任何一次捲動輸入都會立刻接管、蓋掉這整段時間軸。
    eyelidHintDelayMs: 2500,      // 縫下方浮出向下 chevron 的延遲
    eyelidAutoOpenDelayMs: 7000,  // 開始自動展開的延遲
    eyelidAutoOpenDurationMs: 3200, // 自動展開本身要跑多久（呼吸速度，非瞬開）

    // 亂序：被交換位置的相鄰字對比例。
    scrambleLevel: 0.25,
    scrambleLevelMax: 0.6,

    // 重複：含本體共出現幾次。
    stutterTimes: 3,
  };

  // ---- 環境判斷 --------------------------------------------------------
  var reduceMotion = false;
  try {
    reduceMotion = global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 老瀏覽器：當作沒有偏好 */ }

  function storedOff() {
    try { return global.localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (e) { return false; }
  }
  function storeOff(off) {
    try {
      if (off) global.localStorage.setItem(STORAGE_KEY, '1');
      else global.localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 無痕模式等：記不起來就算了，不影響閱讀 */ }
  }

  var userOff = storedOff();
  function active() { return !reduceMotion && !userOff; }

  // ---- 狀態 ------------------------------------------------------------
  var states = new Map();   // element -> state object
  var armed = [];           // 已上膛的 freeze 元素
  var frozenUntil = 0;      // 凍結解除的時間戳
  var dragActive = null;    // 目前生效的 drag 元素
  var hasScrolled = false;  // 讀者是否已經動過（鍵盤也算）
  var settled = false;      // 載入後是否已過緩衝期
  var started = false;
  var rafPending = false;
  var ghostRaf = 0;

  function num(el, attr, fallback, min, max) {
    var raw = el.getAttribute(attr);
    var v = raw === null || raw === '' ? fallback : parseFloat(raw);
    if (!isFinite(v)) v = fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function stateOf(el) {
    var s = states.get(el);
    if (!s) { s = { kind: el.getAttribute('data-fx'), fired: false }; states.set(el, s); }
    return s;
  }

  function vh() { return global.innerHeight || document.documentElement.clientHeight; }

  // =====================================================================
  // drag 阻力
  // =====================================================================
  // 區域屬性，不是計時事件：只要視窗中線落在這個區域內就變重。
  // 所以天生免疫「讀者停下來讀太久導致效果被浪費」的問題。
  function updateDrag() {
    dragActive = null;
    if (!active()) return;
    var mid = vh() / 2;
    var list = document.querySelectorAll('[data-fx="drag"]');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) { dragActive = list[i]; break; }
    }
  }

  function dragFactor(el, touch) {
    var f = num(el, 'data-fx-factor', config.dragFactor, 1, config.dragFactorMax);
    if (touch) f = 1 + (f - 1) * config.dragTouchRatio;
    return f;
  }

  function wheelPixels(e) {
    if (e.deltaMode === 1) return e.deltaY * 16;      // 行
    if (e.deltaMode === 2) return e.deltaY * vh();    // 頁
    return e.deltaY;
  }

  // =====================================================================
  // freeze 凍結（上膛 → 擊發）
  // =====================================================================
  function armFreezes() {
    if (!active() || !settled || !hasScrolled) return;
    var list = document.querySelectorAll('[data-fx="freeze"]');
    var h = vh();
    for (var i = 0; i < list.length; i++) {
      var el = list[i], s = stateOf(el);
      if (s.fired || s.armed) continue;
      var r = el.getBoundingClientRect();
      if (r.top < h && r.bottom > 0) {
        s.armed = true;
        el.setAttribute('data-fx-state', 'armed');
        armed.push(el);
      }
    }
  }

  // 回傳 true 代表這次捲動輸入被吃掉了。
  function tryFire(touch) {
    if (!active()) return false;
    var now = Date.now();
    if (now < frozenUntil) return true;           // 還在凍結中
    while (armed.length) {
      var el = armed.shift();
      var s = stateOf(el);
      if (s.fired) continue;
      s.fired = true;
      s.armed = false;
      var ms = num(el, 'data-fx-ms', config.freezeMs, 0, config.freezeMsMax);
      if (touch) ms = ms * config.freezeTouchScale;
      if (ms <= 0) { el.setAttribute('data-fx-state', 'done'); continue; }
      frozenUntil = now + ms;
      el.setAttribute('data-fx-state', 'frozen');
      el.dispatchEvent(new CustomEvent('mfx:freeze', { bubbles: true, detail: { ms: ms } }));
      (function (node) {
        setTimeout(function () {
          node.setAttribute('data-fx-state', 'done');
          node.dispatchEvent(new CustomEvent('mfx:thaw', { bubbles: true }));
        }, ms);
      })(el);
      return true;
    }
    return false;
  }

  // =====================================================================
  // afterimage 殘影
  // =====================================================================
  // 複製一層內容，position: fixed、透明度極低，而且「不跟著捲」——
  // 讀者往下捲時，舊位置的影子還留在原地慢慢追上來。
  // 不用 canvas、不做截圖，就是真的一份 DOM。
  function mountGhost(el) {
    var s = stateOf(el);
    if (s.ghost) return;
    var ghost = document.createElement('div');
    ghost.className = 'mfx-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    if ('inert' in ghost) ghost.inert = true;
    ghost.innerHTML = el.innerHTML;
    // 複本不能有 id，也不能被搜尋 / 選取 / 點到。
    var ids = ghost.querySelectorAll('[id]');
    for (var i = 0; i < ids.length; i++) ids[i].removeAttribute('id');
    ghost.style.opacity = String(num(el, 'data-fx-opacity', config.afterimageOpacity, 0, 0.2));
    document.body.appendChild(ghost);
    s.ghost = ghost;
    s.ghostTop = el.getBoundingClientRect().top;
    syncGhostBox(el, s);
    startGhostLoop();
  }

  function syncGhostBox(el, s) {
    var r = el.getBoundingClientRect();
    s.ghost.style.left = r.left + 'px';
    s.ghost.style.width = r.width + 'px';
    s.ghost.style.transform = 'translateY(' + Math.round(s.ghostTop) + 'px)';
  }

  function unmountGhost(el) {
    var s = states.get(el);
    if (s && s.ghost) { s.ghost.remove(); s.ghost = null; }
  }

  function ghostTick() {
    ghostRaf = 0;
    if (!active()) return;
    var list = document.querySelectorAll('[data-fx="afterimage"]');
    var alive = false, h = vh();
    for (var i = 0; i < list.length; i++) {
      var el = list[i], s = stateOf(el), r = el.getBoundingClientRect();
      var near = r.top < h * 1.5 && r.bottom > -h * 0.5;
      if (near) {
        if (!s.ghost) mountGhost(el);
        var lag = num(el, 'data-fx-lag', config.afterimageLag, 0.005, 0.5);
        // 每幀讀屬性：示範頁拉滑桿時要能立刻看到差別，不用重載。
        s.ghost.style.opacity =
          String(num(el, 'data-fx-opacity', config.afterimageOpacity, 0, 0.2));
        s.ghostTop += (r.top - s.ghostTop) * lag;
        syncGhostBox(el, s);
        alive = true;
      } else if (s.ghost) {
        unmountGhost(el);
      }
    }
    if (alive) startGhostLoop();
  }

  function startGhostLoop() {
    if (!ghostRaf) ghostRaf = requestAnimationFrame(ghostTick);
  }

  // =====================================================================
  // eyelid 睜眼
  // =====================================================================
  // 全黑中一條縫，捲動後逐漸展開。進度由捲動位置決定，
  // 所以鍵盤捲動一樣打得開（不攔截任何輸入）。
  //
  // 讀者完全不動的話（#37）：先浮出提示，再自己緩緩展開——
  // 睜眼本來就是自己會發生的事，不需要誰同意。自動展開的結果
  // 跟手動捲開必須是同一個終點，沒有「你錯過了」這件事。
  // 任何一次真的捲動（scrollY 改變）都立刻接管，提示淡出。
  var eyelidRaf = 0;
  function startEyelidLoop() {
    if (!eyelidRaf) eyelidRaf = requestAnimationFrame(eyelidRafTick);
  }
  function eyelidRafTick() {
    eyelidRaf = 0;
    if (!active()) return;
    eyelidTick();
  }

  function eyelidSetup(el) {
    var s = stateOf(el);
    if (s.fired || s.lid) return;
    var lid = document.createElement('div');
    lid.className = 'mfx-eyelid';
    lid.setAttribute('aria-hidden', 'true');
    lid.innerHTML = '<div class="mfx-eyelid-bar mfx-eyelid-top"></div>' +
                    '<div class="mfx-eyelid-bar mfx-eyelid-bottom"></div>';
    document.body.appendChild(lid);
    s.lid = lid;
    s.startY = global.scrollY || global.pageYOffset || 0;
    s.userTook = false;
    var now = Date.now();
    s.hintAt = now + num(el, 'data-fx-hint-ms', config.eyelidHintDelayMs, 0);
    s.autoOpenAt = now + num(el, 'data-fx-auto-ms', config.eyelidAutoOpenDelayMs, 0);
    s.autoOpenDuration = num(el, 'data-fx-auto-duration-ms', config.eyelidAutoOpenDurationMs, 100);

    var hint = document.createElement('div');
    hint.className = 'mfx-eyelid-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polyline points="5 9 12 16 19 9"></polyline></svg>';
    document.body.appendChild(hint);
    s.hint = hint;

    eyelidPaint(el);
    startEyelidLoop();
  }

  // 呼吸感的緩開曲線：慢入、慢出，中段快一點，不是瞬開也不是等速。
  function eyelidEase(t) { return t * t * (3 - 2 * t); }

  function eyelidFinish(s, el) {
    s.lid.remove(); s.lid = null;
    if (s.hint) { s.hint.remove(); s.hint = null; }
    s.fired = true;
    el.setAttribute('data-fx-state', 'done');
  }

  function eyelidPaint(el) {
    var s = states.get(el);
    if (!s || !s.lid) return;
    var now = Date.now();
    var y = global.scrollY || global.pageYOffset || 0;
    if (!s.userTook && y !== s.startY) s.userTook = true; // 讀者一動就接管

    var openPx = num(el, 'data-fx-open', config.eyelidOpenVh, 10, 300) * vh() / 100;
    var p, state;
    if (s.userTook) {
      p = Math.max(0, Math.min(1, (y - s.startY) / openPx));
      state = 'user-open';
    } else if (now >= s.autoOpenAt) {
      var t = Math.min(1, (now - s.autoOpenAt) / s.autoOpenDuration);
      p = eyelidEase(t);
      state = 'auto-open';
    } else if (now >= s.hintAt) {
      p = 0;
      state = 'hint';
    } else {
      p = 0;
      state = 'waiting';
    }

    var h = vh();
    var slit = num(el, 'data-fx-slit', config.eyelidSlitVh, 0, 100) * h / 100;
    var open = slit + (h - slit) * p;
    var bar = Math.max(0, (h - open) / 2);
    s.lid.firstChild.style.height = bar + 'px';
    s.lid.lastChild.style.height = bar + 'px';
    el.setAttribute('data-fx-state', state);

    if (s.hint) {
      // 提示只在「等待→提示」這一段顯示；一旦開始自動展開或讀者接管，立刻淡出。
      s.hint.classList.toggle('mfx-eyelid-hint--visible', state === 'hint');
      s.hint.style.top = (h / 2 + slit / 2 + 14) + 'px';
    }

    if (p >= 1) { eyelidFinish(s, el); return; }
    if (!s.userTook) startEyelidLoop(); // 還沒被接管：時間仍在跑，繼續看下一幀
  }

  function eyelidTick() {
    var list = document.querySelectorAll('[data-fx="eyelid"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i], s = stateOf(el);
      if (s.fired) continue;
      var r = el.getBoundingClientRect();
      if (!s.lid && r.top < vh() && r.bottom > 0) eyelidSetup(el);
      else if (s.lid) eyelidPaint(el);
    }
  }

  // =====================================================================
  // scramble 亂序
  // =====================================================================
  // DOM 保留正確文字：每個字包成 span（textContent 不變，
  // 螢幕閱讀器、複製、Ctrl+F 拿到的都是原文），只用 transform
  // 把相鄰兩字的「畫面位置」對調。中文字序打亂但仍讀得懂。
  var CJK = /[一-鿿]/;

  function wrapChars(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.parentNode && n.parentNode.classList &&
          n.parentNode.classList.contains('mfx-ch')) continue;
      nodes.push(n);
    }
    var spans = [];
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text) return;
      var frag = document.createDocumentFragment();
      for (var i = 0; i < text.length; i++) {
        var span = document.createElement('span');
        span.className = 'mfx-ch';
        span.textContent = text[i];
        frag.appendChild(span);
        spans.push(span);
      }
      node.parentNode.replaceChild(frag, node);
    });
    return spans;
  }

  function applyScramble(el) {
    var s = stateOf(el);
    if (!s.spans) {
      s.original = el.innerHTML;
      s.spans = wrapChars(el);
      el.classList.add('mfx-scrambled');
    }
    layoutScramble(el);
    s.fired = true;
  }

  function layoutScramble(el) {
    var s = states.get(el);
    if (!s || !s.spans) return;
    var spans = s.spans, i;
    for (i = 0; i < spans.length; i++) spans[i].style.transform = '';
    var level = num(el, 'data-fx-level', config.scrambleLevel, 0, config.scrambleLevelMax);
    if (!level) return;
    var pairs = [];
    for (i = 0; i + 1 < spans.length; i++) {
      var a = spans[i], b = spans[i + 1];
      if (!CJK.test(a.textContent) || !CJK.test(b.textContent)) continue;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 1) continue; // 換行處不換位，會看起來像壞掉
      pairs.push([a, b, ra, rb]);
      i++; // 一個字只參與一次交換
    }
    var want = Math.round(pairs.length * level);
    // 均勻抽樣而不是連續一整片：讓亂序像雜訊，不像某一句被打壞。
    for (var k = 0; k < want; k++) {
      var p = pairs[Math.floor(k * pairs.length / want)];
      if (!p || p[0].style.transform) continue;
      p[0].style.transform = 'translateX(' + p[3].width + 'px)';
      p[1].style.transform = 'translateX(' + (-p[2].width) + 'px)';
    }
  }

  function clearScramble(el) {
    var s = states.get(el);
    if (!s || !s.spans) return;
    el.innerHTML = s.original;
    el.classList.remove('mfx-scrambled');
    s.spans = null;
  }

  // =====================================================================
  // stutter 重複
  // =====================================================================
  // 遞增：先重複一句，再重複一整段，再一遍。複本一律 aria-hidden，
  // 螢幕閱讀器與複製拿到的仍然只有一份原文。
  function firstSentence(text) {
    var m = text.match(/^[^。！？!?\n]*[。！？!?]?/);
    return (m && m[0]) || text;
  }

  function applyStutter(el) {
    var s = stateOf(el);
    if (s.echoes) return;
    var times = Math.max(1, Math.round(num(el, 'data-fx-times', config.stutterTimes, 1, 6)));
    var text = el.textContent || '';
    var echoes = [];
    for (var i = 1; i < times; i++) {
      var echo = el.cloneNode(false);
      echo.removeAttribute('data-fx');
      echo.removeAttribute('id');
      echo.setAttribute('aria-hidden', 'true');
      echo.className = (el.className ? el.className + ' ' : '') + 'mfx-echo';
      echo.textContent = i === 1 ? firstSentence(text) : text;
      echo.style.opacity = String(Math.max(0.35, 1 - i * 0.22));
      el.parentNode.insertBefore(echo, el.nextSibling);
      echoes.unshift(echo);
    }
    s.echoes = echoes;
    s.fired = true;
  }

  function clearStutter(el) {
    var s = states.get(el);
    if (!s || !s.echoes) return;
    s.echoes.forEach(function (e) { e.remove(); });
    s.echoes = null;
  }

  // =====================================================================
  // 進入視窗時一次性套用（scramble / stutter）
  // =====================================================================
  function onceInView() {
    if (!active()) return;
    var h = vh();
    var list = document.querySelectorAll('[data-fx="scramble"],[data-fx="stutter"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i], s = stateOf(el);
      if (s.fired) continue;
      var r = el.getBoundingClientRect();
      if (r.top < h && r.bottom > 0) {
        if (el.getAttribute('data-fx') === 'scramble') applyScramble(el);
        else applyStutter(el);
      }
    }
  }

  // =====================================================================
  // 事件
  // =====================================================================
  function onFrame() {
    rafPending = false;
    if (!active()) return;
    updateDrag();
    armFreezes();
    onceInView();
    eyelidTick();
    startGhostLoop();
  }

  function schedule() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(onFrame); }
  }

  // scroll / keydown 都只是「觀察」，永遠不 preventDefault：
  // 鍵盤捲動與捲軸拖曳是逃生出口，也是無障礙必要。
  function onScroll() { hasScrolled = true; schedule(); }

  function onWheel(e) {
    if (!active()) return;
    hasScrolled = true;
    if (Date.now() < frozenUntil) { e.preventDefault(); return; }
    if (tryFire(false)) { e.preventDefault(); return; }
    if (dragActive && e.deltaY) {
      e.preventDefault();
      global.scrollBy(0, wheelPixels(e) / dragFactor(dragActive, false));
      schedule();
    }
  }

  var touchY = 0, touchVel = 0, touchLast = 0, touchDragging = false, inertiaRaf = 0;

  function onTouchStart(e) {
    if (!e.touches || !e.touches.length) return;
    touchY = e.touches[0].clientY;
    touchVel = 0;
    touchLast = Date.now();
    touchDragging = false;
    if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; }
  }

  function onTouchMove(e) {
    if (!active() || !e.touches || !e.touches.length) return;
    hasScrolled = true;
    if (Date.now() < frozenUntil) { e.preventDefault(); return; }
    if (tryFire(true)) { e.preventDefault(); return; }
    if (!dragActive) return;
    var y = e.touches[0].clientY;
    var dy = touchY - y;
    touchY = y;
    e.preventDefault();
    touchDragging = true;
    var step = dy / dragFactor(dragActive, true);
    var now = Date.now();
    var dt = Math.max(8, now - touchLast);
    touchLast = now;
    touchVel = step / dt; // px / ms
    global.scrollBy(0, step);
    schedule();
  }

  function onTouchEnd() {
    // 接管 touchmove 會殺掉原生慣性，不補回來會被讀成「頁面壞了」。
    if (!touchDragging || !active()) { touchDragging = false; return; }
    touchDragging = false;
    var v = touchVel, start = Date.now();
    (function glide() {
      var t = Date.now() - start;
      if (t > config.touchInertiaMs || Math.abs(v) < 0.01 || Date.now() < frozenUntil) {
        inertiaRaf = 0; return;
      }
      var decay = 1 - t / config.touchInertiaMs;
      global.scrollBy(0, v * 16 * decay * decay);
      inertiaRaf = requestAnimationFrame(glide);
    })();
  }

  // =====================================================================
  // 開關 / API
  // =====================================================================
  function teardown() {
    armed.length = 0;
    frozenUntil = 0;
    dragActive = null;
    if (eyelidRaf) { cancelAnimationFrame(eyelidRaf); eyelidRaf = 0; }
    states.forEach(function (s, el) {
      if (s.ghost) unmountGhost(el);
      if (s.lid) { s.lid.remove(); s.lid = null; }
      if (s.hint) { s.hint.remove(); s.hint = null; }
      if (s.spans) clearScramble(el);
      if (s.echoes) clearStutter(el);
      el.removeAttribute('data-fx-state');
    });
    states.clear();
    document.documentElement.classList.toggle('mfx-off', !active());
  }

  function setEnabled(on) {
    userOff = !on;
    storeOff(userOff);
    teardown();
    syncToggles();
    if (active()) schedule();
  }

  function syncToggles() {
    var list = document.querySelectorAll('[data-fx-toggle]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.type === 'checkbox') el.checked = active();
      el.setAttribute('aria-pressed', String(active()));
      var on = el.getAttribute('data-fx-label-on');
      var off = el.getAttribute('data-fx-label-off');
      if (on && off && el.type !== 'checkbox') el.textContent = active() ? on : off;
    }
  }

  function onToggleClick(e) {
    var t = e.target.closest ? e.target.closest('[data-fx-toggle]') : null;
    if (!t) return;
    if (t.type === 'checkbox') setEnabled(t.checked);
    else setEnabled(!active());
  }

  // 重播：函式庫本身「每次載入只擊發一次」，重讀不重播。
  // 示範頁要反覆感受同一個效果，所以另外開這個 API 明確重來。
  function replay(el) {
    if (!el) return;
    var s = states.get(el);
    if (s) {
      if (s.ghost) unmountGhost(el);
      if (s.lid) { s.lid.remove(); s.lid = null; }
      if (s.hint) { s.hint.remove(); s.hint = null; }
      if (s.spans) clearScramble(el);
      if (s.echoes) clearStutter(el);
      states.delete(el);
    }
    el.removeAttribute('data-fx-state');
    hasScrolled = true;
    settled = true;
    schedule();
  }

  function start() {
    if (started) return;
    started = true;
    document.documentElement.classList.toggle('mfx-off', !active());
    syncToggles();
    document.addEventListener('click', onToggleClick, true);
    document.addEventListener('change', onToggleClick, true);
    if (reduceMotion) return; // 完全不掛捲動監聽：連攔截的機會都不存在
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', function () {
      states.forEach(function (s, el) { if (s.spans) layoutScramble(el); });
      schedule();
    }, { passive: true });
    global.addEventListener('wheel', onWheel, { passive: false });
    global.addEventListener('touchstart', onTouchStart, { passive: true });
    global.addEventListener('touchmove', onTouchMove, { passive: false });
    global.addEventListener('touchend', onTouchEnd, { passive: true });
    setTimeout(function () { settled = true; schedule(); }, config.armDelayMs);
    schedule();
  }

  var api = {
    config: config,
    start: start,
    replay: replay,
    refresh: schedule,
    setEnabled: setEnabled,
    isEnabled: function () { return active(); },
    reducedMotion: function () { return reduceMotion; },
    // 給測試與示範頁看內部狀態用
    _debug: function () {
      return {
        armed: armed.length,
        frozen: Date.now() < frozenUntil,
        drag: !!dragActive,
        settled: settled,
        hasScrolled: hasScrolled,
      };
    },
  };
  global.MyceliumFX = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
