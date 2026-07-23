'use strict';
// 產生一份「可以離線點兩下打開」的關係圖 HTML。
//
// 為什麼是檔案而不是網站（#34）：作品設定的日常操作已經全部在對話裡完成，
// 網頁唯一取代不了的只剩「空間佈局」——十幾條關係誰跟誰糾纏，用看的三秒，
// 用講的三分鐘。所以這裡只做那一件事，做到好，其餘全部不做。
//
// 硬性條件：
//   - 單一檔案。cytoscape 與資料都內嵌，不連網、不需要伺服器、不需要 PAT。
//   - 不留下 repo 路徑以外的痕跡：輸出預設在本機快取目錄，因為裡面是真實劇情。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, validRelations } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CYTOSCAPE_PATH = join(HERE, '..', 'vendor', 'cytoscape.min.js');

/**
 * 這個檔案裡是一整部還沒出版的小說的設定與伏筆。寫進一個「有 remote 的 git
 * 工作目錄」，等於離公開只差一次 push——而 push 是每天都會做的動作。
 *
 * 所以不是提醒，是擋下來：往那種目錄寫必須明講 `--force`。
 * 回傳 null 表示安全，否則回傳那個 repo 的路徑。
 */
export function gitTreeWithRemote(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      try {
        // stdio 把 stderr 丟掉：走上去可能撞到壞掉或非 repo 的 .git，
        // 那不是使用者的問題，不該印 git 的錯誤訊息嚇人。
        const remotes = execFileSync('git', ['-C', dir, 'remote'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return remotes ? dir : null;
      } catch {
        return null;
      }
    }
    const up = parse(dir).dir;
    if (!up || up === dir) return null;
    dir = up;
  }
}

// 深林土壤配色：底是腐土，節點是菌絲發的光，強調色是孢子的暖黃。
// 類型的顏色從這一排依序發配，所以「類型」是自由文字也不會沒有顏色。
const TYPE_COLORS = ['#E7EFE6', '#7FA98C', '#C9A227', '#B4644A', '#8FA36B', '#C08552', '#8E9BB5', '#A98BB0'];
const FALLBACK_COLOR = '#5C7266';
// 形狀跟顏色一起分辨類型：只靠顏色的話，21 個一樣的圓點就只是 21 個一樣的圓點。
const TYPE_SHAPES = ['ellipse', 'round-hexagon', 'round-rectangle', 'round-diamond', 'round-tag', 'round-triangle', 'barrel', 'rhomboid'];
const FALLBACK_SHAPE = 'ellipse';

/** 把資料整理成前端要的最小形狀：節點、邊、每個角色的側欄內容。 */
export function buildGraphModel(data) {
  const entities = data.entities || [];
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const relations = validRelations(data.relations || [], entityById);
  const foreshadow = data.foreshadow || [];

  const types = [];
  for (const e of entities) {
    const t = e.type || '未分類';
    if (!types.includes(t)) types.push(t);
  }
  const colorOf = (t) => TYPE_COLORS[types.indexOf(t)] || FALLBACK_COLOR;
  const shapeOf = (t) => TYPE_SHAPES[types.indexOf(t)] || FALLBACK_SHAPE;

  const degree = {};
  for (const r of relations) {
    degree[r.sourceId] = (degree[r.sourceId] || 0) + 1;
    degree[r.targetId] = (degree[r.targetId] || 0) + 1;
  }

  // 節點大小＝牽連多寡。糾纏最多的那個人一眼就看得出來是誰，
  // 這是清單永遠給不了的資訊，也是這張圖存在的理由之一。
  const maxDegree = Math.max(1, ...Object.values(degree));
  const sizeOf = (d) => Math.round(13 + 21 * Math.sqrt(d / maxDegree));

  const nodes = entities.map((e) => ({
    id: e.id,
    name: e.name,
    label: wrapLabel(e.name),
    degree: degree[e.id] || 0,
    size: sizeOf(degree[e.id] || 0),
    type: e.type || '未分類',
    color: colorOf(e.type || '未分類'),
    shape: shapeOf(e.type || '未分類'),
    aliases: e.aliases || [],
    tags: e.tags || [],
    notes: e.notes || '',
    fields: (e.customFields || []).map((f) => ({ key: f.key, value: f.value })),
    foreshadow: foreshadow
      .filter((f) => (f.relatedEntityIds || []).includes(e.id))
      .map((f) => ({ title: f.title, status: f.status })),
  }));

  const edges = relations.map((r) => ({
    id: r.id,
    source: r.sourceId,
    target: r.targetId,
    type: r.type || '關係',
    notes: r.notes || '',
  }));

  const legend = types.map((t) => ({
    type: t,
    color: colorOf(t),
    shape: shapeOf(t),
    count: entities.filter((e) => (e.type || '未分類') === t).length,
  }));

  return { nodes, edges, legend };
}

