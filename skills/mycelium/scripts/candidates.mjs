'use strict';
// 候選（candidate）格式的驗證與套用。
//
// 格式就是 LLM 抽章節之後回傳的那一份，沒有第二套契約：
//   {"entities":[{name, aliasOf, type, notes, reason}],
//    "relations":[{source, target, type, reason}],
//    "foreshadow":[{title, notes, reason}]}
//
// 提案檔（proposals/<timestamp>.json）就是這三個陣列放在最上層，另外附上
// version / generatedAt / source / note 幾個 metadata 欄位——讀的人（或程式）
// 只要看 entities / relations / foreshadow，跟 LLM 直接回傳的物件完全一樣。
import { PROJECT_STORES, isPlainRecord, isValidProjectData } from './schema.mjs';
import { nameKey } from './records.mjs';

export const PROPOSAL_VERSION = 1;

// 前綴 + 時間 + 亂數，跟舊網頁產 id 的規則同一套。
let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// 名字一律先去頭尾空白再進資料庫：模型吐的 JSON 常常帶一個空白，存進去就變成
// 另一個角色了（#29）。這裡只 trim，不動作者寫的字本身。
function cleanName(v) {
  return typeof v === 'string' ? v.trim() : v;
}

/**
 * 驗證候選 JSON。回傳 { entities, relations, foreshadow } 正規化後的陣列
 * （名字都去過頭尾空白），有問題就 throw（訊息是給人看的正體中文）。
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

  out.entities = out.entities.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`entities[${i}] 不是物件。`);
    if (!isNonEmptyString(c.name)) throw new Error(`entities[${i}] 缺少 name。`);
    if (c.aliasOf !== undefined && c.aliasOf !== null && !isNonEmptyString(c.aliasOf)) {
      throw new Error(`entities[${i}]（${c.name}）的 aliasOf 必須是既有角色名稱或 null。`);
    }
    // 自己當自己的別名要用 nameKey 判：「城主 」跟「城主」是同一個名字。
    if (c.aliasOf && nameKey(c.aliasOf) === nameKey(c.name)) {
      throw new Error(`entities[${i}]（${c.name}）不能是自己的別名。`);
    }
    if (!isNonEmptyString(c.reason)) throw new Error(`entities[${i}]（${c.name}）缺少 reason，提案一定要寫理由。`);
    return { ...c, name: cleanName(c.name), aliasOf: c.aliasOf ? cleanName(c.aliasOf) : null };
  });
  out.relations = out.relations.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`relations[${i}] 不是物件。`);
    for (const f of ['source', 'target', 'type']) {
      if (!isNonEmptyString(c[f])) throw new Error(`relations[${i}] 缺少 ${f}。`);
    }
    if (!isNonEmptyString(c.reason)) throw new Error(`relations[${i}] 缺少 reason，提案一定要寫理由。`);
    return { ...c, source: cleanName(c.source), target: cleanName(c.target), type: cleanName(c.type) };
  });
  out.foreshadow = out.foreshadow.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`foreshadow[${i}] 不是物件。`);
    if (!isNonEmptyString(c.title)) throw new Error(`foreshadow[${i}] 缺少 title。`);
    if (!isNonEmptyString(c.reason)) throw new Error(`foreshadow[${i}] 缺少 reason，提案一定要寫理由。`);
    return { ...c, title: cleanName(c.title) };
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
 * 兩趟（two-pass）：AI 回的是一個沒有順序保證
 * 的扁平陣列，同一批裡「黑袍人」可能排在揭露它就是「城主」之前，所以第一趟先
 * 把所有全新角色建出來，第二趟才處理別名合併，別名查表永遠看得到完整名單。
 * aliasOf 指向根本不存在、而且自己也還不存在的名字時，退回「當成獨立新角色
 * 建立」，不靜默丟掉候選。
 *
 * 撞到既有名字時的取捨（#29）：
 *   - 名字比對走 nameKey，全形半形／空白／大小寫都不算差異。
 *   - 名字已經有主（本名或別名）→ 預設**略過**，不重複建立、也不覆蓋既有設定；
 *     只有 options.updateExisting（CLI 的 --update-existing，要使用者明講）才會
 *     就地更新那一筆，而且保留 id。
 *   - 要把一筆**既有的獨立角色**併成另一個角色的別名 → 不自動做，只寫進 log 給
 *     人處理：合併兩筆既有紀錄一定得決定誰的設定與關係留下來，那是破壞性的。
 *
 * 純函式：回傳新的 data 與一份 log，不改動傳進來的物件。
 */
