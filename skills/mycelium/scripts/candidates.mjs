'use strict';
// 候選（candidate）格式的驗證與套用。
//
// 這裡的格式就是 app 的 extract.js 從 AI 拿到的那一份，沒有第二套契約：
//   {"entities":[{name, aliasOf, type, notes, reason}],
//    "relations":[{source, target, type, reason}],
//    "foreshadow":[{title, notes, reason}]}
//
// 提案檔（proposals/<timestamp>.json）就是這三個陣列放在最上層，另外附上
// version / generatedAt / source / note 幾個 metadata 欄位——這樣 app 端只要讀
// result.entities / result.relations / result.foreshadow，跟它處理 AI 回傳的
// 物件完全一樣。
import { PROJECT_STORES } from '../../../db.js';
import { isPlainRecord, isValidProjectData } from '../../../backup.js';

export const PROPOSAL_VERSION = 1;

// 跟 db.js 的 newId 同一套規則（前綴 + 時間 + 亂數），只是那支沒有 export。
let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * 驗證候選 JSON。回傳 { entities, relations, foreshadow } 正規化後的陣列，
 * 有問題就 throw（訊息是給人看的正體中文）。
 */
export function validateCandidates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('候選檔不是物件，未產生任何提案。');
  }
  if (raw.chapters !== undefined) {
    throw new Error('提案格式只收 entities / relations / foreshadow；章節請走 apply --chapters（直接寫，需明講）。');
  }
  const out = {};
  for (const key of ['entities', 'relations', 'foreshadow']) {
    const arr = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(arr)) throw new Error(`候選檔的「${key}」必須是陣列。`);
    out[key] = arr;
  }

  out.entities.forEach((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`entities[${i}] 不是物件。`);
    if (!isNonEmptyString(c.name)) throw new Error(`entities[${i}] 缺少 name。`);
    if (c.aliasOf !== undefined && c.aliasOf !== null && !isNonEmptyString(c.aliasOf)) {
      throw new Error(`entities[${i}]（${c.name}）的 aliasOf 必須是既有角色名稱或 null。`);
    }
    if (c.aliasOf && c.aliasOf === c.name) throw new Error(`entities[${i}]（${c.name}）不能是自己的別名。`);
    if (!isNonEmptyString(c.reason)) throw new Error(`entities[${i}]（${c.name}）缺少 reason，提案一定要寫理由。`);
  });
  out.relations.forEach((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`relations[${i}] 不是物件。`);
    for (const f of ['source', 'target', 'type']) {
      if (!isNonEmptyString(c[f])) throw new Error(`relations[${i}] 缺少 ${f}。`);
    }
    if (!isNonEmptyString(c.reason)) throw new Error(`relations[${i}] 缺少 reason，提案一定要寫理由。`);
  });
  out.foreshadow.forEach((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`foreshadow[${i}] 不是物件。`);
    if (!isNonEmptyString(c.title)) throw new Error(`foreshadow[${i}] 缺少 title。`);
    if (!isNonEmptyString(c.reason)) throw new Error(`foreshadow[${i}] 缺少 reason，提案一定要寫理由。`);
  });
  return out;
}

export function buildProposal(candidates, meta = {}) {
  const c = validateCandidates(candidates);
  return {
    version: PROPOSAL_VERSION,
    generatedAt: new Date().toISOString(),
    source: meta.source || '',
    note: meta.note || '',
    agent: meta.agent || 'mycelium skill',
    entities: c.entities,
    relations: c.relations,
    foreshadow: c.foreshadow,
  };
}

/**
 * 直接寫入時，把候選套進一份完整的 data（五個 store 的陣列）。
 *
 * 兩趟（two-pass）的順序刻意跟 extract.js 一模一樣：AI 回的是一個沒有順序保證
 * 的扁平陣列，同一批裡「黑袍人」可能排在揭露它就是「城主」之前，所以第一趟先
 * 把所有全新角色建出來，第二趟才處理別名合併，別名查表永遠看得到完整名單。
 * aliasOf 指向根本不存在的名字時，跟 app 一樣退回「當成獨立新角色建立」，
 * 不靜默丟掉候選。
 *
 * 純函式：回傳新的 data 與一份 log，不改動傳進來的物件。
 */
