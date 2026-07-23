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