export function applyCandidates(data, candidates, options = {}) {
  const c = validateCandidates(candidates);
  const next = {};
  for (const store of PROJECT_STORES) next[store] = (data[store] || []).map((r) => ({ ...r }));
  const log = [];

  // 名字查表要**同時收本名與別名**，而且鍵一律走 nameKey（#29）：候選送進來的
  // 名字若已經是某個角色的本名或別名——就算差一個空白或全形半形——那都是既有
  // 角色，不可以再建一個分身。這個工具存在的理由就是同一個角色不能被記成兩個。
  const byKey = {};
  const remember = (name, entity) => {
    const k = nameKey(name);
    if (k && !byKey[k]) byKey[k] = entity;
  };
  for (const e of next.entities) {
    byKey[nameKey(e.name)] = e; // 本名優先，一定蓋過別名
    for (const a of (e.aliases || [])) remember(a, e);
  }
  const lookup = (name) => byKey[nameKey(name)] || null;
  // 撞到的是本名還是別名——log 要講清楚，人才知道自己是不是漏看了哪個角色。
  const describeHit = (hit, name) => (nameKey(hit.name) === nameKey(name)
    ? '同名角色'
    : `同名別名（屬於「${hit.name}」）`);
  const createEntity = (cand) => {
    const created = {
      id: newId('e'),
      name: cand.name,
      aliases: [],
      type: cand.type || '',
      tags: [],
      notes: cand.notes || '',
    };
    next.entities.push(created);
    remember(cand.name, created);
    return created;
  };

  // 同一批候選裡，被別人宣告成「別名」的名字。第一趟不建它們——不然會先生出
  // 一個獨立角色，第二趟再把同一個名字掛成別人的別名，落得兩邊都有。
  const claimedAsAlias = new Set(c.entities.filter((x) => x.aliasOf).map((x) => nameKey(x.name)));

  // 第一趟：全新角色
  for (const cand of c.entities) {
    if (cand.aliasOf) continue;
    if (claimedAsAlias.has(nameKey(cand.name))) {
      log.push(`「${cand.name}」在同一批候選裡也被標成別名，交給別名合併處理，不另外建角色。`);
      continue;
    }
    const existing = lookup(cand.name);
    if (existing) {
      // 預設略過（不重複建立）。使用者明講要用候選補既有角色的設定時，走
      // `--update-existing`：走就地編輯的 `{ ...existing, 欄位 }` 路徑，
      // **保留 id**，所以既有的關係與伏筆連結都不會斷。
      if (options.updateExisting && (isNonEmptyString(cand.notes) || isNonEmptyString(cand.type))) {
        const changed = [];
        if (isNonEmptyString(cand.type) && cand.type !== existing.type) { existing.type = cand.type; changed.push('類型'); }
        if (isNonEmptyString(cand.notes) && cand.notes !== existing.notes) { existing.notes = cand.notes; changed.push('設定內容'); }
        log.push(changed.length
          ? `更新既有角色「${existing.name}」的${changed.join('與')}（保留原 id ${existing.id}）。`
          : `角色「${existing.name}」已存在且內容相同，未變更。`);
      } else {
        log.push(`略過角色「${cand.name}」：設定庫已有${describeHit(existing, cand.name)}，未重複建立。`);
      }
      continue;
    }
    createEntity(cand);
    log.push(`新增角色「${cand.name}」。`);
  }

  // 第二趟：別名合併
  for (const cand of c.entities) {
    if (!cand.aliasOf) continue;
    const target = lookup(cand.aliasOf);
    const owner = lookup(cand.name); // 這個名字現在是誰的（本名或別名）

    if (target && owner === target) {
      log.push(`「${cand.name}」已經${nameKey(target.name) === nameKey(cand.name)
        ? `就是「${target.name}」本人`
        : `是「${target.name}」的別名`}，未重複處理。`);
      continue;
    }
    if (target && owner) {
      // 名字兩邊都有主人：把兩筆既有紀錄併成一筆，得決定誰的設定、關係、伏筆
      // 留下來，那是會蓋掉既有資料的動作，套用候選時不自動做（#29）。
      const isMain = nameKey(owner.name) === nameKey(cand.name);
      log.push(`略過別名「${cand.name}」→「${target.name}」：`
        + (isMain
          ? `設定庫裡「${owner.name}」是獨立角色（id ${owner.id}）`
          : `「${cand.name}」已經是「${owner.name}」的別名（id ${owner.id}）`)
        + `，併過去會動到既有設定與關係，未自動處理。`
        + `確定是同一個人的話，請先把 ${owner.id} 的關係改掛到「${target.name}」，`
        + `rm 掉之後再 edit entity ${target.name} --add-alias ${cand.name}。`);
      continue;
    }
    if (target) {
      target.aliases = Array.from(new Set([...(target.aliases || []), cand.name]));
      remember(cand.name, target); // 後面的候選可以再用這個新名字當 aliasOf
      log.push(`把「${cand.name}」併為「${target.name}」的別名。`);
      continue;
    }
    if (owner) {
      // aliasOf 指到不存在的名字，但這個名字本身已經是既有角色——這時候還退回
      // 「建成獨立角色」就是生出分身，所以改成略過（#29）。
      log.push(`略過角色「${cand.name}」：aliasOf「${cand.aliasOf}」在設定庫裡找不到，`
        + `而設定庫已有${describeHit(owner, cand.name)}，未重複建立。`);
      continue;
    }
    // 兩邊都沒有：跟原本一樣退回「當成獨立新角色建立」，不靜默丟掉候選。
    createEntity(cand);
    log.push(`「${cand.name}」的 aliasOf「${cand.aliasOf}」在設定庫裡找不到，改建成獨立角色。`);
  }

  for (const cand of c.relations) {
    const source = lookup(cand.source);
    const target = lookup(cand.target);
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
 * 寫回去之前的最後一道關：整份 data 必須是「五個 store 都在、每筆都是普通物件」。
 * 壞掉的東西寧可在這裡爆，也不要進到 repo 的 data/*.json。
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