export function applyCandidates(data, candidates, options = {}) {
  const c = validateCandidates(candidates);
  const next = {};
  for (const store of PROJECT_STORES) next[store] = (data[store] || []).map((r) => ({ ...r }));
  const log = [];

  // 名字查表要**同時收本名與別名**（#29）：候選送進來的名字若已經是某個角色的
  // 別名，那也是既有角色，不可以再建一個分身——這個工具存在的理由就是同一個
  // 角色不能被記成兩個。
  const nameToEntity = {};
  for (const e of next.entities) {
    nameToEntity[e.name] = e;
    for (const a of (e.aliases || [])) if (!nameToEntity[a]) nameToEntity[a] = e;
  }

  // 第一趟：全新角色
  for (const cand of c.entities) {
    if (cand.aliasOf) continue;
    const existing = nameToEntity[cand.name];
    if (existing) {
      // 預設略過（不重複建立）。使用者明講要用候選補既有角色的設定時，走
      // `--update-existing`：跟網頁就地編輯同一條 `{ ...existing, 欄位 }` 路徑，
      // **保留 id**，所以既有的關係與伏筆連結都不會斷。
      if (options.updateExisting && (isNonEmptyString(cand.notes) || isNonEmptyString(cand.type))) {
        const changed = [];
        if (isNonEmptyString(cand.type) && cand.type !== existing.type) { existing.type = cand.type; changed.push('類型'); }
        if (isNonEmptyString(cand.notes) && cand.notes !== existing.notes) { existing.notes = cand.notes; changed.push('設定內容'); }
        log.push(changed.length
          ? `更新既有角色「${existing.name}」的${changed.join('與')}（保留原 id ${existing.id}）。`
          : `角色「${existing.name}」已存在且內容相同，未變更。`);
      } else {
        log.push(`略過角色「${cand.name}」：設定庫已有${existing.name === cand.name ? '同名角色' : `同名別名（屬於「${existing.name}」）`}，未重複建立。`);
      }
      continue;
    }
    const created = {
      id: newId('e'),
      name: cand.name,
      aliases: [],
      type: cand.type || '',
      tags: [],
      notes: cand.notes || '',
    };
    next.entities.push(created);
    nameToEntity[cand.name] = created;
    log.push(`新增角色「${cand.name}」。`);
  }

  // 第二趟：別名合併
  for (const cand of c.entities) {
    if (!cand.aliasOf) continue;
    const target = nameToEntity[cand.aliasOf];
    if (target) {
      const aliases = Array.from(new Set([...(target.aliases || []), cand.name]));
      target.aliases = aliases;
      nameToEntity[cand.name] = target; // 後面的候選可以再用這個新名字當 aliasOf
      log.push(`把「${cand.name}」併為「${target.name}」的別名。`);
    } else {
      const created = {
        id: newId('e'),
        name: cand.name,
        aliases: [],
        type: cand.type || '',
        tags: [],
        notes: cand.notes || '',
      };
      next.entities.push(created);
      nameToEntity[cand.name] = created;
      log.push(`「${cand.name}」的 aliasOf「${cand.aliasOf}」在設定庫裡找不到，改建成獨立角色。`);
    }
  }

  const findEntity = (name) => next.entities.find((e) => e.name === name || (e.aliases || []).includes(name));

  for (const cand of c.relations) {
    const source = findEntity(cand.source);
    const target = findEntity(cand.target);
    if (!source || !target) {
      log.push(`略過關係「${cand.source} —${cand.type}→ ${cand.target}」：找不到對應角色。`);
      continue;
    }
    next.relations.push({
      id: newId('r'),
      sourceId: source.id,
      targetId: target.id,
      type: cand.type,
      notes: cand.reason || '',
    });
    log.push(`新增關係「${source.name} —${cand.type}→ ${target.name}」。`);
  }

  for (const cand of c.foreshadow) {
    next.foreshadow.push({
      id: newId('f'),
      title: cand.title,
      plantChapterId: null,
      recoverChapterId: null,
      status: '埋設中',
      relatedEntityIds: [],
      relatedRelationIds: [],
      notes: cand.notes || '',
    });
    log.push(`新增伏筆「${cand.title}」。`);
  }

  for (const ch of (options.chapters || [])) {
    if (!isNonEmptyString(ch.title)) throw new Error('章節缺少 title，未寫入任何資料。');
    next.chapters.push({
      id: newId('c'),
      volume: Number(ch.volume) || 1,
      order: Number.isFinite(ch.order) ? ch.order : next.chapters.length,
      title: ch.title,
      status: ch.status || '未寫',
      wordCount: Number(ch.wordCount) || 0,
      summary: ch.summary || '',
      content: ch.content || '',
    });
    log.push(`新增章節「第${Number(ch.volume) || 1}卷・${ch.title}」。`);
  }

  assertValidProjectData(next);
  return { data: next, log };
}

/**
 * 用 app 匯入時的同一組規則檢查整份 data——app 的匯入器會擋掉壞掉的檔案，
 * 這裡先擋一次，確保 skill 產出的東西永遠不會讓 app 噎到。
 */
export function assertValidProjectData(data) {
  if (!isValidProjectData(data)) {
    throw new Error(`資料必須是物件，且 ${PROJECT_STORES.join(' / ')} 五個欄位都要是陣列，未寫入任何資料。`);
  }
  for (const store of PROJECT_STORES) {
    for (const rec of data[store]) {
      if (!isPlainRecord(rec)) {
        throw new Error(`「${store}」含有無效的紀錄（必須是物件，且 id 若存在必須是字串或數字），未寫入任何資料。`);
      }
    }
  }
  return true;
}
