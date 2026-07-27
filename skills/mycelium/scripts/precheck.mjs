'use strict';
// precheck：動筆前的擋門。
//
// 解決兩個具體的病（作者實際回報的）：
//   1. 考慮不周就開始寫 —— 設定散在好幾個檔案，agent 沒讀就動筆
//   2. 已做過的決定又再考慮一次 —— 沒有任何地方標著「這條拍板了，不要再想」
//
// 做法：把作品 repo 裡的設定文件（markdown）當成一等公民，
// 掃出跟這一章有關的「必讀 / 未決 / 紅線」三張清單，動筆前先攤開。
//
// 純函式在這裡，抓檔與輸出在 mycelium.mjs。

/** 設定文件裡代表「還沒拍板」的標記。命中就進「未決」。 */
export const OPEN_MARKERS = ['未定', '待定', '待建', '還沒拍板', '尚未決定', '待切', '留白', '先不要', '之後再'];

/** 代表「不准做」的標記。命中就進「紅線」。 */
export const RED_MARKERS = ['紅線', '鐵律', '不准', '禁止', '永不', '絕不', '別讓', '不得'];

/** 代表「已經定了、不要再重開」的標記。命中就進「已定案」。 */
export const SETTLED_MARKERS = ['定案', '已定', '寫死', '已拍板'];

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * 把一份 markdown 切成「行 + 它所在的標題路徑」。
 * 標題路徑讓輸出可以說「這一條在 §二 林小雨 底下」，而不是只給行號。
 */
export function outline(text) {
  const rows = [];
  const stack = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: h[2].trim() });
      continue;
    }
    if (!line.trim()) continue;
    rows.push({ line: i + 1, text: line.trim(), section: stack.map((s) => s.title).join(' › ') });
  }
  return rows;
}

// 「未定案」「還沒拍板」裡面包著「定案」「拍板」，字面比對會把否定句判成已定案——
// 意思剛好相反，而且錯的方向最糟（把還沒決定的當成不要再想）。先把否定形拔掉再比。
const NEGATED_SETTLED = /(尚未|還沒|沒有|未|不|沒)(定案|拍板|寫死|已定)/g;

/** 一行文字命中哪些標記類型。同一行可能同時是紅線與未決，兩邊都算。 */
export function classify(text) {
  const kinds = [];
  if (OPEN_MARKERS.some((m) => text.includes(m))) kinds.push('open');
  if (RED_MARKERS.some((m) => text.includes(m))) kinds.push('red');
  // 未決優先：一行只要說了「還沒決定」，它就不是已定案的決定，
  // 即使同一行也出現「寫死」（多半是「別寫死」這種否定用法，中間還可能隔著字）。
  // 判錯的方向要挑安全的那邊——把未決當成定案＝叫人不要再想，最糟。
  const settledText = text.replace(NEGATED_SETTLED, '');
  if (!kinds.includes('open') && SETTLED_MARKERS.some((m) => settledText.includes(m))) kinds.push('settled');
  return kinds;
}

/** 這一行跟哪些關鍵詞有關（章名、章號、角色名…）。 */
export function hitsOf(text, terms) {
  return terms.filter((t) => t && text.includes(t));
}

/**
 * 產生一章的動筆前清單。
 *
 * @param {object} p
 * @param {object} p.chapter     這一章的紀錄（chapters store 的一筆）
 * @param {object[]} p.entities  全部角色/概念
 * @param {object[]} p.relations 全部關係
 * @param {object[]} p.foreshadows 全部伏筆
 * @param {{name:string,text:string}[]} p.docs 作品 repo 裡的設定文件
 * @param {object[]} p.chapters  全部章節（用來找前一章）
 */
