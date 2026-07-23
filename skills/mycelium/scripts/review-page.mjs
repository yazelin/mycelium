'use strict';
// review 頁：一個離線可開的單一 HTML。
//
// 這頁只有一個工作：**讓一個很累的人，快速看完 AI 這一天生了什麼，然後判斷。**
// 所以版面的第一個畫面是「改動」而不是首頁，所以伏筆是一行一條而不是一張一張，
// 所以底層跟表層長得完全不一樣——累的時候要能一眼認出自己在讀哪一層。
//
// 設計上的一個決定：表層用襯線、寬行距，讀起來像小說；底層用等寬、冷色、
// 縮在一條標著「底層」的細線後面，讀起來像 log。這不是裝飾，這是這部作品的
// 底層本來就是系統：祈禱＝上報 log。兩種字體＝兩種真相。
//
// 製作／公開模式沒有那條線，因為底層在產生檔案的時候就沒有被寫進來。
import { readFileSync } from 'node:fs';
import { esc } from './schema.mjs';
import { CYTOSCAPE_PATH } from './graph.mjs';
import { MODE_LABEL, MODE_TAGLINE } from './review.mjs';
import { VISUAL_FIELDS } from './records.mjs';

function embedJson(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><path d="M32 32 L16 20"/><path d="M32 32 L48 18"/><path d="M32 32 L15 44"/><path d="M32 32 L47 46"/><path d="M32 32 L32 14"/><path d="M16 20 L9 12"/><path d="M16 20 L8 24"/></g><circle cx="32" cy="32" r="6.5" fill="currentColor"/><circle cx="16" cy="20" r="4" fill="currentColor"/><circle cx="48" cy="18" r="4" fill="currentColor"/><circle cx="15" cy="44" r="4" fill="currentColor"/><circle cx="47" cy="46" r="4" fill="currentColor"/><circle cx="32" cy="14" r="3" fill="currentColor"/><circle cx="9" cy="12" r="2.6" fill="currentColor"/><circle cx="8" cy="24" r="2.6" fill="currentColor"/></svg>`;

const STYLE = `
:root{
  --soil:#0E1512; --loam:#17211C; --crust:#212D26; --ridge:#2C3B33;
  --filament:#E7EFE6; --moss:#7E9A88; --dusk:#55695D;
  --spore:#C9A227; --sporeSoft:rgba(201,162,39,.16);
  --machine:#8FA8BE; --machineBed:rgba(96,128,156,.09);
  --serif:"Noto Serif CJK TC","Source Han Serif TC","Songti TC",PMingLiU,"Times New Roman",serif;
  --sans:"Noto Sans CJK TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
  --mono:"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK TC",monospace;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--soil);color:var(--filament);
  font-family:var(--sans);font-size:15px;line-height:1.75;
  -webkit-font-smoothing:antialiased;overflow:hidden;
}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--spore);outline-offset:2px;border-radius:3px}

.shell{display:flex;flex-direction:column;height:100%}

/* ── 頁首：作品、模式、還有幾筆沒看 ───────────────────────────── */
header{
  display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  padding:12px 24px;border-bottom:1px solid var(--crust);background:var(--soil);
}
.mark{width:22px;height:22px;color:var(--moss);flex:none}
.mark svg{width:100%;height:100%;display:block}
h1{margin:0;font-family:var(--serif);font-weight:600;font-size:19px;letter-spacing:.06em;white-space:nowrap}
.modes{display:flex;gap:1px;background:var(--crust);border:1px solid var(--crust);border-radius:999px;overflow:hidden}
.modes a,.modes span{
  padding:4px 15px;font-size:12.5px;letter-spacing:.12em;color:var(--dusk);
  background:var(--soil);text-decoration:none;white-space:nowrap;
}
.modes a:hover{color:var(--filament)}
.modes .on{background:var(--moss);color:var(--soil);font-weight:600}
.modes .off{opacity:.4;cursor:not-allowed}
.tagline{font-size:12px;color:var(--dusk);letter-spacing:.02em}
.unread{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:12.5px;color:var(--moss)}
.unread b{font-family:var(--mono);color:var(--spore);font-size:15px;font-weight:600}
.markread{border:1px solid var(--ridge);border-radius:999px;padding:4px 14px;font-size:12px;color:var(--moss)}
.markread:hover{border-color:var(--spore);color:var(--spore)}
.stamp{font-family:var(--mono);font-size:11px;color:var(--dusk)}

.body{flex:1;display:flex;min-height:0}

