// 查詢與想起：所有讀取都先過「可見範圍」濾網，沒有被允許的紀錄一律不回傳。
// 這一層不呼叫任何模型；以名字比對、事實圖走訪、全文搜尋組出給模型看的中文段落。
import { nameKey } from './names.mjs';
import { cmpTime, activeAt } from './time.mjs';

const get = (store, sql, ...p) => store.db.prepare(sql).get(...p);
const all = (store, sql, ...p) => store.db.prepare(sql).all(...p);

function spaceRow(store, space) {
  const row = get(store, 'SELECT * FROM spaces WHERE id = ?', space);
  if (!row) throw new Error(`找不到空間：${space}`);
  if (typeof row.chapters_json === 'string') row.chapters = JSON.parse(row.chapters_json);
  else row.chapters = row.chapters ?? [];
  return row;
}

// 可見範圍標籤一律字串完全相同才算數：person: 的對象不經 resolve，
// 合併後原帳號的私下紀錄不會擴散給合併後的整個人物。
function visibility(store, audiences, who) {
  if (!Array.isArray(audiences) || audiences.length === 0) {
    throw new Error(`${who} 要指定能看哪些可見範圍`);
  }
  const allowed = new Set(audiences);
  return (row) => allowed.has(row.audience);
}

// 舊資料可能帶著章節清單裡沒有的章節：這種紀錄的時間無法判定，查詢時略過並 warn 一次（不讓整個查詢丟錯）。
function timeKnown(store, sp, row, keys) {
  if (sp.time_axis !== 'chapter') return true;
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === '' || sp.chapters.includes(v)) continue;
    store._warnedChapters ??= new Set();
    const tag = `${sp.id}:${v}`;
    if (!store._warnedChapters.has(tag)) {
      store._warnedChapters.add(tag);
      console.warn(`略過章節不在清單裡的紀錄（未知的章節：${v}，空間 ${sp.id}）`);
    }
    return false;
  }
  return true;
}

const quoteFts = (q) => `"${String(q).normalize('NFKC').replace(/"/g, '""')}"`;
const chars = (s) => [...s];

// 事實的賓語：實體名、文字，或另一條事實（被引用的事實不可見就整條不呈現）。
function renderObject(store, f, isVisible) {
  if (f.object_entity) {
    const e = get(store, 'SELECT name FROM entities WHERE id = ?', store.resolve(f.object_entity));
    return { ok: true, text: e?.name ?? f.object_entity };
  }
  if (f.object_fact) {
    const g = get(store, 'SELECT * FROM facts WHERE id = ?', f.object_fact);
    if (!g || !isVisible(g)) return { ok: false };
    const sub = get(store, 'SELECT name FROM entities WHERE id = ?', store.resolve(g.subject_id));
    const inner = renderObject(store, g, isVisible);
    if (!inner.ok) return { ok: false };
    return { ok: true, text: `「${sub?.name ?? g.subject_id}${g.predicate}${inner.text ?? ''}」` };
  }
  return { ok: true, text: f.object_text ?? '' };
}

// 輸出前把指向看不到的紀錄的欄位清成 null（只改輸出的副本，不動資料庫）。
function cleanFact(store, f, isVisible) {
  const out = { ...f };
  if (out.superseded_by) {
    const g = get(store, 'SELECT audience FROM facts WHERE id = ?', out.superseded_by);
    if (!g || !isVisible(g)) out.superseded_by = null;
  }
  if (out.source_episode) {
    const ep = get(store, 'SELECT audience FROM episodes WHERE id = ?', out.source_episode);
    if (!ep || !isVisible(ep)) out.source_episode = null;
  }
  if (out.object_fact) {
    const g = get(store, 'SELECT audience FROM facts WHERE id = ?', out.object_fact);
    if (!g || !isVisible(g)) out.object_fact = null;
  }
  return out;
}