/**
 * 圖上的節點標籤要自己斷行：cytoscape 的 text-wrap 只在空白處斷，
 * 中文名字沒有空白，長名字就會壓成一條蓋掉旁邊的節點。這裡每 6 個字斷一次，
 * 最多三行，超過的用刪節號——完整名字在側欄，圖上只要認得出是誰。
 */
function wrapLabel(name, per = 6, maxLines = 3) {
  const s = String(name || '');
  if (/\s/.test(s)) return s;
  const lines = [];
  for (let i = 0; i < s.length; i += per) lines.push(s.slice(i, i + per));
  if (lines.length > maxLines) return lines.slice(0, maxLines - 1).concat(lines[maxLines - 1].slice(0, per - 1) + '…').join('\n');
  return lines.join('\n');
}

/** `</script` 是唯一能從 JSON 字串裡逃出 <script> 區塊的序列。 */
function embedJson(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><g stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><path d="M32 32 L16 20"/><path d="M32 32 L48 18"/><path d="M32 32 L15 44"/><path d="M32 32 L47 46"/><path d="M32 32 L32 14"/><path d="M16 20 L9 12"/><path d="M16 20 L8 24"/></g><circle cx="32" cy="32" r="6.5" fill="currentColor"/><circle cx="16" cy="20" r="4" fill="currentColor"/><circle cx="48" cy="18" r="4" fill="currentColor"/><circle cx="15" cy="44" r="4" fill="currentColor"/><circle cx="47" cy="46" r="4" fill="currentColor"/><circle cx="32" cy="14" r="3" fill="currentColor"/><circle cx="9" cy="12" r="2.6" fill="currentColor"/><circle cx="8" cy="24" r="2.6" fill="currentColor"/></svg>`;

// 圖例的色塊要跟圖上的形狀對得起來，否則形狀就變成沒有人看得懂的裝飾。
const SWATCH_CLASS = {
  ellipse: 's-circle', 'round-hexagon': 's-hex', 'round-rectangle': 's-square',
  'round-diamond': 's-diamond', 'round-tag': 's-tag', 'round-triangle': 's-tri',
  barrel: 's-square', rhomboid: 's-tag',
};

export function buildGraphHtml({ model, title, generatedAt }) {
  const cytoscape = readFileSync(CYTOSCAPE_PATH, 'utf8');
  const legend = model.legend
    .map((l) => `<li><button type="button" class="type" data-type="${esc(l.type)}" aria-pressed="true">`
      + `<span class="dot ${SWATCH_CLASS[l.shape] || ''}" style="background:${l.color}"></span>`
      + `${esc(l.type)}<b>${l.count}</b></button></li>`)
    .join('');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}・關係圖</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2d4a3e"/><circle cx="32" cy="32" r="9" fill="#eaf3ee"/></svg>')}">
<style>
:root{
  --soil:#0E1512; --loam:#17211C; --crust:#212D26;
  --filament:#E7EFE6; --moss:#7E9A88; --dusk:#55695D;
  --spore:#C9A227;
  --serif:"Noto Serif CJK TC","Source Han Serif TC","Songti TC",PMingLiU,"Times New Roman",serif;
  --sans:"Noto Sans CJK TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
  --mono:"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--soil);color:var(--filament);
  font-family:var(--sans);font-size:15px;line-height:1.7;
  overflow:hidden;
  -webkit-font-smoothing:antialiased;
}
/* 版面：頁首 / 圖 + 側欄 */
.shell{display:flex;flex-direction:column;height:100%}

header{
  display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;
  padding:14px 22px;border-bottom:1px solid var(--crust);
  background:var(--soil);
}
header .mark{width:22px;height:22px;color:var(--moss);align-self:center;flex:none}
header .mark svg{width:100%;height:100%;display:block}
h1{
  margin:0;font-family:var(--serif);font-weight:600;
  font-size:21px;letter-spacing:.06em;
}
h1 small{font-family:var(--sans);font-size:12px;font-weight:400;letter-spacing:.22em;color:var(--dusk);margin-left:10px}
.counts{font-family:var(--mono);font-size:12px;color:var(--moss);letter-spacing:.04em}
.counts b{color:var(--filament);font-weight:600}
.stamp{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--dusk)}

.stage{flex:1;display:flex;min-height:0;position:relative}

#cy{flex:1;min-width:0;background:
  radial-gradient(120% 90% at 50% 40%, #16211C 0%, var(--soil) 70%);}

/* 工具列浮在圖上，不佔版面 */
.tools{
  position:absolute;top:14px;left:14px;z-index:3;
  display:flex;flex-direction:column;gap:10px;align-items:flex-start;
  pointer-events:none;
}
.tools > *{pointer-events:auto}
#q{
  width:200px;padding:8px 12px;border-radius:999px;
  background:rgba(23,33,28,.9);border:1px solid var(--crust);
  color:var(--filament);font:inherit;font-size:13px;
  backdrop-filter:blur(6px);
}
#q::placeholder{color:var(--dusk)}
#q:focus{outline:2px solid var(--spore);outline-offset:1px;border-color:transparent}
.legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;max-width:340px;
  font-size:12px;color:var(--moss);letter-spacing:.02em}
.legend li{display:flex}
.type{
  display:flex;align-items:center;gap:6px;background:none;border:0;padding:2px 0;
  font:inherit;font-size:12px;color:var(--moss);cursor:pointer;letter-spacing:.02em;
}
.type:hover{color:var(--filament)}
.type:focus-visible{outline:2px solid var(--spore);outline-offset:2px;border-radius:3px}
.type[aria-pressed="false"]{color:var(--dusk);text-decoration:line-through}
.type[aria-pressed="false"] .dot{opacity:.28}
.legend b{font-family:var(--mono);font-weight:400;color:var(--dusk)}
.dot{width:9px;height:9px;display:inline-block;flex:none}
.s-circle{border-radius:50%}
.s-square{border-radius:2px}
.s-diamond{border-radius:2px;transform:rotate(45deg) scale(.85)}
.s-hex{clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}
.s-tag{clip-path:polygon(0 0,72% 0,100% 50%,72% 100%,0 100%)}
.s-tri{clip-path:polygon(50% 0,100% 100%,0 100%)}
.toggle{
  background:rgba(23,33,28,.9);border:1px solid var(--crust);border-radius:999px;
  color:var(--moss);font:inherit;font-size:12px;padding:5px 13px;cursor:pointer;
  backdrop-filter:blur(6px);
}
.toggle:hover{color:var(--filament);border-color:var(--dusk)}
.toggle:focus-visible{outline:2px solid var(--spore);outline-offset:1px}
.toggle[aria-pressed="true"]{color:var(--soil);background:var(--spore);border-color:var(--spore)}
.hint{font-size:12px;color:var(--dusk);max-width:260px}
kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--crust);border-radius:4px;padding:0 4px;color:var(--moss)}

/* 側欄：預設收著一行提示，選了角色才長出內容 */
aside{
  width:340px;flex:none;border-left:1px solid var(--crust);
  background:var(--loam);overflow-y:auto;padding:26px 24px 40px;
}
aside .empty{color:var(--dusk);font-size:14px}
aside .empty p{margin:0 0 14px}
.who{font-family:var(--serif);font-size:28px;line-height:1.3;margin:0 0 4px;letter-spacing:.04em}
.kind{display:inline-flex;align-items:center;gap:7px;font-size:12px;letter-spacing:.14em;color:var(--moss);margin-bottom:20px}
.alias{
  font-family:var(--serif);font-size:15px;color:var(--spore);
  margin:0 0 18px;line-height:1.6;
}
.alias span{color:var(--dusk);font-family:var(--sans);font-size:11px;letter-spacing:.18em;display:block;margin-bottom:2px}
h2{
  font-size:11px;font-weight:500;letter-spacing:.22em;color:var(--dusk);
  margin:24px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--crust);
}
.notes{margin:0;white-space:pre-wrap;color:#CFDBD2;font-size:14px}
.notes b{color:var(--filament);font-weight:600}
.pairs{margin:0;font-size:13px}
.pairs div{display:flex;gap:10px;padding:3px 0}
.pairs dt{color:var(--dusk);flex:none;min-width:64px}
.pairs dd{margin:0;color:#CFDBD2}
ul.list{list-style:none;margin:0;padding:0;font-size:14px}
ul.list li{padding:5px 0}
.jump{
  background:none;border:0;padding:0;font:inherit;color:var(--filament);
  cursor:pointer;text-align:left;border-bottom:1px solid var(--dusk);
}
.jump:hover,.jump:focus-visible{color:var(--spore);border-color:var(--spore);outline:none}
.rel-type{color:var(--moss);font-size:12px;margin:0 4px}
.rel-notes{margin:2px 0 0;font-size:12.5px;color:var(--dusk);line-height:1.6}
.tag{display:inline-block;font-size:12px;color:var(--moss);border:1px solid var(--crust);
  border-radius:999px;padding:1px 10px;margin:0 5px 5px 0}
.status{font-family:var(--mono);font-size:11px;color:var(--dusk);margin-left:6px}
.none{color:var(--dusk);font-size:13px}

@media (max-width:820px){
  .stage{flex-direction:column}
  aside{width:auto;border-left:0;border-top:1px solid var(--crust);max-height:44vh}
  .legend{max-width:60vw}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<div class="shell">
  <header>
    <span class="mark">${MARK}</span>
    <h1>${esc(title)}<small>關係圖</small></h1>
    <span class="counts">角色 <b id="n-count">0</b>　關係 <b id="e-count">0</b></span>
    <span class="stamp">${esc(generatedAt)}</span>
  </header>
  <div class="stage">
    <div id="cy" role="application" aria-label="人物關係圖"></div>
    <div class="tools">
      <input id="q" type="search" placeholder="搜尋名字或別名" aria-label="搜尋名字或別名" autocomplete="off">
      <ul class="legend">${legend}</ul>
      <button id="solo" type="button" class="toggle" aria-pressed="false" hidden></button>
      <p class="hint">點一個角色，只留下他的糾纏。<kbd>Esc</kbd> 放回全圖。</p>
    </div>
    <aside id="panel" aria-live="polite">
      <div class="empty">
        <p>還沒選角色。</p>
        <p>點圖上任何一個節點，這裡會長出他的設定、別名，以及他跟誰糾纏在一起。</p>
      </div>
    </aside>
  </div>
</div>

<script>${cytoscape}</script>
<script>
'use strict';
const MODEL = ${embedJson(model)};

const byId = Object.fromEntries(MODEL.nodes.map((n) => [n.id, n]));
document.getElementById('n-count').textContent = MODEL.nodes.length;
document.getElementById('e-count').textContent = MODEL.edges.length;

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [
    ...MODEL.nodes.map((n) => ({ data: { id: n.id, label: n.label, color: n.color, shape: n.shape, size: n.size } })),
    ...MODEL.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, label: e.type } })),
  ],
  style: [
    { selector: 'node', style: {
      'background-color': 'data(color)', shape: 'data(shape)',
      width: 'data(size)', height: 'data(size)',
      label: 'data(label)', color: '#E7EFE6', 'font-family': '"Noto Sans CJK TC","PingFang TC",sans-serif',
      'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 6, 'text-outline-color': '#0E1512',
      'text-outline-width': 3, 'text-wrap': 'wrap', 'text-max-width': 96,
      'transition-property': 'opacity', 'transition-duration': '160ms',
    } },
    { selector: 'edge', style: {
      width: 1, 'line-color': '#3E5348', 'curve-style': 'bezier',
      'target-arrow-shape': 'triangle', 'target-arrow-color': '#3E5348', 'arrow-scale': .7,
      label: '', color: '#9FB6A8', 'font-size': 10, 'text-rotation': 'autorotate',
      'text-outline-color': '#0E1512', 'text-outline-width': 3,
      'transition-property': 'opacity', 'transition-duration': '160ms',
    } },
    // 聚焦：選中的角色與他的直接關係留著發光，其餘退成土裡的絲。
    { selector: '.faded', style: { opacity: .12, 'text-opacity': 0 } },
    { selector: 'node.lit', style: { 'font-size': 13 } },
    { selector: 'node.hub', style: { 'border-width': 7, 'border-color': 'rgba(201,162,39,.32)', 'font-size': 15, 'font-weight': 'bold' } },
    { selector: 'edge.lit', style: { width: 2, 'line-color': '#C9A227', 'target-arrow-color': '#C9A227', label: 'data(label)' } },
    { selector: '.miss', style: { opacity: .1, 'text-opacity': 0 } },
    { selector: 'node.hit', style: { 'border-width': 4, 'border-color': 'rgba(201,162,39,.5)' } },
  ],
});

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const layout = cy.layout({
  name: 'cose', animate: !reduced, animationDuration: 700,
  // cose 的預設斥力是給「節點是小圓點」用的；這裡每個節點下面掛著中文名字，
  // 所以 nodeOverlap 要大很多，名字才不會互相蓋掉。
  nodeRepulsion: 400000, nodeOverlap: 80, idealEdgeLength: 100, edgeElasticity: 120,
  gravity: 45, componentSpacing: 220, numIter: 1500, padding: 60, randomize: false,
});
// cose 的 fit 是在**動畫開始前**算的，動畫把節點推開之後就不準了（整張圖會停在
// 放大好幾倍的位置）。所以等它停下來、再自己 fit 一次，這才是使用者看到的那一幀。
layout.one('layoutstop', () => refit());
layout.run();
window.addEventListener('resize', () => { cy.resize(); refit(); });

// fit 之後把倍率壓回 1 以內：節點少的時候 fit 會放大到兩三倍，
// 字會大得像海報，反而看不出整張網的形狀。
function refit() {
  cy.resize();
  const shown = cy.elements(':visible');
  if (!shown.length) return;
  cy.fit(shown, 80);
  // 節點少的時候 fit 會放大到兩三倍，字大得像海報反而看不出整張網的形狀；
  // 但也不能一律壓回 1，那樣一小撮節點會縮在正中央、四周全是空地。
  if (cy.zoom() > 1.45) { cy.zoom(1.45); cy.center(shown); }
}

const panel = document.getElementById('panel');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function relationsOf(id) {
  const out = [];
  for (const e of MODEL.edges) {
    if (e.source === id) out.push({ other: e.target, type: e.type, notes: e.notes, dir: '→' });
    else if (e.target === id) out.push({ other: e.source, type: e.type, notes: e.notes, dir: '←' });
  }
  return out;
}

// 設定內文常是使用者在對話裡寫的 markdown。這裡只認 **粗體** 一種——
// 那是他標重點的方式，留著滿滿的星號比不渲染還難讀。其餘一律當純文字。
function inline(s) {
  // 用字元類別寫，不用反斜線跳脫：這段程式碼是從 node 端的樣板字串印出來的，
  // 樣板字串會把 \* 吃掉，正規表達式就會在中途斷掉（整個檔案跟著壞）。
  return esc(s).replace(/[*][*]([^*]+)[*][*]/g, '<b>$1</b>');
}

function section(label, html) {
  return '<h2>' + label + '</h2>' + html;
}

function renderPanel(id) {
  const n = byId[id];
  if (!n) return;
  const rels = relationsOf(id);
  const parts = [];
  parts.push('<p class="who">' + esc(n.name) + '</p>');
  parts.push('<p class="kind"><span class="dot" style="background:' + esc(n.color) + '"></span>' + esc(n.type) + '</p>');
  if (n.aliases.length) {
    parts.push('<p class="alias"><span>別名</span>' + n.aliases.map(esc).join('・') + '</p>');
  }
  if (n.tags.length) {
    parts.push(n.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join(''));
  }
  parts.push(section('設定', n.notes ? '<p class="notes">' + inline(n.notes) + '</p>' : '<p class="none">（空）</p>'));
  if (n.fields.length) {
    parts.push(section('欄位', '<dl class="pairs">' + n.fields
      .map((f) => '<div><dt>' + esc(f.key) + '</dt><dd>' + esc(f.value) + '</dd></div>').join('') + '</dl>'));
  }
  parts.push(section('關係　' + rels.length, rels.length
    ? '<ul class="list">' + rels.map((r) => {
        const other = byId[r.other];
        const arrow = r.dir === '→' ? '—' + esc(r.type) + '→' : '←' + esc(r.type) + '—';
        return '<li><span class="rel-type">' + arrow + '</span>'
          + '<button class="jump" data-go="' + esc(r.other) + '">' + esc(other ? other.name : '?') + '</button>'
          + (r.notes ? '<p class="rel-notes">' + esc(r.notes) + '</p>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="none">還沒有跟任何人連起來。</p>'));
  if (n.foreshadow.length) {
    parts.push(section('相關伏筆　' + n.foreshadow.length, '<ul class="list">' + n.foreshadow
      .map((f) => '<li>' + esc(f.title) + '<span class="status">' + esc(f.status) + '</span></li>').join('') + '</ul>'));
  }
  panel.innerHTML = parts.join('');
  panel.scrollTop = 0;
  panel.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => focusNode(b.dataset.go, true));
  });
}

function clearFocus() {
  cy.elements().removeClass('faded lit hub');
}

function focusNode(id, center) {
  const node = cy.getElementById(id);
  if (!node || node.empty()) return;
  const near = node.closedNeighborhood();
  cy.elements().addClass('faded').removeClass('lit hub');
  near.removeClass('faded').addClass('lit');
  node.addClass('hub');
  if (center && !reduced) cy.animate({ center: { eles: node } }, { duration: 260 });
  renderPanel(id);
}

cy.on('tap', 'node', (evt) => focusNode(evt.target.id(), false));
cy.on('tap', (evt) => { if (evt.target === cy) clearFocus(); });

// 搜尋：命中的留著，其餘退到底。名字與別名都算命中。
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase();
  if (!term) { cy.elements().removeClass('miss hit'); return; }
  const hit = new Set(MODEL.nodes
    .filter((n) => [n.name, ...n.aliases].some((s) => String(s).toLowerCase().includes(term)))
    .map((n) => n.id));
  cy.nodes().forEach((n) => {
    const ok = hit.has(n.id());
    n.toggleClass('hit', ok); n.toggleClass('miss', !ok);
  });
  cy.edges().forEach((e) => e.toggleClass('miss', !(hit.has(e.source().id()) && hit.has(e.target().id()))));
});

// 畫不畫一個節點只有一個地方決定，避免「類型篩選」跟「孤點開關」互相蓋掉。
//   - 沒有任何關係的角色預設不畫：它們散在四周，會把真正的關係網擠成中間一小團。
//     但不能當作不存在——按鈕永遠寫著還有幾個。
//   - 圖例本身就是類型篩選器：只想看人物之間怎麼糾纏的時候，把其他類型關掉。
const hiddenTypes = new Set();
let showLonely = false;
const lonely = MODEL.nodes.filter((n) => n.degree === 0);

function visible(n) {
  if (hiddenTypes.has(n.type)) return false;
  if (n.degree === 0 && !showLonely) return false;
  return true;
}

function applyVisibility() {
  cy.batch(() => {
    for (const n of MODEL.nodes) {
      cy.getElementById(n.id).style('display', visible(n) ? 'element' : 'none');
    }
  });
  refit();
}

const solo = document.getElementById('solo');
if (lonely.length) {
  solo.hidden = false;
  const label = () => { solo.textContent = (showLonely ? '藏起' : '顯示') + '還沒牽上線的 ' + lonely.length + ' 個'; };
  label();
  solo.addEventListener('click', () => {
    showLonely = !showLonely;
    solo.setAttribute('aria-pressed', String(showLonely));
    label();
    applyVisibility();
  });
}

document.querySelectorAll('.type').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.type;
    const on = !hiddenTypes.has(kind);
    if (on) hiddenTypes.add(kind); else hiddenTypes.delete(kind);
    btn.setAttribute('aria-pressed', String(!on));
    applyVisibility();
  });
});

applyVisibility();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearFocus();
    if (document.activeElement === q) { q.value = ''; q.dispatchEvent(new Event('input')); }
  }
  if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
});
</script>
</body>
</html>
`;
}