/* ── 左欄：搜尋、檢視、篩選 ─────────────────────────────────── */
nav{
  width:216px;flex:none;border-right:1px solid var(--crust);background:var(--loam);
  padding:18px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:20px;
}
#q{
  width:100%;padding:8px 12px;border-radius:8px;background:var(--soil);
  border:1px solid var(--crust);color:var(--filament);font:inherit;font-size:13px;
}
#q::placeholder{color:var(--dusk)}
.navlist{list-style:none;margin:0;padding:0}
.navlist button{
  width:100%;display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-radius:7px;
  color:var(--moss);font-size:14px;letter-spacing:.06em;text-align:left;
}
.navlist button:hover{background:var(--crust);color:var(--filament)}
.navlist button[aria-current="true"]{background:var(--crust);color:var(--filament);font-weight:600}
.navlist .n{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--dusk)}
.navlist button[aria-current="true"] .n{color:var(--moss)}
.navlist .new{
  font-family:var(--mono);font-size:11px;color:var(--soil);background:var(--spore);
  border-radius:999px;padding:0 6px;line-height:1.5;
}
.group{display:flex;flex-direction:column;gap:8px}
.group h2{
  font-size:10.5px;font-weight:500;letter-spacing:.24em;color:var(--dusk);margin:0;
}
.chip{
  display:flex;align-items:center;gap:7px;padding:3px 0;font-size:13px;color:var(--moss);
}
.chip:hover{color:var(--filament)}
.chip[aria-pressed="false"]{color:var(--dusk);text-decoration:line-through}
.chip[aria-pressed="false"] .dot{opacity:.25}
.chip .n{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--dusk)}
.dot{width:9px;height:9px;flex:none;border-radius:50%}
.switch{
  display:flex;align-items:center;gap:9px;font-size:13px;color:var(--moss);
  border:1px solid var(--crust);border-radius:8px;padding:7px 10px;width:100%;
}
.switch:hover{border-color:var(--ridge);color:var(--filament)}
.switch[aria-pressed="true"]{border-color:var(--spore);color:var(--spore);background:var(--sporeSoft)}
.switch .box{width:12px;height:12px;border:1px solid currentColor;border-radius:3px;flex:none}
.switch[aria-pressed="true"] .box{background:var(--spore);border-color:var(--spore)}
nav .foot{margin-top:auto;font-size:11.5px;color:var(--dusk);line-height:1.7}
nav .foot kbd{font-family:var(--mono);font-size:10.5px;border:1px solid var(--crust);border-radius:4px;padding:0 4px}

/* ── 主欄 ──────────────────────────────────────────────────── */
main{flex:1;min-width:0;overflow-y:auto;padding:26px 34px 120px;scroll-behavior:smooth;position:relative}
main.graphview{overflow:hidden;padding:0;display:flex}
.view{max-width:74ch}
.viewhead{display:flex;align-items:baseline;gap:14px;margin:0 0 4px}
.viewhead h2{margin:0;font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:.08em}
.viewhead .sub{font-size:12.5px;color:var(--dusk)}
.viewhead .act{margin-left:auto;font-size:12px;color:var(--moss);border-bottom:1px solid var(--ridge)}
.viewhead .act:hover{color:var(--spore);border-color:var(--spore)}
.lede{color:var(--dusk);font-size:13.5px;margin:0 0 22px;max-width:60ch}

/* 卡片：一筆紀錄一張。收起來的時候只有一行，攤開才是全部 */
.card{
  border-top:1px solid var(--crust);padding:14px 0 16px;
}
.card:last-child{border-bottom:1px solid var(--crust)}
.card.isnew,.fs.isnew{border-left:2px solid var(--spore);margin-left:-14px;padding-left:12px}
.cardhead{display:flex;align-items:baseline;gap:10px;width:100%;text-align:left}
.cardhead:hover .name{color:var(--spore)}
.name{font-family:var(--serif);font-size:19px;letter-spacing:.05em;color:var(--filament)}
.kind{font-size:11.5px;letter-spacing:.14em;color:var(--moss);display:inline-flex;align-items:center;gap:6px}
.badge{
  font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;color:var(--soil);
  background:var(--spore);border-radius:3px;padding:0 5px;line-height:1.6;
}
.when{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--dusk);white-space:nowrap}
.preview{
  color:var(--dusk);font-size:13.5px;margin:2px 0 0;
  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;
}
.card .full{margin-top:14px}
.card[data-open="false"] .full{display:none}

.aliases{font-family:var(--serif);color:var(--spore);font-size:15px;margin:0 0 12px}
.aliases span{font-family:var(--sans);font-size:10.5px;letter-spacing:.2em;color:var(--dusk);margin-right:8px}

