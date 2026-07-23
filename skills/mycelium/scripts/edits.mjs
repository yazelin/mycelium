'use strict';
// 就地編輯／新增／刪除：對一份完整的 data（五個 store 的陣列）做修改。
//
// 這裡全部是純函式：吃 data、回傳「新的 data + 一份人看得懂的 log」，不碰網路、
// 不碰檔案，所以可以在測試裡直接驗證，CLI 只負責抓資料、呼叫、寫回去。
//
// 三條不可以違反的規則：
//
// 1. **編輯一定保留 id**（走 `{ ...existing, 欄位 }`）。改 id 等於刪掉再重建：
//    伏筆指向的章節會變成孤兒、指向角色的關係會被連帶刪掉。
// 2. **刪除 entity 一定連帶刪掉它的關係**（records.mjs 的
//    relationsAffectedByEntityDelete），不各做各的。
// 3. 章節排序、伏筆逾期、狀態列舉一律從 records.mjs 拿。
import { PROJECT_STORES } from './schema.mjs';
import {
  CHAPTER_STATUSES, FORESHADOW_STATUSES, VISUAL_FIELDS, emptyVisual,
  foreshadowReferencingChapter, foreshadowReferencingEntity, foreshadowReferencingRelation,
  relationsAffectedByEntityDelete,
} from './records.mjs';
import { assertValidProjectData, newId } from './candidates.mjs';

export const RECORD_TYPES = ['entity', 'chapter', 'foreshadow', 'relation'];
const STORE_OF = { entity: 'entities', chapter: 'chapters', foreshadow: 'foreshadow', relation: 'relations' };

/** 深一層的複製：每個 store 都換成新陣列、每筆紀錄都換成新物件，原始 data 不被動到。 */
function cloneData(data) {
  const next = {};
  for (const store of PROJECT_STORES) next[store] = (data[store] || []).map((r) => ({ ...r }));
  return next;
}

function asList(v) {
  if (v === undefined || v === null || v === true) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => String(s).trim()).filter(Boolean);
}

function isDefined(v) {
  return v !== undefined && v !== null && v !== true;
}

function requireText(v, label) {
  const s = String(v).trim();
  if (!s) throw new Error(`${label}不可以是空的，未變更任何資料。`);
  return s;
}

// ── 找紀錄 ──────────────────────────────────────────────────────────────

function ambiguous(label, hits, nameOf) {
  return new Error(`「${label}」對到 ${hits.length} 筆：${hits.map(nameOf).join('、')}。請改用 id 指定，未變更任何資料。`);
}