export function buildPrecheck({ chapter, entities = [], relations = [], foreshadows = [], docs = [], chapters = [] }) {
  const title = chapter.title || '';
  // 章號（「第七章」）比全名好用：設定文件裡多半只寫章號。
  const numMatch = title.match(/^(序章|終章|第[一二三四五六七八九十百]+章)/);
  const chapterTerms = [title, numMatch && numMatch[1]].filter(Boolean);

  // 會出場的人：先看關係與伏筆有沒有指到這一章，再退回「名字出現在 summary 裡」。
  const text = `${chapter.summary || ''}\n${chapter.content || ''}`;
  const cast = entities.filter((e) => {
    const names = [e.name, ...(e.aliases || [])].filter(Boolean);
    return names.some((n) => text.includes(n));
  });
  const castNames = cast.map((e) => e.name);

  const terms = [...chapterTerms, ...castNames];

  const must = [];
  const open = [];
  const red = [];
  const settled = [];
  for (const doc of docs) {
    for (const row of outline(doc.text)) {
      // 一行要繼承它所在段落的相關性：「不准讓她主動求助」這行沒有角色名，
      // 但它在「二、林小雨」底下，那就是她的紅線。
      const hits = hitsOf(`${row.section}
${row.text}`, terms);
      const kinds = classify(row.text);
      const where = { doc: doc.name, line: row.line, section: row.section, text: row.text, hits };
      // 未決與紅線只要沾到這一章或這一章的人就列；沒沾到的不吵。
      if (hits.length && kinds.includes('open')) open.push(where);
      if (hits.length && kinds.includes('red')) red.push(where);
      // 已定案要印出來，而且要印在未決前面：它的用途是擋掉「把拍板過的又拿出來重想」。
      if (hits.length && kinds.includes('settled')) settled.push(where);
      // 必讀＝提到這一章或這一章的人的段落，不管有沒有標記。
      if (hits.length) must.push(where);
    }
  }

  // 必讀壓成「檔案 › 段落」層級，不要一行一行洗版。
  const sections = [];
  const seen = new Set();
  for (const m of must) {
    const key = `${m.doc}|${m.section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ doc: m.doc, section: m.section, line: m.line });
  }

  const idx = chapters.findIndex((c) => c.id === chapter.id);
  const prev = idx > 0 ? chapters[idx - 1] : null;

  // 伏筆的欄位是 title / plantChapterId / recoverChapterId（不是 name / plantedIn）。
  // 章節 id 對不上章名，所以先把這一章的 id 換算出來再比。
  const openForeshadows = foreshadows.filter((f) => {
    if (f.plantChapterId === chapter.id || f.recoverChapterId === chapter.id) return true;
    const s = `${f.title || ''} ${f.notes || ''}`;
    return chapterTerms.some((t) => s.includes(t));
  });

  return {
    chapter: { title, status: chapter.status || '', wordCount: chapter.wordCount || 0 },
    prev: prev ? { title: prev.title, status: prev.status || '' } : null,
    cast: castNames,
    sections,
    settled,
    open,
    red,
    foreshadows: openForeshadows.map((f) => ({ name: f.title || f.name || '（無標題）', status: f.status || '' })),
  };
}

/** 把清單印成終端機可讀的樣子。回傳字串，方便測試。 */
export function formatPrecheck(pre) {
  const L = [];
  L.push(`${pre.chapter.title}　（狀態：${pre.chapter.status || '未標'}）`);
  if (pre.prev) L.push(`前一章：${pre.prev.title}（${pre.prev.status || '未標'}）`);
  if (pre.cast.length) L.push(`會出場：${pre.cast.join('、')}`);

  L.push('');
  L.push(`── 必讀 ${pre.sections.length} 段 ──`);
  if (!pre.sections.length) L.push('  （設定文件裡沒有提到這一章或這一章的人——這本身就值得先確認）');
  for (const s of pre.sections) L.push(`  ${s.doc}:${s.line}　${s.section || '（開頭）'}`);

  L.push('');
  L.push(`── 已定案 ${(pre.settled || []).length} 條（不要重新考慮，也不要覆蓋）──`);
  if (!(pre.settled || []).length) L.push('  （沒有）');
  for (const s of pre.settled || []) L.push(`  ${s.doc}:${s.line}　${trim(s.text)}`);

  L.push('');
  L.push(`── 未決 ${pre.open.length} 條（動筆前要嘛拍板，要嘛確認可以留白）──`);
  if (!pre.open.length) L.push('  （沒有）');
  for (const o of pre.open) L.push(`  ${o.doc}:${o.line}　${trim(o.text)}`);

  L.push('');
  L.push(`── 紅線 ${pre.red.length} 條 ──`);
  if (!pre.red.length) L.push('  （沒有）');
  for (const r of pre.red) L.push(`  ${r.doc}:${r.line}　${trim(r.text)}`);

  if (pre.foreshadows.length) {
    L.push('');
    L.push(`── 掛在這一章的伏筆 ${pre.foreshadows.length} 條 ──`);
    for (const f of pre.foreshadows) L.push(`  ${f.name}（${f.status || '未標'}）`);
  }

  L.push('');
  L.push('必讀的段落全部讀完之前不要動筆。未決的先問，不要自己決定。已定案的不要重開。');
  return L.join('\n');
}

function trim(s, n = 88) {
  const t = s.replace(/\s+/g, ' ').replace(/^[-*]\s*/, '').replace(/\*\*/g, '');
  return t.length > n ? t.slice(0, n) + '⋯' : t;
}


/**
 * 全書層級的決定總帳：把所有設定文件裡的「已定案 / 未決 / 紅線」攤成一張表。
 *
 * precheck 是「這一章要注意什麼」；這個是「整部作品到底決定了什麼」。
 * 用途是提任何新想法之前先查一次——**這件事是不是已經拍板過了**。
 */
export function buildLedger(docs = [], { kind = null, search = '' } = {}) {
  const rows = [];
  for (const doc of docs) {
    for (const row of outline(doc.text)) {
      const kinds = classify(row.text);
      if (!kinds.length) continue;
      if (kind && !kinds.includes(kind)) continue;
      if (search && !`${row.section}\n${row.text}`.includes(search)) continue;
      rows.push({ doc: doc.name, line: row.line, section: row.section, text: row.text, kinds });
    }
  }
  return rows;
}

const KIND_LABEL = { settled: '定案', open: '未決', red: '紅線' };

export function formatLedger(rows, { kind = null, search = '' } = {}) {
  const L = [];
  const what = kind ? KIND_LABEL[kind] : '決定';
  L.push(`${what}總帳：${rows.length} 條` + (search ? `（只看含「${search}」的）` : ''));
  if (!rows.length) {
    L.push('（沒有符合的。設定文件裡要用「定案／已定／寫死」「未定／待定／留白」「紅線／鐵律／不准」這類字眼標記，這個指令才看得到。）');
    return L.join('\n');
  }
  let lastDoc = '';
  let lastSection = '';
  for (const r of rows) {
    if (r.doc !== lastDoc) { L.push(''); L.push(`【${r.doc}】`); lastDoc = r.doc; lastSection = ''; }
    if (r.section !== lastSection) { L.push(`  ${r.section || '（開頭）'}`); lastSection = r.section; }
    const tag = r.kinds.map((k) => KIND_LABEL[k]).join('・');
    L.push(`    ${String(r.line).padStart(4)}  [${tag}] ${trim(r.text, 76)}`);
  }
  L.push('');
  L.push('提任何新想法之前先查這裡：已定案的不要重開，未決的要問過才決定。');
  return L.join('\n');
}