/* 表層：讀起來像小說 */
.layer{margin:0 0 6px}
.layer h3{
  font-size:10.5px;font-weight:500;letter-spacing:.24em;color:var(--dusk);
  margin:20px 0 8px;display:flex;align-items:center;gap:10px;
}
.layer h3::after{content:"";flex:1;height:1px;background:var(--crust)}
.prose{font-size:14.5px;line-height:1.95;color:#D8E3DB;margin:0}
.prose p{margin:0 0 .85em}
.prose ul{margin:0 0 .85em;padding-left:1.15em}
.prose li{margin:.15em 0}
.prose b{color:var(--filament);font-weight:600}
.prose table{border-collapse:collapse;font-size:13px;margin:0 0 .85em;width:100%}
.prose th,.prose td{border:1px solid var(--crust);padding:4px 9px;text-align:left;vertical-align:top}
.prose th{color:var(--moss);font-weight:500;background:rgba(255,255,255,.02)}

/* 底層：讀起來像 log。冷色、等寬、縮在一條標著「底層」的線後面 */
.deep{
  border-left:1px solid rgba(143,168,190,.35);background:var(--machineBed);
  padding:10px 16px;margin:0 0 8px;
}
.deep h3{color:var(--machine);opacity:.85}
.deep h3::after{background:rgba(143,168,190,.22)}
.deep .prose{
  font-family:var(--mono);font-size:12.5px;line-height:1.85;color:#B9CBD8;letter-spacing:.01em;
}
.deep .prose b{color:#E2EDF4}
.deep .prose th{color:var(--machine)}
.deep .prose th,.deep .prose td{border-color:rgba(143,168,190,.22)}

.stripped{
  font-size:12.5px;color:var(--dusk);border-left:1px solid var(--ridge);
  padding:6px 14px;margin:14px 0 0;font-family:var(--mono);
}

/* 視覺設定（製作層） */
.visuals{margin-top:6px}
.visual{border:1px solid var(--crust);border-radius:9px;padding:12px 15px;margin:0 0 10px}
.visual .ver{font-family:var(--serif);font-size:15px;letter-spacing:.06em;margin-bottom:8px}
.spec{margin:0;font-size:13.5px}
.spec div{display:flex;gap:12px;padding:3px 0;border-top:1px dashed var(--crust)}
.spec div:first-child{border-top:0}
.spec dt{color:var(--moss);flex:none;width:5.6em;font-size:12.5px}
.spec dd{margin:0;color:#D8E3DB;white-space:pre-wrap;min-width:0;flex:1}
.spec dd.empty{color:var(--dusk)}
.spec dd.prompt{font-family:var(--mono);font-size:12px;line-height:1.7}
.howto{
  font-family:var(--mono);font-size:11.5px;color:var(--dusk);background:var(--soil);
  border:1px solid var(--crust);border-radius:7px;padding:9px 12px;margin:8px 0 0;
  white-space:pre-wrap;overflow-x:auto;
}

/* 小元件 */
.tags{margin:0 0 10px}
.tag{display:inline-block;font-size:11.5px;color:var(--moss);border:1px solid var(--crust);border-radius:999px;padding:0 10px;margin:0 5px 5px 0}
.rows{list-style:none;margin:0;padding:0;font-size:13.5px}
.rows li{padding:4px 0;display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.arrow{font-family:var(--mono);font-size:11.5px;color:var(--moss);white-space:nowrap}
.jump{color:var(--filament);border-bottom:1px solid var(--dusk)}
.jump:hover{color:var(--spore);border-color:var(--spore)}
.sub2{font-size:12.5px;color:var(--dusk);width:100%;margin:0;padding-left:2px}
.none{color:var(--dusk);font-size:13px}
.status{font-family:var(--mono);font-size:11px;letter-spacing:.06em;border:1px solid var(--crust);border-radius:3px;padding:0 6px;color:var(--moss);white-space:nowrap;flex:none}
.status.s-完稿{color:var(--spore);border-color:rgba(201,162,39,.4)}
.status.s-草稿{color:var(--filament)}
.status.s-已回收{color:var(--moss);border-color:var(--ridge)}
.status.s-棄用{color:var(--dusk);text-decoration:line-through}
.warn{color:#D98F5F;font-size:11.5px;font-family:var(--mono)}

/* 改動時間軸：一筆一行 */
.ch{display:flex;gap:12px;align-items:baseline;padding:5px 0;font-size:14.5px;border-top:1px solid var(--crust)}
.ch .t{font-family:var(--mono);font-size:11.5px;color:var(--dusk);width:3.6em;flex:none}
.ch.isnew{border-left:2px solid var(--spore);margin-left:-14px;padding-left:12px}
.ch.isnew .t{color:var(--spore)}
.ch .gone{color:var(--dusk);text-decoration:line-through}
.op{font-family:var(--mono);font-size:11px;width:2.8em;flex:none;letter-spacing:.06em}
.op.added{color:var(--spore)}
.op.changed{color:var(--moss)}
.op.removed{color:#D98F5F}
.where{font-size:11.5px;color:var(--dusk);margin-left:auto}

/* 章節：按卷分組 */
.volume{margin:26px 0 8px;display:flex;align-items:baseline;gap:12px}
.volume h3{margin:0;font-family:var(--serif);font-size:17px;letter-spacing:.1em;color:var(--moss)}
.volume .rule{flex:1;height:1px;background:var(--crust)}
.volume .n{font-family:var(--mono);font-size:11px;color:var(--dusk)}

/* 伏筆：一行一條，掃得完 */
.fs{border-top:1px solid var(--crust)}
.fs:last-of-type{border-bottom:1px solid var(--crust)}
.fs .row{display:flex;gap:11px;align-items:baseline;width:100%;text-align:left;padding:9px 0}
.fs .row:hover .t{color:var(--spore)}
.fs .t{font-size:14.5px;color:var(--filament);flex:none;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs .meta{font-size:12px;color:var(--dusk);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs[data-open="true"] .t{white-space:normal;max-width:none}
.fs .detail{padding:0 0 16px}
.fs[data-open="false"] .detail{display:none}

/* 關係圖 */
#cy{flex:1;min-width:0;background:radial-gradient(120% 90% at 50% 40%, #16211C 0%, var(--soil) 70%)}
.graphtools{position:absolute;bottom:18px;left:24px;font-size:12px;color:var(--dusk)}

.empty{color:var(--dusk);font-size:14px;border:1px dashed var(--crust);border-radius:10px;padding:26px;text-align:center}

@media (max-width:900px){
  body{overflow:auto}
  .body{flex-direction:column}
  nav{width:auto;border-right:0;border-bottom:1px solid var(--crust)}
  main{padding:20px 18px 80px}
  .unread{margin-left:0}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

function modeNav(mode, siblings) {
  return ['author', 'production', 'public'].map((m) => {
    if (m === mode) return `<span class="on">${MODE_LABEL[m]}</span>`;
    const href = siblings && siblings[m];
    if (!href) return `<span class="off" title="這一次沒有產生${MODE_LABEL[m]}模式的檔案">${MODE_LABEL[m]}</span>`;
    return `<a href="${esc(href)}">${MODE_LABEL[m]}</a>`;
  }).join('');
}

export function buildReviewHtml({ model, siblings = {} }) {
  const cytoscape = readFileSync(CYTOSCAPE_PATH, 'utf8');
  const mode = model.mode;
  const tagline = mode === 'public' ? `${MODE_TAGLINE.public}——解鎖到第 ${model.volume} 卷` : MODE_TAGLINE[mode];

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}・設定審閱（${MODE_LABEL[mode]}）</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2d4a3e"/><circle cx="32" cy="32" r="9" fill="#eaf3ee"/></svg>')}">
<style>${STYLE}</style>
</head>
<body>
<div class="shell">
  <header>
    <span class="mark">${MARK}</span>
    <h1>${esc(model.title)}</h1>
    <div class="modes">${modeNav(mode, siblings)}</div>
    <span class="tagline">${esc(tagline)}</span>
    <div class="unread">
      ${mode === 'author'
        ? '<span id="unread-line"></span><button class="markread" id="markread" type="button">標記全部已讀</button>'
        : ''}
      <span class="stamp">${esc(model.generatedAt)}</span>
    </div>
  </header>
  <div class="body">
    <nav>
      <input id="q" type="search" placeholder="搜尋（/）" aria-label="搜尋設定" autocomplete="off">
      <ul class="navlist" id="views"></ul>
      <div class="group" id="typefilter" hidden>
        <h2>類型</h2>
        <div id="typechips"></div>
      </div>
      <div class="group" id="newonlywrap" hidden>
        <button class="switch" id="newonly" type="button" aria-pressed="false"><span class="box"></span>只看新的</button>
      </div>
      <p class="foot" id="navfoot"></p>
    </nav>
    <main id="main"></main>
  </div>
</div>

<script>${cytoscape}</script>
<script>
'use strict';
const M = ${embedJson(model)};
const VISUAL_FIELDS = ${embedJson(VISUAL_FIELDS.map((f) => ({ key: f.key, label: f.label, hint: f.hint, flag: f.flag })))};
const NL = String.fromCharCode(10);
const AUTHOR = M.mode === 'author';
const SEEN_KEY = 'mycelium.review.' + (M.repoSlug || M.title) + '.seen';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (id) => document.getElementById(id);

// ── 已讀的那一刻 ────────────────────────────────────────────────
// 記在 localStorage，所以下一次打開只剩下沒看過的。第一次打開沒有紀錄，
// 那就整段歷史都算沒看過——那是實話。
function seen() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } }
function setSeen(v) { try { localStorage.setItem(SEEN_KEY, v); } catch (e) {} }
function isNew(rec) {
  if (!AUTHOR || !rec || !rec.change) return false;
  const s = seen();
  return !s || rec.change.at > s;
}
function countNew(list) { let n = 0; for (const r of list) if (isNew(r)) n++; return n; }

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ── 內文排版 ────────────────────────────────────────────────────
// 設定內文是使用者在對話裡寫的 markdown，只認四種：粗體、清單、表格、段落。
// 不做完整 markdown：多認一種語法，就多一種顯示錯誤的方式。
function inline(s) {
  return esc(s).replace(/[*][*]([^*]+)[*][*]/g, '<b>$1</b>');
}
function cells(line) {
  return line.replace(/^[|]/, '').replace(/[|]$/, '').split('|').map((c) => c.trim());
}
function prose(text) {
  const lines = String(text || '').split(NL);
  const out = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    if (/^\\s*[|].*[|]\\s*$/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\\s*[|].*[|]\\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const head = cells(rows[0]);
      const bodyRows = rows.slice(1).filter((r) => !/^[\\s|:-]+$/.test(r)).map(cells);
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
        + bodyRows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\\s*[-*]\\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\\s*[-*]\\s+/.test(lines[i])) { items.push(lines[i].replace(/^\\s*[-*]\\s+/, '')); i++; }
      i--;
      out.push('<ul>' + items.map((t) => '<li>' + inline(t) + '</li>').join('') + '</ul>');
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.join('');
}
// 一行預覽。標題行（【表層描述】那種）跳過——那不是內容，看了等於沒看。
function firstLine(text) {
  const skip = /^[\\s|=＝═-]*$|^[\\s═＝=]*[【][^】]*[】][\\s═＝=]*$/;
  const t = String(text || '').split(NL).find((l) => l.trim() && !skip.test(l.trim()));
  return t ? t.replace(/[*][*]/g, '').trim() : '';
}

// ── 狀態 ────────────────────────────────────────────────────────
const VIEWS = AUTHOR
  ? ['changes', 'entities', 'graph', 'chapters', 'foreshadow']
  : ['entities', 'graph', 'chapters'];
const VIEW_LABEL = { changes: '改動', entities: '角色', graph: '關係圖', chapters: '章節', foreshadow: '伏筆' };
const state = {
  view: VIEWS[0],
  q: '',
  newOnly: false,
  hiddenTypes: new Set(),
  open: new Set(),
};

function match(rec, fields) {
  if (!state.q) return true;
  const t = state.q.toLowerCase();
  return fields.some((f) => String(f || '').toLowerCase().indexOf(t) !== -1);
}

function entityList() {
  return M.entities.filter((e) => {
    if (state.hiddenTypes.has(e.type)) return false;
    if (state.newOnly && !isNew(e)) return false;
    return match(e, [e.name, e.aliases.join(' '), e.type, e.sections.map((s) => s.body).join(' ')]);
  });
}
function chapterList() {
  return M.chapters.filter((c) => {
    if (state.newOnly && !isNew(c)) return false;
    return match(c, [c.title, c.summary, c.content, c.status]);
  });
}
function foreshadowList() {
  return M.foreshadow.filter((f) => {
    if (state.newOnly && !isNew(f)) return false;
    return match(f, [f.title, f.notes, f.status, f.entities.join(' ')]);
  });
}

// ── 左欄 ────────────────────────────────────────────────────────
function counts() {
  return {
    changes: changeItems().length,
    entities: M.entities.length,
    graph: M.graph.edges.length,
    chapters: M.chapters.length,
    foreshadow: M.foreshadow.length,
  };
}
function newCounts() {
  return {
    changes: 0,
    entities: countNew(M.entities),
    graph: countNew(M.relations),
    chapters: countNew(M.chapters),
    foreshadow: countNew(M.foreshadow),
  };
}
function renderNav() {
  const c = counts(), n = newCounts();
  el('views').innerHTML = VIEWS.map((v) => {
    const badge = n[v] ? '<span class="new">' + n[v] + '</span>' : '';
    return '<li><button type="button" data-view="' + v + '" aria-current="' + (state.view === v) + '">'
      + VIEW_LABEL[v] + badge + '<span class="n">' + c[v] + '</span></button></li>';
  }).join('');
  el('views').querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
  });

  const wantTypes = state.view === 'entities' || state.view === 'graph';
  el('typefilter').hidden = !wantTypes;
  if (wantTypes) {
    const legend = M.graph.legend;
    el('typechips').innerHTML = legend.map((l) =>
      '<button class="chip" type="button" data-type="' + esc(l.type) + '" aria-pressed="' + !state.hiddenTypes.has(l.type) + '">'
      + '<span class="dot" style="background:' + l.color + '"></span>' + esc(l.type)
      + '<span class="n">' + l.count + '</span></button>').join('');
    el('typechips').querySelectorAll('[data-type]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.type;
        if (state.hiddenTypes.has(t)) state.hiddenTypes.delete(t); else state.hiddenTypes.add(t);
        render();
      });
    });
  }

  el('newonlywrap').hidden = !AUTHOR || state.view === 'changes';
  const sw = el('newonly');
  if (sw) sw.setAttribute('aria-pressed', String(state.newOnly));

  const total = n.entities + n.chapters + n.foreshadow + n.graph;
  if (AUTHOR) {
    const s = seen();
    el('unread-line').innerHTML = total
      ? '自從 ' + (s ? fmtTime(s) : '一開始') + ' 起，AI 動過 <b>' + total + '</b> 筆'
      : '沒有新的改動';
    el('navfoot').innerHTML = '<kbd>/</kbd> 搜尋　<kbd>Esc</kbd> 清空<br>'
      + (M.history ? '讀了最近 ' + M.history.scanned + ' 次寫入' + (M.history.truncated ? '（更早的沒讀）' : '') : '這次沒有讀到 git 歷史');
  } else {
    el('navfoot').textContent = M.mode === 'production'
      ? '底層與伏筆在產生這個檔案的時候就被拿掉了，不在原始碼裡。'
      : '只有第 ' + M.volume + ' 卷（含）以前登場的設定。';
  }
}

// ── 各檢視 ──────────────────────────────────────────────────────
function head(title, sub, action) {
  return '<div class="viewhead"><h2>' + title + '</h2><span class="sub">' + sub + '</span>'
    + (action || '') + '</div>';
}

// 一次寫入通常只動一筆，所以時間軸就一筆一行——37 個 commit 各占一張卡的話，
// 「快速看完 AI 今天生了什麼」會變成捲三分鐘。
function changeItems() {
  const h = M.history;
  if (!h) return [];
  const out = [];
  for (const c of h.commits) {
    for (const kind of ['added', 'changed', 'removed']) {
      for (const it of c[kind]) out.push({ ...it, kind, at: c.at, message: c.message });
    }
  }
  return out;
}

function renderChanges() {
  const h = M.history;
  const items = changeItems();
  if (!items.length) {
    return head('改動', '') + '<div class="empty">'
      + (h ? '讀了最近 ' + h.scanned + ' 次寫入，沒有可以比對的改動。' : '這一次沒有讀到任何寫入紀錄。') + '</div>';
  }
  const s = seen();
  const store = { entities: '角色', relations: '關係', chapters: '章節', foreshadow: '伏筆' };
  const opLabel = { added: '新增', changed: '修改', removed: '刪除' };
  let day = null;
  const rows = items.map((it) => {
    const fresh = !s || it.at > s;
    const d = new Date(it.at);
    const dayLabel = isNaN(d) ? '' : (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    let header = '';
    if (dayLabel !== day) {
      day = dayLabel;
      header = '<div class="volume"><h3>' + dayLabel + '</h3><span class="rule"></span></div>';
    }
    const time = isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return header + '<div class="ch' + (fresh ? ' isnew' : '') + '">'
      + '<span class="t">' + time + '</span>'
      + '<span class="op ' + it.kind + '">' + opLabel[it.kind] + '</span>'
      + (it.kind === 'removed'
        ? '<span class="gone">' + esc(it.label) + '</span>'
        : '<button class="jump" data-goto="' + esc(it.store) + ':' + esc(it.id) + '">' + esc(it.label) + '</button>')
      + '<span class="where">' + (store[it.store] || it.store) + '</span></div>';
  }).join('');
  return head('改動', items.length + ' 筆・讀了最近 ' + h.scanned + ' 次寫入' + (h.truncated ? '（更早的沒讀）' : ''), '')
    + '<p class="lede">AI 每寫一次就是一個 commit。新的在上面，左邊有黃線的是你還沒看過的。點名字跳到那一筆。</p>'
    + rows;
}

function visualBlock(e) {
  if (M.mode === 'public') return '';
  const list = e.visuals || [];
  const cmd = 'node scripts/mycelium.mjs edit entity ' + e.name + ' --visual 第一卷 \\\\' + NL
    + VISUAL_FIELDS.map((f) => '  --' + f.flag + ' "…"').join(' \\\\' + NL);
  if (!list.length) {
    return '<div class="layer"><h3>視覺設定</h3>'
      + '<p class="none">還沒有任何版本。一個角色可以有很多版（第一卷的他、失憶之後的他），每一版都是一組可以直接畫的規格：'
      + VISUAL_FIELDS.map((f) => f.label).join('、') + '。</p>'
      + '<pre class="howto">' + esc(cmd) + '</pre></div>';
  }
  return '<div class="layer"><h3>視覺設定</h3><div class="visuals">' + list.map((v) => {
    const rows = VISUAL_FIELDS.map((f) => {
      const val = String(v[f.key] || '').trim();
      return '<div><dt>' + f.label + '</dt><dd class="' + (val ? (f.key === 'prompt' ? 'prompt' : '') : 'empty') + '">'
        + (val ? esc(val) : '（' + f.hint + '）') + '</dd></div>';
    }).join('');
    return '<div class="visual"><div class="ver">' + esc(v.version || '未命名版本') + '</div><dl class="spec">' + rows + '</dl></div>';
  }).join('') + '</div></div>';
}

function entityCard(e) {
  const parts = [];
  if (e.aliases.length) parts.push('<p class="aliases"><span>別名</span>' + e.aliases.map(esc).join('・') + '</p>');
  if (e.tags.length) parts.push('<p class="tags">' + e.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>');
  for (const s of e.sections) {
    const deep = s.kind === 'deep';
    parts.push('<div class="layer' + (deep ? ' deep' : '') + '">'
      + (s.title ? '<h3>' + esc(s.title) + '</h3>' : '')
      + '<div class="prose">' + prose(s.body) + '</div></div>');
  }
  if (!e.sections.length) parts.push('<p class="none">這一筆還沒有可以顯示的設定內容。</p>');
  if (e.hiddenSections) {
    parts.push('<p class="stripped">底層 ' + e.hiddenSections + ' 段已在產生檔案時移除，不在這個檔案裡。</p>');
  }
  if (e.fields.length) {
    parts.push('<div class="layer"><h3>欄位</h3><dl class="spec">' + e.fields
      .map((f) => '<div><dt>' + esc(f.key) + '</dt><dd>' + esc(f.value) + '</dd></div>').join('') + '</dl></div>');
  }
  parts.push(visualBlock(e));
  parts.push('<div class="layer"><h3>關係　' + e.relations.length + '</h3>' + (e.relations.length
    ? '<ul class="rows">' + e.relations.map((r) => '<li><span class="arrow">'
        + (r.dir === 'out' ? '—' + esc(r.type) + '→' : '←' + esc(r.type) + '—') + '</span>'
        + '<button class="jump" data-goto="entities:' + esc(r.otherId) + '">' + esc(r.other) + '</button>'
        + (r.notes ? '<p class="sub2">' + esc(r.notes) + '</p>' : '') + '</li>').join('') + '</ul>'
    : '<p class="none">還沒有跟任何人連起來。</p>') + '</div>');
  if (e.chapters.length) {
    parts.push('<div class="layer"><h3>出現章節　' + e.chapters.length + '</h3><ul class="rows">'
      + e.chapters.map((c) => '<li><span class="arrow">第' + c.volume + '卷</span>'
        + '<button class="jump" data-goto="chapters:' + esc(c.id) + '">' + esc(c.title) + '</button></li>').join('')
      + '</ul></div>');
  }
  if (e.foreshadow.length) {
    parts.push('<div class="layer"><h3>相關伏筆　' + e.foreshadow.length + '</h3><ul class="rows">'
      + e.foreshadow.map((f) => '<li><button class="jump" data-goto="foreshadow:' + esc(f.id) + '">' + esc(f.title) + '</button>'
        + '<span class="status s-' + esc(f.status) + '">' + esc(f.status) + '</span></li>').join('')
      + '</ul></div>');
  }
  return card(e, 'entities', esc(e.name), '<span class="kind"><span class="dot" style="background:'
    + colorOf(e.type) + '"></span>' + esc(e.type) + '</span>', firstLine(e.sections.length ? e.sections[0].body : ''), parts.join(''));
}

function colorOf(type) {
  const l = M.graph.legend.find((x) => x.type === type);
  return l ? l.color : '#5C7266';
}

function card(rec, store, title, meta, preview, full) {
  const open = state.open.has(rec.id);
  return '<article class="card' + (isNew(rec) ? ' isnew' : '') + '" data-open="' + open + '" id="' + store + '-' + esc(rec.id) + '">'
    + '<button class="cardhead" type="button" data-toggle="' + esc(rec.id) + '" aria-expanded="' + open + '">'
    + '<span class="name">' + title + '</span>' + meta
    + (isNew(rec) ? '<span class="badge">新</span>' : '')
    + '<span class="when">' + (rec.change ? fmtTime(rec.change.at) : '') + '</span></button>'
    + (open ? '' : '<p class="preview">' + esc(preview) + '</p>')
    + '<div class="full">' + full + '</div></article>';
}

function renderEntities() {
  const list = entityList();
  const sub = list.length + ' / ' + M.entities.length + ' 筆';
  const body = list.length ? list.map(entityCard).join('') : emptyBox();
  return head('角色與設定', sub, allToggle(list)) + body;
}

function renderChapters() {
  const list = chapterList();
  let html = head('章節', list.length + ' / ' + M.chapters.length + ' 章', allToggle(list));
  let vol = null;
  for (const c of list) {
    if (c.volume !== vol) {
      vol = c.volume;
      const inVol = list.filter((x) => x.volume === vol);
      html += '<div class="volume"><h3>第 ' + vol + ' 卷</h3><span class="rule"></span><span class="n">'
        + inVol.length + ' 章・' + inVol.reduce((n, x) => n + x.wordCount, 0) + ' 字</span></div>';
    }
    const parts = [];
    if (c.summary) parts.push('<div class="layer"><h3>摘要</h3><div class="prose">' + prose(c.summary) + '</div></div>');
    else parts.push('<p class="none">還沒有摘要。</p>');
    if (c.foreshadow.length) {
      parts.push('<div class="layer"><h3>伏筆</h3><ul class="rows">' + c.foreshadow.map((f) =>
        '<li><span class="arrow">' + f.role + '</span><button class="jump" data-goto="foreshadow:' + esc(f.id) + '">'
        + esc(f.title) + '</button></li>').join('') + '</ul></div>');
    }
    if (c.content) parts.push('<div class="layer"><h3>正文　' + c.content.length + ' 字</h3><div class="prose">' + prose(c.content) + '</div></div>');
    html += card(c, 'chapters', esc(c.title),
      '<span class="status s-' + esc(c.status) + '">' + esc(c.status) + '</span>'
      + (c.wordCount ? '<span class="kind">' + c.wordCount + ' 字</span>' : ''),
      c.summary || '（還沒有摘要）', parts.join(''));
  }
  if (!list.length) html += emptyBox();
  return html;
}

function renderForeshadow() {
  const list = foreshadowList();
  const open = list.filter((f) => f.status === '埋設中').length;
  let html = head('伏筆', list.length + ' / ' + M.foreshadow.length + ' 筆・未回收 ' + open, allToggle(list));
  html += '<p class="lede">一行一條，先掃標題跟狀態，需要細看再點開。</p>';
  html += list.map((f) => {
    const isOpen = state.open.has(f.id);
    const meta = [];
    if (f.plant) meta.push('埋：第' + f.plant.volume + '卷・' + f.plant.title);
    if (f.recover) meta.push('收：第' + f.recover.volume + '卷・' + f.recover.title);
    if (f.entities.length) meta.push(f.entities.join('、'));
    if (!meta.length) meta.push(firstLine(f.notes));
    return '<article class="fs' + (isNew(f) ? ' isnew' : '') + '" data-open="' + isOpen + '" id="foreshadow-' + esc(f.id) + '">'
      + '<button class="row" type="button" data-toggle="' + esc(f.id) + '" aria-expanded="' + isOpen + '">'
      + '<span class="status s-' + esc(f.status) + '">' + esc(f.status) + '</span>'
      + '<span class="t">' + esc(f.title) + '</span>'
      + (f.overdue ? '<span class="warn">逾期未回收</span>' : '')
      + (isNew(f) ? '<span class="badge">新</span>' : '')
      + '<span class="meta">' + esc(meta.join('　·　')) + '</span>'
      + '<span class="when">' + (f.change ? fmtTime(f.change.at) : '') + '</span></button>'
      + '<div class="detail"><div class="prose">' + (f.notes ? prose(f.notes) : '<p class="none">沒有備註。</p>') + '</div>'
      + (f.entities.length ? '<p class="sub2">相關角色：' + esc(f.entities.join('、')) + '</p>' : '')
      + '</div></article>';
  }).join('');
  if (!list.length) html += emptyBox();
  return html;
}

function emptyBox() {
  return '<div class="empty">' + (state.newOnly ? '這個檢視裡沒有新的東西。' : '沒有符合的項目。') + '</div>';
}
function allToggle(list) {
  const anyClosed = list.some((r) => !state.open.has(r.id));
  return '<button class="act" id="toggleall" data-open="' + anyClosed + '">' + (anyClosed ? '全部展開' : '全部收起') + '</button>';
}

// ── 關係圖：沿用 graph 指令的那一張，這裡只是它的其中一個檢視 ──────
let cy = null;
function mountGraph() {
  const box = el('cy');
  if (!box) return;
  if (cy) { cy.resize(); cy.fit(cy.elements(':visible'), 70); return; }
  cy = cytoscape({
    container: box,
    elements: [
      ...M.graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, color: n.color, shape: n.shape, size: n.size } })),
      ...M.graph.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, label: e.type } })),
    ],
    style: [
      { selector: 'node', style: {
        'background-color': 'data(color)', shape: 'data(shape)', width: 'data(size)', height: 'data(size)',
        label: 'data(label)', color: '#E7EFE6', 'font-family': '"Noto Sans CJK TC","PingFang TC",sans-serif',
        'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 6, 'text-outline-color': '#0E1512',
        'text-outline-width': 3, 'text-wrap': 'wrap', 'text-max-width': 96,
      } },
      { selector: 'edge', style: {
        width: 1, 'line-color': '#3E5348', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle',
        'target-arrow-color': '#3E5348', 'arrow-scale': .7, label: '', color: '#9FB6A8', 'font-size': 10,
        'text-rotation': 'autorotate', 'text-outline-color': '#0E1512', 'text-outline-width': 3,
      } },
      { selector: '.faded', style: { opacity: .12, 'text-opacity': 0 } },
      { selector: 'node.hub', style: { 'border-width': 7, 'border-color': 'rgba(201,162,39,.32)', 'font-size': 15, 'font-weight': 'bold' } },
      { selector: 'edge.lit', style: { width: 2, 'line-color': '#C9A227', 'target-arrow-color': '#C9A227', label: 'data(label)' } },
      { selector: 'node.isnew', style: { 'border-width': 3, 'border-color': '#C9A227' } },
    ],
  });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layout = cy.layout({
    name: 'cose', animate: !reduced, animationDuration: 700,
    nodeRepulsion: 400000, nodeOverlap: 80, idealEdgeLength: 100, edgeElasticity: 120,
    gravity: 45, componentSpacing: 220, numIter: 1500, padding: 60, randomize: false,
  });
  layout.one('layoutstop', () => { cy.fit(cy.elements(':visible'), 70); if (cy.zoom() > 1.45) { cy.zoom(1.45); cy.center(); } });
  layout.run();
  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    const near = evt.target.closedNeighborhood();
    cy.elements().addClass('faded').removeClass('lit hub');
    near.removeClass('faded').addClass('lit');
    evt.target.addClass('hub');
    state.view = 'entities'; state.open.add(id); render();
    setTimeout(() => goto('entities:' + id), 30);
  });
  cy.on('tap', (evt) => { if (evt.target === cy) cy.elements().removeClass('faded lit hub'); });
  applyGraphFilter();
}
function applyGraphFilter() {
  if (!cy) return;
  const q = state.q.toLowerCase();
  cy.batch(() => {
    for (const n of M.graph.nodes) {
      const e = M.entities.find((x) => x.id === n.id);
      let show = !state.hiddenTypes.has(n.type);
      if (show && state.newOnly && !(e && isNew(e))) show = false;
      if (show && q && n.name.toLowerCase().indexOf(q) === -1) show = false;
      cy.getElementById(n.id).style('display', show ? 'element' : 'none');
      if (e && isNew(e)) cy.getElementById(n.id).addClass('isnew');
    }
  });
}