export function findEntity(data, ref) {
  const key = requireText(ref, '角色代號');
  const list = data.entities || [];
  const byId = list.find((e) => e.id === key);
  if (byId) return byId;
  const exact = list.filter((e) => e.name === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(key, exact, (e) => `${e.name}(${e.id})`);
  const alias = list.filter((e) => (e.aliases || []).includes(key));
  if (alias.length === 1) return alias[0];
  if (alias.length > 1) throw ambiguous(key, alias, (e) => `${e.name}(${e.id})`);
  const fuzzy = list.filter((e) => e.name.includes(key));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw ambiguous(key, fuzzy, (e) => e.name);
  throw new Error(`設定庫裡找不到角色「${key}」，未變更任何資料。`);
}

export function findChapter(data, ref) {
  const key = requireText(ref, '章節代號');
  const list = data.chapters || [];
  const byId = list.find((c) => c.id === key);
  if (byId) return byId;
  const exact = list.filter((c) => c.title === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(key, exact, (c) => `第${c.volume}卷・${c.title}(${c.id})`);
  const fuzzy = list.filter((c) => String(c.title || '').includes(key));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw ambiguous(key, fuzzy, (c) => `第${c.volume}卷・${c.title}`);
  throw new Error(`找不到章節「${key}」，未變更任何資料。`);
}

export function findForeshadow(data, ref) {
  const key = requireText(ref, '伏筆代號');
  const list = data.foreshadow || [];
  const byId = list.find((f) => f.id === key);
  if (byId) return byId;
  const exact = list.filter((f) => f.title === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(key, exact, (f) => `${f.title}(${f.id})`);
  const fuzzy = list.filter((f) => String(f.title || '').includes(key));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw ambiguous(key, fuzzy, (f) => f.title);
  throw new Error(`找不到伏筆「${key}」，未變更任何資料。`);
}

/** 關係可以用 id，也可以用「來源>目標」（例：`林小雨>城主`）。 */
export function findRelation(data, ref) {
  const key = requireText(ref, '關係代號');
  const list = data.relations || [];
  const byId = list.find((r) => r.id === key);
  if (byId) return byId;
  if (key.includes('>')) {
    const [s, t] = key.split('>').map((x) => x.trim());
    const source = findEntity(data, s);
    const target = findEntity(data, t);
    const hits = list.filter((r) => r.sourceId === source.id && r.targetId === target.id);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw ambiguous(key, hits, (r) => `${r.type}(${r.id})`);
  }
  throw new Error(`找不到關係「${key}」。可以用關係 id，或「來源>目標」，未變更任何資料。`);
}

export function findRecord(data, type, ref) {
  if (type === 'entity') return findEntity(data, ref);
  if (type === 'chapter') return findChapter(data, ref);
  if (type === 'foreshadow') return findForeshadow(data, ref);
  if (type === 'relation') return findRelation(data, ref);
  throw new Error(`不認得的類型「${type}」，可用：${RECORD_TYPES.join(' / ')}。`);
}

export function describeRecord(data, type, rec) {
  if (type === 'entity') return `${rec.name}［${rec.type || '未分類'}］`;
  if (type === 'chapter') return `第${rec.volume}卷・${rec.title}［${rec.status}］`;
  if (type === 'foreshadow') return `${rec.title}［${rec.status}］`;
  const byId = Object.fromEntries((data.entities || []).map((e) => [e.id, e]));
  const s = (byId[rec.sourceId] || {}).name || '（已刪除）';
  const t = (byId[rec.targetId] || {}).name || '（已刪除）';
  return `${s} —${rec.type}→ ${t}`;
}

/** 把修改後的紀錄放回 store，位置不動（id 相同的那一筆換掉）。 */
function replaceIn(list, updated) {
  const idx = list.findIndex((r) => r.id === updated.id);
  if (idx === -1) throw new Error(`內部錯誤：找不到 id ${updated.id}，未變更任何資料。`);
  list[idx] = updated;
  return list;
}

function finish(next, log) {
  assertValidProjectData(next);
  return { data: next, log };
}

// ── 編輯 ────────────────────────────────────────────────────────────────

function parseFieldPair(raw) {
  const s = String(raw);
  const idx = s.search(/[:=：]/);
  if (idx === -1) throw new Error(`--field 要寫成「欄位名=值」，收到「${s}」，未變更任何資料。`);
  const key = s.slice(0, idx).trim();
  if (!key) throw new Error(`--field 的欄位名不可以是空的（收到「${s}」），未變更任何資料。`);
  return { key, value: s.slice(idx + 1).trim() };
}

/**
 * 角色的視覺版本（`visuals`）。畫師與生圖模型要的是可畫的規格，而且同一個角色
 * 在不同時期長得不一樣——第一卷的艾可，跟第二卷被清空記憶之後的艾可。
 *
 * 所以版本是陣列不是單一組欄位，而且**指定版本名是必要的**：不講清楚在改哪一版，
 * 就等於預設只有一版，那正是這裡要避免的事。
 */
function applyVisualSpec(updated, spec, log) {
  const version = isDefined(spec.visual) ? String(spec.visual).trim() : null;
  const visuals = (updated.visuals || []).map((v) => ({ ...v }));

  for (const raw of asList(spec.rmVisual)) {
    const i = visuals.findIndex((v) => v.version === raw);
    if (i === -1) throw new Error(`「${updated.name}」沒有視覺版本「${raw}」，未變更任何資料。`);
    visuals.splice(i, 1);
    log.push(`移除視覺版本「${raw}」。`);
  }

  const wanted = VISUAL_FIELDS.filter((f) => isDefined(spec[f.spec]));
  if (wanted.length && !version) {
    throw new Error('要改視覺設定得先講哪一版，例如 --visual 第一卷（同一個角色可以有很多版），未變更任何資料。');
  }
  if (version) {
    let hit = visuals.find((v) => v.version === version);
    if (!hit) {
      hit = emptyVisual(version);
      visuals.push(hit);
      log.push(`新增視覺版本「${version}」（欄位先立好，內容可以之後再填）。`);
    }
    for (const f of wanted) {
      hit[f.key] = String(spec[f.spec]);
      log.push(`視覺版本「${version}」的${f.label}已更新。`);
    }
  }

  if (visuals.length || (updated.visuals || []).length) updated.visuals = visuals;
}

export function editEntity(data, ref, spec = {}) {
  const next = cloneData(data);
  const existing = findEntity(next, ref);
  const log = [];
  // 保留 id：這一行就是整個 skill 最重要的一行。
  const updated = { ...existing };

  if (isDefined(spec.rename)) {
    const name = requireText(spec.rename, '角色名稱');
    const clash = next.entities.find((e) => e.id !== existing.id && (e.name === name || (e.aliases || []).includes(name)));
    if (clash) throw new Error(`「${name}」已經是「${clash.name}」的名稱或別名，改名會產生重複角色，未變更任何資料。`);
    updated.name = name;
    log.push(`改名：「${existing.name}」→「${name}」。`);
  }
  if (isDefined(spec.type)) { updated.type = String(spec.type).trim(); log.push(`類型改為「${updated.type || '（空）'}」。`); }
  if (isDefined(spec.notes)) { updated.notes = String(spec.notes); log.push('更新設定內容。'); }

  const aliases = Array.from(updated.aliases || []);
  for (const a of asList(spec.addAlias)) {
    if (a === updated.name) throw new Error(`「${a}」就是本名，不能同時當自己的別名，未變更任何資料。`);
    const clash = next.entities.find((e) => e.id !== existing.id && (e.name === a || (e.aliases || []).includes(a)));
    if (clash) throw new Error(`別名「${a}」已經屬於「${clash.name}」，未變更任何資料。`);
    if (!aliases.includes(a)) { aliases.push(a); log.push(`新增別名「${a}」。`); }
  }
  for (const a of asList(spec.rmAlias)) {
    const i = aliases.indexOf(a);
    if (i === -1) throw new Error(`「${existing.name}」沒有別名「${a}」，未變更任何資料。`);
    aliases.splice(i, 1);
    log.push(`移除別名「${a}」。`);
  }
  updated.aliases = aliases;

  const tags = Array.from(updated.tags || []);
  for (const t of asList(spec.addTag)) if (!tags.includes(t)) { tags.push(t); log.push(`新增標籤「${t}」。`); }
  for (const t of asList(spec.rmTag)) {
    const i = tags.indexOf(t);
    if (i === -1) throw new Error(`「${existing.name}」沒有標籤「${t}」，未變更任何資料。`);
    tags.splice(i, 1);
    log.push(`移除標籤「${t}」。`);
  }
  updated.tags = tags;

  const fields = (updated.customFields || []).map((f) => ({ ...f }));
  for (const raw of asList(spec.field)) {
    const { key, value } = parseFieldPair(raw);
    const hit = fields.find((f) => f.key === key);
    if (hit) { hit.value = value; log.push(`自訂欄位「${key}」改為「${value}」。`); }
    else { fields.push({ key, value }); log.push(`新增自訂欄位「${key}: ${value}」。`); }
  }
  for (const key of asList(spec.rmField)) {
    const i = fields.findIndex((f) => f.key === key);
    if (i === -1) throw new Error(`「${existing.name}」沒有自訂欄位「${key}」，未變更任何資料。`);
    fields.splice(i, 1);
    log.push(`移除自訂欄位「${key}」。`);
  }
  if (fields.length || (updated.customFields || []).length) updated.customFields = fields;

  applyVisualSpec(updated, spec, log);

  if (!log.length) throw new Error('沒有指定任何要改的欄位，未變更任何資料。');
  replaceIn(next.entities, updated);
  return finish(next, [`角色「${updated.name}」（id ${updated.id}）：`, ...log]);
}

export function editChapter(data, ref, spec = {}) {
  const next = cloneData(data);
  const existing = findChapter(next, ref);
  const log = [];
  const updated = { ...existing };

  if (isDefined(spec.status)) {
    const status = String(spec.status).trim();
    if (!CHAPTER_STATUSES.includes(status)) {
      throw new Error(`章節狀態只能是 ${CHAPTER_STATUSES.join(' / ')}，收到「${status}」，未變更任何資料。`);
    }
    updated.status = status;
    log.push(`狀態：${existing.status} → ${status}。`);
  }
  if (isDefined(spec.title)) { updated.title = requireText(spec.title, '章節標題'); log.push(`標題改為「${updated.title}」。`); }
  if (isDefined(spec.summary)) { updated.summary = String(spec.summary); log.push('更新摘要。'); }
  if (isDefined(spec.volume)) {
    const v = Number(spec.volume);
    if (!Number.isFinite(v) || v < 1) throw new Error(`卷數要是 1 以上的數字，收到「${spec.volume}」，未變更任何資料。`);
    updated.volume = v;
    log.push(`卷數改為 ${v}。`);
  }
  if (isDefined(spec.wordCount)) {
    const n = Number(spec.wordCount);
    if (!Number.isFinite(n) || n < 0) throw new Error(`字數要是 0 以上的數字，收到「${spec.wordCount}」，未變更任何資料。`);
    updated.wordCount = n;
    log.push(`字數改為 ${n}。`);
  }
  if (isDefined(spec.order)) {
    const n = Number(spec.order);
    if (!Number.isFinite(n)) throw new Error(`順序要是數字，收到「${spec.order}」，未變更任何資料。`);
    updated.order = n;
    log.push(`卷內順序改為 ${n}。`);
  }
  if (isDefined(spec.content)) {
    const content = String(spec.content);
    updated.content = content;
    // 正文是這個 app 裡最高價值的資料，覆蓋前後的字數都要講清楚。
    log.push(`正文覆蓋：${(existing.content || '').length} 字 → ${content.length} 字。`);
  }

  if (!log.length) throw new Error('沒有指定任何要改的欄位，未變更任何資料。');
  replaceIn(next.chapters, updated);
  return finish(next, [`章節「第${updated.volume}卷・${updated.title}」（id ${updated.id}）：`, ...log]);
}

function chapterRefOrNull(next, value, label) {
  const s = String(value).trim();
  if (s === '' || s === 'none' || s === '無' || s === '不指定') return null;
  const ch = findChapter(next, s);
  return ch.id;
}

export function editForeshadow(data, ref, spec = {}) {
  const next = cloneData(data);
  const existing = findForeshadow(next, ref);
  const log = [];
  const updated = { ...existing };

  if (isDefined(spec.status)) {
    const status = String(spec.status).trim();
    if (!FORESHADOW_STATUSES.includes(status)) {
      throw new Error(`伏筆狀態只能是 ${FORESHADOW_STATUSES.join(' / ')}，收到「${status}」，未變更任何資料。`);
    }
    updated.status = status;
    log.push(`狀態：${existing.status} → ${status}。`);
  }
  if (isDefined(spec.title)) { updated.title = requireText(spec.title, '伏筆名稱'); log.push(`名稱改為「${updated.title}」。`); }
  if (isDefined(spec.notes)) { updated.notes = String(spec.notes); log.push('更新備註。'); }
  if (spec.plant !== undefined) {
    updated.plantChapterId = chapterRefOrNull(next, spec.plant === true ? '' : spec.plant, '埋設章節');
    const ch = next.chapters.find((c) => c.id === updated.plantChapterId);
    log.push(`埋設章節：${ch ? `第${ch.volume}卷・${ch.title}` : '（不指定）'}。`);
  }
  if (spec.recover !== undefined) {
    updated.recoverChapterId = chapterRefOrNull(next, spec.recover === true ? '' : spec.recover, '回收章節');
    const ch = next.chapters.find((c) => c.id === updated.recoverChapterId);
    log.push(`預計回收章節：${ch ? `第${ch.volume}卷・${ch.title}` : '（不指定）'}。`);
  }

  const entityIds = Array.from(updated.relatedEntityIds || []);
  for (const ref2 of asList(spec.linkEntity)) {
    const e = findEntity(next, ref2);
    if (!entityIds.includes(e.id)) { entityIds.push(e.id); log.push(`關聯角色「${e.name}」。`); }
  }
  for (const ref2 of asList(spec.unlinkEntity)) {
    const e = findEntity(next, ref2);
    const i = entityIds.indexOf(e.id);
    if (i === -1) throw new Error(`這筆伏筆沒有關聯到「${e.name}」，未變更任何資料。`);
    entityIds.splice(i, 1);
    log.push(`取消關聯角色「${e.name}」。`);
  }
  updated.relatedEntityIds = entityIds;

  const relationIds = Array.from(updated.relatedRelationIds || []);
  for (const ref2 of asList(spec.linkRelation)) {
    const r = findRelation(next, ref2);
    if (!relationIds.includes(r.id)) { relationIds.push(r.id); log.push(`關聯關係「${describeRecord(next, 'relation', r)}」。`); }
  }
  for (const ref2 of asList(spec.unlinkRelation)) {
    const r = findRelation(next, ref2);
    const i = relationIds.indexOf(r.id);
    if (i === -1) throw new Error('這筆伏筆沒有關聯到那個關係，未變更任何資料。');
    relationIds.splice(i, 1);
    log.push(`取消關聯關係「${describeRecord(next, 'relation', r)}」。`);
  }
  updated.relatedRelationIds = relationIds;

  if (!log.length) throw new Error('沒有指定任何要改的欄位，未變更任何資料。');
  replaceIn(next.foreshadow, updated);
  return finish(next, [`伏筆「${updated.title}」（id ${updated.id}）：`, ...log]);
}

export function editRelation(data, ref, spec = {}) {
  const next = cloneData(data);
  const existing = findRelation(next, ref);
  const log = [];
  const updated = { ...existing };
  if (isDefined(spec.type)) { updated.type = requireText(spec.type, '關係類型'); log.push(`類型改為「${updated.type}」。`); }
  if (isDefined(spec.notes)) { updated.notes = String(spec.notes); log.push('更新備註。'); }
  if (!log.length) throw new Error('沒有指定任何要改的欄位，未變更任何資料。');
  replaceIn(next.relations, updated);
  return finish(next, [`關係「${describeRecord(next, 'relation', updated)}」（id ${updated.id}）：`, ...log]);
}

export function editRecord(data, type, ref, spec) {
  if (type === 'entity') return editEntity(data, ref, spec);
  if (type === 'chapter') return editChapter(data, ref, spec);
  if (type === 'foreshadow') return editForeshadow(data, ref, spec);
  if (type === 'relation') return editRelation(data, ref, spec);
  throw new Error(`不認得的類型「${type}」，可用：${RECORD_TYPES.join(' / ')}。`);
}

// ── 新增 ────────────────────────────────────────────────────────────────

export function addEntity(data, spec = {}) {
  const next = cloneData(data);
  const name = requireText(spec.name, '角色名稱');
  const clash = next.entities.find((e) => e.name === name || (e.aliases || []).includes(name));
  if (clash) {
    // #29 的同一條承諾：這個工具存在的理由就是同一個角色不能被記成兩個。
    throw new Error(`「${name}」已經存在（本名或別名屬於「${clash.name}」，id ${clash.id}）。` +
      `要補設定請用 edit entity ${clash.name}，未變更任何資料。`);
  }
  const created = {
    id: newId('e'),
    name,
    aliases: asList(spec.aliases),
    type: isDefined(spec.type) ? String(spec.type).trim() : '',
    tags: asList(spec.tags),
    notes: isDefined(spec.notes) ? String(spec.notes) : '',
    customFields: asList(spec.field).map(parseFieldPair),
  };
  next.entities.push(created);
  return finish(next, [`新增角色「${created.name}」（id ${created.id}）。`]);
}

export function addChapter(data, spec = {}) {
  const next = cloneData(data);
  const title = requireText(spec.title, '章節標題');
  const volume = isDefined(spec.volume) ? Number(spec.volume) : 1;
  if (!Number.isFinite(volume) || volume < 1) throw new Error(`卷數要是 1 以上的數字，收到「${spec.volume}」，未變更任何資料。`);
  const status = isDefined(spec.status) ? String(spec.status).trim() : '未寫';
  if (!CHAPTER_STATUSES.includes(status)) {
    throw new Error(`章節狀態只能是 ${CHAPTER_STATUSES.join(' / ')}，收到「${status}」，未變更任何資料。`);
  }
  const wordCount = isDefined(spec.wordCount) ? Number(spec.wordCount) : 0;
  if (!Number.isFinite(wordCount) || wordCount < 0) throw new Error(`字數要是 0 以上的數字，未變更任何資料。`);
  const created = {
    id: newId('c'),
    volume,
    // order 用目前章節總數（接在最後），之後可以再用 edit --order 調。
    order: isDefined(spec.order) ? Number(spec.order) : next.chapters.length,
    title,
    status,
    wordCount,
    summary: isDefined(spec.summary) ? String(spec.summary) : '',
    content: isDefined(spec.content) ? String(spec.content) : '',
  };
  next.chapters.push(created);
  return finish(next, [`新增章節「第${created.volume}卷・${created.title}」［${created.status}］（id ${created.id}）。`]);
}

export function addForeshadow(data, spec = {}) {
  const next = cloneData(data);
  const title = requireText(spec.title, '伏筆名稱');
  const status = isDefined(spec.status) ? String(spec.status).trim() : '埋設中';
  if (!FORESHADOW_STATUSES.includes(status)) {
    throw new Error(`伏筆狀態只能是 ${FORESHADOW_STATUSES.join(' / ')}，收到「${status}」，未變更任何資料。`);
  }
  const created = {
    id: newId('f'),
    title,
    plantChapterId: isDefined(spec.plant) ? chapterRefOrNull(next, spec.plant, '埋設章節') : null,
    recoverChapterId: isDefined(spec.recover) ? chapterRefOrNull(next, spec.recover, '回收章節') : null,
    status,
    relatedEntityIds: asList(spec.linkEntity).map((r) => findEntity(next, r).id),
    relatedRelationIds: asList(spec.linkRelation).map((r) => findRelation(next, r).id),
    notes: isDefined(spec.notes) ? String(spec.notes) : '',
  };
  next.foreshadow.push(created);
  return finish(next, [`新增伏筆「${created.title}」［${created.status}］（id ${created.id}）。`]);
}

export function addRelation(data, spec = {}) {
  const next = cloneData(data);
  const source = findEntity(next, requireText(spec.source, '關係來源'));
  const target = findEntity(next, requireText(spec.target, '關係目標'));
  const type = requireText(spec.type, '關係類型');
  const dup = next.relations.find((r) => r.sourceId === source.id && r.targetId === target.id && r.type === type);
  if (dup) throw new Error(`已經有一模一樣的關係「${source.name} —${type}→ ${target.name}」（id ${dup.id}），未變更任何資料。`);
  const created = {
    id: newId('r'),
    sourceId: source.id,
    targetId: target.id,
    type,
    notes: isDefined(spec.notes) ? String(spec.notes) : '',
  };
  next.relations.push(created);
  return finish(next, [`新增關係「${source.name} —${type}→ ${target.name}」（id ${created.id}）。`]);
}

export function addRecord(data, type, spec) {
  if (type === 'entity') return addEntity(data, spec);
  if (type === 'chapter') return addChapter(data, spec);
  if (type === 'foreshadow') return addForeshadow(data, spec);
  if (type === 'relation') return addRelation(data, spec);
  throw new Error(`不認得的類型「${type}」，可用：${RECORD_TYPES.join(' / ')}。`);
}

// ── 刪除 ────────────────────────────────────────────────────────────────

/**
 * 先算出「刪這一筆會連帶影響什麼」，讓 CLI 可以在真的刪之前印出來。
 * 回傳 { record, cascade: [{store, records}], warn: [] }。
 */
export function planRemoval(data, type, ref) {
  const record = findRecord(data, type, ref);
  const cascade = [];
  const warn = [];
  if (type === 'entity') {
    // 關係一定要連帶刪，否則關係圖會整張畫不出來。
    const relations = relationsAffectedByEntityDelete(data.relations, record.id);
    if (relations.length) cascade.push({ store: 'relations', records: relations });
    const fs = foreshadowReferencingEntity(data.foreshadow, record.id);
    if (fs.length) warn.push(`另有 ${fs.length} 筆伏筆關聯到它（${fs.map((f) => f.title).join('、')}）；這些關聯不會自動清掉，之後會顯示成「（已刪除）」。`);
  }
  if (type === 'chapter') {
    if (record.content && record.content.trim()) warn.push(`這一章有 ${record.content.length} 字正文，會一起消失，無法復原（只能靠快照）。`);
    const fs = foreshadowReferencingChapter(data.foreshadow, record.id);
    if (fs.length) warn.push(`有 ${fs.length} 筆伏筆指向這一章（${fs.map((f) => f.title).join('、')}），刪掉後那些欄位會變成「（未設定）」。`);
  }
  if (type === 'relation') {
    const fs = foreshadowReferencingRelation(data.foreshadow, record.id);
    if (fs.length) warn.push(`有 ${fs.length} 筆伏筆關聯到這個關係（${fs.map((f) => f.title).join('、')}），之後會顯示成「（已刪除）」。`);
  }
  return { record, cascade, warn };
}

export function removeRecord(data, type, ref) {
  const plan = planRemoval(data, type, ref);
  const next = cloneData(data);
  const store = STORE_OF[type];
  const label = describeRecord(next, type, plan.record);
  next[store] = next[store].filter((r) => r.id !== plan.record.id);
  const log = [`刪除${{ entity: '角色', chapter: '章節', foreshadow: '伏筆', relation: '關係' }[type]}「${label}」（id ${plan.record.id}）。`];
  for (const c of plan.cascade) {
    const ids = new Set(c.records.map((r) => r.id));
    next[c.store] = next[c.store].filter((r) => !ids.has(r.id));
    log.push(`連帶刪除 ${ids.size} 筆關係：${c.records.map((r) => describeRecord(data, 'relation', r)).join('、')}。`);
  }
  for (const w of plan.warn) log.push(w);
  return { ...finish(next, log), plan };
}

// ── 差異比對 ────────────────────────────────────────────────────────────

function sameValue(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/**
 * 兩份 data 的差異，用 id 對齊。回傳 { store: { added, removed, changed } }。
 * changed 的每一筆是 { id, label, fields: [{ key, from, to }] }。
 */
export function diffData(before, after) {
  const out = {};
  for (const store of PROJECT_STORES) {
    const a = before[store] || [];
    const b = after[store] || [];
    const aById = new Map(a.map((r) => [r.id, r]));
    const bById = new Map(b.map((r) => [r.id, r]));
    const added = b.filter((r) => !aById.has(r.id));
    const removed = a.filter((r) => !bById.has(r.id));
    const changed = [];
    for (const rec of b) {
      const old = aById.get(rec.id);
      if (!old) continue;
      const keys = Array.from(new Set([...Object.keys(old), ...Object.keys(rec)]));
      const fields = keys
        .filter((k) => !sameValue(old[k], rec[k]))
        .map((k) => ({ key: k, from: old[k], to: rec[k] }));
      if (fields.length) changed.push({ id: rec.id, record: rec, fields });
    }
    out[store] = { added, removed, changed };
  }
  return out;
}

export function isEmptyDiff(diff) {
  return Object.values(diff).every((d) => !d.added.length && !d.removed.length && !d.changed.length);
}