// 取出某空間所有可見的事實（並丟掉內容引用了不可見事實的那些）。
function visibleFacts(store, space, isVisible) {
  const sp = spaceRow(store, space);
  return all(store, 'SELECT * FROM facts WHERE space = ?', space).filter((f) => {
    if (!isVisible(f)) return false;
    if (!timeKnown(store, sp, f, ['valid_from', 'valid_to'])) return false;
    if (f.object_fact && !renderObject(store, f, isVisible).ok) return false;
    return true;
  }).map((f) => cleanFact(store, f, isVisible));
}

function entityRow(store, id) {
  return get(store, 'SELECT id, space, type, name, summary FROM entities WHERE id = ?', id);
}

export function getEntity(store, space, id, { at, audiences } = {}) {
  const sp = spaceRow(store, space);
  const isVisible = visibility(store, audiences, 'getEntity');
  const rid = store.resolve(id);
  const entity = entityRow(store, rid);
  if (!entity || entity.space !== space) return null;
  const aliases = all(store, 'SELECT * FROM aliases WHERE space = ?', space)
    .filter((a) => store.resolve(a.entity_id) === rid && isVisible(a))
    .map((a) => ({ id: a.id, alias: a.alias, platform: a.platform, isHandle: !!a.is_handle }));
  const mine = visibleFacts(store, space, isVisible).filter((f) => store.resolve(f.subject_id) === rid);
  const activeFacts = [];
  const pastFacts = [];
  for (const f of mine) {
    if (activeAt(sp, f, at ?? null)) activeFacts.push(f);
    else if (f.valid_to && (f.valid_from == null || f.valid_from === '' || at == null
      || cmpTime(sp, f.valid_from, at) <= 0)) pastFacts.push(f);
  }
  return { entity, aliases, activeFacts, pastFacts };
}

function sortByTime(sp, facts) {
  return [...facts].sort((a, b) => {
    const x = a.valid_from || null;
    const y = b.valid_from || null;
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? -1 : 1;
    return cmpTime(sp, x, y);
  });
}

export function timeline(store, space, { entityId, audiences } = {}) {
  const sp = spaceRow(store, space);
  const isVisible = visibility(store, audiences, 'timeline');
  let facts = visibleFacts(store, space, isVisible);
  if (entityId) {
    const rid = store.resolve(entityId);
    if (entityRow(store, rid)?.space !== space) return [];
    facts = facts.filter((f) => store.resolve(f.subject_id) === rid
      || (f.object_entity && store.resolve(f.object_entity) === rid));
  }
  return sortByTime(sp, facts);
}