// ── 繪製 ────────────────────────────────────────────────────────
function render() {
  renderNav();
  const main = el('main');
  main.classList.toggle('graphview', state.view === 'graph');
  if (state.view === 'graph') {
    main.innerHTML = '<div id="cy" role="application" aria-label="人物關係圖"></div>'
      + '<p class="graphtools">點一個角色＝只留下他的糾纏，並跳到他的設定。孤點也在圖上。</p>';
    requestAnimationFrame(mountGraph);
    return;
  }
  main.innerHTML = '<div class="view">'
    + (state.view === 'changes' ? renderChanges()
      : state.view === 'entities' ? renderEntities()
      : state.view === 'chapters' ? renderChapters()
      : renderForeshadow())
    + '</div>';
  main.scrollTop = 0;
  main.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.toggle;
      if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
      render();
    });
  });
  main.querySelectorAll('[data-goto]').forEach((b) => {
    b.addEventListener('click', () => goto(b.dataset.goto));
  });
  const all = el('toggleall');
  if (all) all.addEventListener('click', () => {
    const list = state.view === 'entities' ? entityList() : state.view === 'chapters' ? chapterList() : foreshadowList();
    if (all.dataset.open === 'true') for (const r of list) state.open.add(r.id);
    else for (const r of list) state.open.delete(r.id);
    render();
  });
}