// 從 seeds 沿事實走 hops 層；回傳碰到的實體集合與走過的（可見、當下成立的）事實。
function walk(store, sp, space, seeds, { hops, at, isVisible }) {
  const facts = visibleFacts(store, space, isVisible).filter((f) => activeAt(sp, f, at ?? null));
  const reached = new Map(); // id -> 層數
  for (const s of seeds) reached.set(s, 0);
  const used = new Map();
  let frontier = [...seeds];
  // hops = 0：只取種子本身當主詞的事實
  const layers = Math.max(hops, 0);
  for (let layer = 1; layer <= Math.max(layers, 1); layer++) {
    const next = [];
    for (const f of facts) {
      const sub = store.resolve(f.subject_id);
      const obj = f.object_entity ? store.resolve(f.object_entity) : null;
      const subIn = frontier.includes(sub);
      const objIn = obj != null && frontier.includes(obj);
      if (layers === 0 ? !subIn : !(subIn || objIn)) continue;
      used.set(f.id, f);
      if (layers === 0) continue;
      for (const other of [sub, obj]) {
        if (other != null && !reached.has(other)) { reached.set(other, layer); next.push(other); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return { reached, facts: [...used.values()] };
}

export function neighbors(store, space, entityId, { hops = 1, at, audiences } = {}) {
  const sp = spaceRow(store, space);
  const isVisible = visibility(store, audiences, 'neighbors');
  const rid = store.resolve(entityId);
  if (entityRow(store, rid)?.space !== space) return { entities: [], facts: [] };
  const { reached, facts } = walk(store, sp, space, [rid], { hops, at, isVisible });
  const entities = [...reached.entries()].filter(([id]) => id !== rid)
    .map(([id, distance]) => ({ ...entityRow(store, id), distance })).filter((e) => e.id);
  return { entities, facts };
}

export function search(store, space, query, { audiences, limit = 20 } = {}) {
  spaceRow(store, space);
  const isVisible = visibility(store, audiences, 'search');
  const key = nameKey(query);
  if (!key) return [];
  let rows;
  if (chars(key).length >= 3) {
    rows = all(store, `SELECT kind, ref_id, text FROM fts WHERE space = ? AND fts MATCH ? ORDER BY rank LIMIT ?`,
      space, quoteFts(query), limit * 5 + 50);
  } else {
    const like = `%${String(query).normalize('NFKC').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    rows = all(store, `SELECT kind, ref_id, text FROM fts WHERE space = ? AND text LIKE ? ESCAPE '\\' LIMIT ?`,
      space, like, limit * 5 + 50);
  }
  const hits = [];
  const seen = new Set();
  const push = (h) => {
    const k = `${h.kind}:${h.id}`;
    if (!seen.has(k) && hits.length < limit) { seen.add(k); hits.push(h); }
  };
  for (const r of rows) {
    if (r.kind === 'entity' || r.kind === 'alias') {
      let src = r.ref_id;
      if (r.kind === 'alias') {
        const al = get(store, 'SELECT entity_id, audience FROM aliases WHERE id = ?', r.ref_id);
        if (!al || !isVisible(al)) continue;
        src = al.entity_id;
      }
      const eid = store.resolve(src);
      const e = eid && entityRow(store, eid);
      if (e) push({ kind: 'entity', id: e.id, entityId: e.id, name: e.name, text: r.text });
    } else if (r.kind === 'fact') {
      const f = get(store, 'SELECT * FROM facts WHERE id = ?', r.ref_id);
      if (f && isVisible(f) && (!f.object_fact || renderObject(store, f, isVisible).ok)) {
        push({ kind: 'fact', id: f.id, entityId: store.resolve(f.subject_id), text: r.text, fact: cleanFact(store, f, isVisible) });
      }
    } else if (r.kind === 'episode') {
      const ep = get(store, 'SELECT * FROM episodes WHERE id = ?', r.ref_id);
      if (ep && isVisible(ep)) push({ kind: 'episode', id: ep.id, text: ep.body, episode: ep });
    }
  }
  return hits;
}

// 以 nameKey 掃文字，找出所有（長度 ≥2 的）別名與正式名稱命中的實體。
function scanNames(store, space, textKey, exactKeys, isVisible) {
  const cands = [];
  for (const e of all(store, 'SELECT id, name FROM entities WHERE space = ? AND name IS NOT NULL', space)) {
    cands.push([nameKey(e.name), e.id]);
  }
  for (const a of all(store, 'SELECT entity_id, alias_key, audience FROM aliases WHERE space = ?', space)) {
    if (!isVisible(a)) continue;
    cands.push([a.alias_key || '', a.entity_id]);
  }
  const found = new Set();
  for (const [k, id] of cands) {
    if (chars(k).length < 2) continue;
    if ((textKey && textKey.includes(k)) || exactKeys.has(k)) found.add(store.resolve(id));
  }
  return found;
}

function recallText(store, entities, facts, episodes, isVisible, maxChars) {
  const lines = [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const bySubject = new Map();
  for (const f of facts) {
    const sid = store.resolve(f.subject_id);
    if (!bySubject.has(sid)) bySubject.set(sid, []);
    bySubject.get(sid).push(f);
  }
  for (const e of entities) {
    const fs = bySubject.get(e.id) ?? [];
    lines.push(`【${e.name}】${e.summary ? `（${e.summary}）` : ''}`);
    for (const f of fs) {
      const o = renderObject(store, f, isVisible);
      const since = f.valid_from ? `（自 ${f.valid_from}）` : '';
      lines.push(`- ${f.predicate}：${o.text}${since}`);
    }
  }
  if (episodes.length) {
    lines.push('【相關紀錄】');
    for (const ep of episodes) lines.push(`- ${ep.at ? `${ep.at}：` : ''}${ep.body}`);
  }
  void byId;
  const out = [];
  let len = 0;
  for (const l of lines) {
    const add = (out.length ? 1 : 0) + l.length;
    if (len + add > maxChars) break;
    out.push(l);
    len += add;
  }
  return out.join('\n');
}

export function recall(store, space, { text, names, at, audiences, hops = 1, maxChars = 1500 } = {}) {
  const sp = spaceRow(store, space);
  const isVisible = visibility(store, audiences, 'recall');
  const textKey = nameKey(text);
  const exactKeys = new Set((names ?? []).map(nameKey));
  const seeds = [...scanNames(store, space, textKey, exactKeys, isVisible)];
  const { reached, facts } = walk(store, sp, space, seeds, { hops, at, isVisible });
  const entities = [...reached.keys()].map((id) => entityRow(store, id)).filter((e) => e);

  // 全文搜尋補相關紀錄：把輸入切成三字片段（OR）比對，只留可見的，最多 5 筆。
  const probe = [textKey, ...exactKeys].filter(Boolean).join(' ');
  let episodes = [];
  const epInTime = (ep) => at == null || !ep.at || cmpTime(sp, ep.at, at) <= 0;
  const grams = new Set();
  const cs = chars(textKey || probe);
  for (let i = 0; i + 3 <= cs.length; i++) grams.add(cs.slice(i, i + 3).join(''));
  if (grams.size) {
    const q = [...grams].slice(0, 60).map(quoteFts).join(' OR ');
    const rows = all(store, `SELECT ref_id FROM fts WHERE space = ? AND kind = 'episode' AND fts MATCH ?
      ORDER BY rank LIMIT 100`, space, q);
    for (const r of rows) {
      const ep = get(store, 'SELECT * FROM episodes WHERE id = ?', r.ref_id);
      if (ep && isVisible(ep) && timeKnown(store, sp, ep, ['at']) && epInTime(ep)) episodes.push(ep);
      if (episodes.length >= 5) break;
    }
  }
  // 不足 5 筆時，補上標記了這些人物、且可見的最近紀錄。
  if (episodes.length < 5 && reached.size) {
    const have = new Set(episodes.map((e) => e.id));
    const rows = all(store, 'SELECT * FROM episodes WHERE space = ? AND entity_ids_json IS NOT NULL ', space)
      .filter((ep) => timeKnown(store, sp, ep, ['at']))
      .sort((x, y) => (x.at && y.at ? cmpTime(sp, y.at, x.at) : 0) || (y.id < x.id ? -1 : 1));
    for (const ep of rows) {
      if (episodes.length >= 5) break;
      if (have.has(ep.id) || !isVisible(ep) || !epInTime(ep)) continue;
      const ids = JSON.parse(ep.entity_ids_json).map((x) => store.resolve(x));
      if (ids.some((x) => reached.has(x))) episodes.push(ep);
    }
  }
  episodes = episodes.slice(0, 5)
    .sort((x, y) => (x.at && y.at ? cmpTime(sp, y.at, x.at) : 0));
  return { entities, facts, episodes, text: recallText(store, entities, facts, episodes, isVisible, maxChars) };
}

export function attachQueries(store) {
  store.recall = (space, opts) => recall(store, space, opts);
  store.getEntity = (space, id, opts) => getEntity(store, space, id, opts);
  store.search = (space, q, opts) => search(store, space, q, opts);
  store.timeline = (space, opts) => timeline(store, space, opts);
  store.neighbors = (space, id, opts) => neighbors(store, space, id, opts);
  return store;
}