function goto(ref) {
  const idx = ref.indexOf(':');
  const store = ref.slice(0, idx), id = ref.slice(idx + 1);
  const view = store === 'relations' ? 'graph' : store;
  if (!VIEWS.includes(view)) return;
  state.view = view;
  state.newOnly = false;
  state.q = '';
  el('q').value = '';
  state.open.add(id);
  render();
  const target = document.getElementById(store + '-' + id);
  if (target) target.scrollIntoView({ block: 'center' });
}

el('q').addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  if (state.view === 'graph') applyGraphFilter(); else render();
});
const sw = el('newonly');
if (sw) sw.addEventListener('click', () => {
  state.newOnly = !state.newOnly;
  if (state.view === 'graph') { applyGraphFilter(); renderNav(); } else render();
});
const mr = el('markread');
if (mr) mr.addEventListener('click', () => {
  setSeen(new Date().toISOString());
  state.newOnly = false;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== el('q')) { e.preventDefault(); el('q').focus(); }
  if (e.key === 'Escape') { state.q = ''; el('q').value = ''; render(); }
});

// 有沒看過的東西就直接站在「改動」，沒有就從角色開始——
// 打開頁面的第一秒不應該還要自己找。
if (AUTHOR && M.history && M.history.commits.length) {
  const s = seen();
  const fresh = M.history.commits.some((c) => !s || c.at > s);
  state.view = fresh ? 'changes' : 'entities';
}
render();
</script>
</body>
</html>
`;
}
