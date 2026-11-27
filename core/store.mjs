// Store：把 SQLite（applyOp）、操作檔（OpLog）與混合時鐘綁在一起，提供寫入 API。
// 每次寫入：建 op → 在 SAVEPOINT 裡先 applyOp → 成功才 append 到操作檔（含 commit）→ RELEASE。
// 套用或寫檔失敗就回滾並把錯誤往外丟，所以主本裡不會有套用不了的操作。SQLite 只是可重建的快取。
import { openDb } from './sqlite.mjs';
import { Hlc, ulid } from './ids.mjs';
import { applyOp, compareOps } from './apply.mjs';
import { OpLog, loadDevice } from './oplog.mjs';
import { nameKey } from './names.mjs';
import { attachQueries } from './query.mjs';

const AUDIENCE_RE = /^(public|(person|group|role):.+)$/u;
const TABLES = ['spaces', 'entities', 'aliases', 'facts', 'episodes', 'merges', 'overwrites', 'applied', 'fts'];

// 清空所有由操作衍生的資料表後，依 (hlc, dev, id) 排序重播全部操作。
// vectors 不是操作衍生的（由嵌入流程另外寫入），保留不動。
// 整個清空＋重播包在一個交易（SAVEPOINT，可巢狀在外層交易裡）；失敗就回滾，舊資料保留。
export function rebuildAll(db, ops) {
  db.exec('SAVEPOINT rebuild_all');
  try {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    for (const op of [...ops].sort(compareOps)) replayOp(db, op);
    db.exec('RELEASE rebuild_all');
  } catch (e) {
    db.exec('ROLLBACK TO rebuild_all');
    db.exec('RELEASE rebuild_all');
    throw e;
  }
}

// 重播用：套用失敗（舊版程式或別台寫進的壞操作）就略過並 warn，記進 applied 免得每次重開都重試。
// 每台裝置都略過同一筆，結果一致。
export function replayOp(db, op) {
  try {
    applyOp(db, op);
  } catch (e) {
    console.warn(`略過無法套用的操作 ${op?.id}（${op?.type}）：${e.message}`);
    if (op?.id != null) {
      db.prepare('INSERT OR IGNORE INTO applied(op_id, hlc) VALUES (?,?)').run(String(op.id), op.hlc ?? null);
    }
  }
}

// 補套未套用的操作：缺的操作若都比已套用的最新者新，依序套；否則整個重建。
// 同時讓混合時鐘觀察所有操作的 hlc。回傳 {applied, rebuilt}。
export function catchUp({ db, oplog, hlc }) {
  if (!hlc) throw new Error('catchUp 需要混合時鐘 hlc');
  const all = oplog.readAll();
  for (const op of all) if (op.hlc) hlc.observe(op.hlc);
  const appliedIds = new Set(db.prepare('SELECT op_id FROM applied').all().map((r) => r.op_id));
  // 資料庫裡有主本沒有的已套用操作（例如搭配了別的 ops 目錄）：資料庫不可信，整個重建
  const known = new Set(all.map((op) => String(op.id)));
  if ([...appliedIds].some((id) => !known.has(id))) {
    console.warn('資料庫裡有操作紀錄沒有的已套用操作，從操作紀錄整個重建');
    rebuildAll(db, all);
    return { applied: all.length, rebuilt: true };
  }
  const missing = all.filter((op) => !appliedIds.has(op.id)).sort(compareOps);
  if (!missing.length) return { applied: 0, rebuilt: false };
  const newest = all.filter((op) => appliedIds.has(op.id)).sort(compareOps).at(-1);
  if (newest && compareOps(missing[0], newest) < 0) {
    rebuildAll(db, all);
    return { applied: missing.length, rebuilt: true };
  }
  for (const op of missing) replayOp(db, op);
  return { applied: missing.length, rebuilt: false };
}

function checkAudience(a) {
  if (typeof a !== 'string' || !AUDIENCE_RE.test(a)) throw new Error(`未知的可見範圍：${a}`);
}

function spaceInfo(db, space) {
  const row = db.prepare('SELECT time_axis, chapters_json FROM spaces WHERE id = ?').get(space ?? null);
  return { axis: row?.time_axis ?? 'date', chapters: row?.chapters_json ? JSON.parse(row.chapters_json) : [] };
}

// 故事時間在寫入前驗證：章節軸必須在章節清單裡；日期軸必須是 ISO 格式（字串比較才等於時間順序）。
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
function checkTime(db, space, ...values) {
  const sp = spaceInfo(db, space);
  for (const v of values) {
    if (v == null || v === '') continue;
    if (sp.axis === 'chapter') {
      if (!sp.chapters.includes(v)) throw new Error(`未知的章節：${v}`);
    } else if (typeof v !== 'string' || !ISO_RE.test(v)) {
      throw new Error(`日期格式要用 YYYY-MM-DD 或完整 ISO 時間：${v}`);
    }
  }
}

// 被事實或紀錄用到的章節不能從清單移除。
function checkChaptersKept(db, space, chapters) {
  const sp = spaceInfo(db, space);
  if (sp.axis !== 'chapter') return;
  const keep = new Set(chapters ?? []);
  const used = new Set();
  for (const f of db.prepare('SELECT valid_from, valid_to FROM facts WHERE space = ?').all(space)) {
    for (const v of [f.valid_from, f.valid_to]) if (v != null && v !== '') used.add(v);
  }
  for (const e of db.prepare('SELECT at FROM episodes WHERE space = ?').all(space)) {
    if (e.at != null && e.at !== '') used.add(e.at);
  }
  const gone = [...used].filter((c) => !keep.has(c));
  if (gone.length) throw new Error(`這些章節已被事實或紀錄用到，不能移除：${gone.join('、')}`);
}

export function openStore({ dbPath, opsDir, autoCommit = true }) {
  const { device, deviceName } = loadDevice(opsDir);
  const oplog = new OpLog({ dir: opsDir, device, deviceName, autoCommit });
  const hlc = new Hlc(device);
  // 開檔與第一次 catchUp 也會寫資料庫，一樣在跨程序鎖內做（資料庫的寫入全部由這把鎖排隊）。
  let sizes;
  const db = oplog.withLock(() => {
    const d = openDb(dbPath);
    try {
      catchUp({ db: d, oplog, hlc });
    } catch (e) {
      d.close();
      throw e;
    }
    sizes = JSON.stringify(oplog.sizes());
    return d;
  });

  // 輕量 catchUp：操作檔大小有變（別的程序或 sync 寫過）才整個讀回、補套並讓時鐘觀察新的 hlc。
  const refresh = () => {
    const now = JSON.stringify(oplog.sizes());
    if (now === sizes) return;
    catchUp({ db, oplog, hlc });
    sizes = JSON.stringify(oplog.sizes());
  };
  // 寫入一律在跨程序鎖內：先 refresh，再驗證與寫入。可重入。
  let depth = 0;
  const locked = (fn) => oplog.withLock(() => {
    if (depth++ === 0) refresh();
    try { return fn(); } finally { depth--; }
  });

  const emit = (type, space, data) => locked(() => {
    const op = { id: ulid(), dev: device, hlc: hlc.now(), type, space, data };
    db.exec('SAVEPOINT emit_op');
    try {
      applyOp(db, op);
      oplog.append(op);
      db.exec('RELEASE emit_op');
    } catch (e) {
      db.exec('ROLLBACK TO emit_op');
      db.exec('RELEASE emit_op');
      throw e;
    }
    sizes = JSON.stringify(oplog.sizes());
    return op;
  });
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all_ = (sql, ...p) => db.prepare(sql).all(...p);

  const resolve = (entityId) => {
    const seen = new Set();
    let cur = entityId;
    while (!seen.has(cur)) {
      seen.add(cur);
      const row = get('SELECT merged_into FROM entities WHERE id = ?', cur);
      if (!row || !row.merged_into) return cur;
      cur = row.merged_into;
    }
    return cur; // 迴圈（理論上不會發生）：停在重複處
  };

  // person: 標籤先經 resolve 再比，合併後的人仍對得上合併前的標籤。
  const normAud = (a) => (typeof a === 'string' && a.startsWith('person:') ? `person:${resolve(a.slice(7))}` : a);

  // 寫入範圍 W 只能取代或讓範圍 T 的事實失效，當 W === T（person: resolve 後比）或 W 是 public。
  const checkWidth = (space, writeAud, factId) => {
    const f = get('SELECT audience FROM facts WHERE id = ? AND space = ?', factId ?? null, space ?? null);
    if (!f) throw new Error(`找不到事實：${factId}`);
    if (writeAud === 'public' || normAud(writeAud) === normAud(f.audience)) return;
    throw new Error(`不能用較私下的資訊改動較公開的事實：${factId}（${f.audience}）`);
  };

  const store = {
    db,
    device,
    oplog,
    hlc,
    resolve,
    locked,
    _emit: emit, // 測試用

    createSpace({ id, name, kind, timeAxis, chapters }) {
      if (chapters != null) checkChaptersKept(db, id, chapters);
      const data = { name, kind, timeAxis };
      if (chapters != null) data.chapters = chapters;
      emit('create_space', id, data);
      return id;
    },

    setChapters(space, chapters) {
      if (!Array.isArray(chapters)) throw new Error('章節清單要是陣列');
      checkChaptersKept(db, space, chapters);
      emit('set_chapters', space, { chapters });
    },

    listSpaces() {
      return all_('SELECT * FROM spaces ORDER BY id');
    },

    // audiences：這次能看哪些可見範圍（預設只有公開）；候選的別名比對只用看得到的別名。
    upsertEntity(space, { type, name, summary, entityId, audiences = ['public'] }) {
      if (entityId) {
        const cur = get('SELECT name, summary FROM entities WHERE id = ?', entityId);
        if (!cur) throw new Error(`找不到人物：${entityId}`);
        if (name != null && name !== cur.name) emit('update_entity', space, { entityId, field: 'name', value: name });
        if (summary != null && summary !== cur.summary) {
          emit('update_entity', space, { entityId, field: 'summary', value: summary });
        }
        return { entityId, created: false, candidates: [] };
      }
      if (type == null || type === '') throw new Error('新建人物時 type 必填');
      if (name == null || name === '') throw new Error('新建人物時 name 必填');
      if (!Array.isArray(audiences) || audiences.length === 0) throw new Error('audiences 要是非空陣列');
      for (const a of audiences) checkAudience(a);
      const allowed = new Set(audiences.map(normAud));
      // 建立前先找可能重複的人物（名稱、看得到的別名、全文）
      const key = nameKey(name);
      const found = new Map();
      const add = (id, nm, why) => { if (!found.has(id)) found.set(id, { entityId: id, name: nm, why }); };
      for (const e of all_('SELECT id, name FROM entities WHERE space = ? AND name IS NOT NULL', space)) {
        if (nameKey(e.name) === key) add(e.id, e.name, 'name');
      }
      for (const a of all_('SELECT entity_id, alias, audience FROM aliases WHERE space = ? AND alias_key = ?', space, key)) {
        if (!allowed.has(normAud(a.audience))) continue;
        const e = get('SELECT name FROM entities WHERE id = ?', a.entity_id);
        add(a.entity_id, e?.name ?? a.alias, 'alias');
      }
      if ([...key].length >= 3) {
        try {
          const q = `"${String(name).normalize('NFKC').replace(/"/g, '""')}"`;
          for (const r of all_(`SELECT ref_id FROM fts WHERE kind = 'entity' AND space = ? AND fts MATCH ?`, space, q)) {
            const e = get('SELECT name FROM entities WHERE id = ?', r.ref_id);
            if (e) add(r.ref_id, e.name, 'fts');
          }
        } catch { /* 全文查詢語法失敗就略過這一類候選 */ }
      }
      const newId = ulid();
      const data = { entityId: newId, type, name };
      if (summary != null) data.summary = summary;
      emit('create_entity', space, data);
      return { entityId: newId, created: true, candidates: [...found.values()] };
    },

    addAlias(space, entityId, alias, { platform, isHandle, audience } = {}) {
      if ([...nameKey(alias)].length < 2) throw new Error('別名至少兩個字');
      const aliasId = ulid();
      const data = { aliasId, entityId, alias };
      if (platform != null) data.platform = platform;
      if (isHandle) data.isHandle = true;
      if (audience != null) { checkAudience(audience); data.audience = audience; }
      emit('add_alias', space, data);
      return aliasId;
    },

    findByHandle(space, platform, handle) {
      const row = get(
        `SELECT entity_id FROM aliases WHERE space = ? AND platform IS ? AND is_handle = 1 AND alias_key = ?
         ORDER BY id LIMIT 1`, space, platform ?? null, nameKey(handle));
      return row ? resolve(row.entity_id) : null;
    },

    logEpisode(space, { at, source, audience, body, entityIds }) {
      checkAudience(audience);
      checkTime(db, space, at);
      const episodeId = ulid();
      const data = { episodeId, at, source, audience, body };
      if (entityIds != null) data.entityIds = entityIds;
      emit('log_episode', space, data);
      return episodeId;
    },

    remember(space, { subjectId, predicate, objectEntity, objectText, objectFact, validFrom, validTo,
      audience, sourceEpisode, confidence, author, supersedes }) {
      checkAudience(audience);
      checkTime(db, space, validFrom, validTo);
      for (const oldId of supersedes ?? []) checkWidth(space, audience, oldId);
      const factId = ulid();
      const data = { factId, subjectId, predicate, validFrom, audience, author };
      const opt = { objectEntity, objectText, objectFact, validTo, sourceEpisode, confidence, supersedes };
      for (const [k, v] of Object.entries(opt)) if (v != null) data[k] = v;
      // 先查同類仍成立的事實（不含這一筆本身），寫入後交給呼叫者決定要不要 invalidate。
      // 主體比對用 resolve 後的人；只回傳公開的、或與這次寫入同一可見範圍的事實，避免把私下的事帶進公開場合。
      const subj = resolve(subjectId);
      const aud = normAud(audience);
      const sameKindActive = all_(
        `SELECT id, subject_id, predicate, object_entity, object_text, object_fact, audience FROM facts
         WHERE space = ? AND predicate = ? AND (valid_to IS NULL OR valid_to = '')`,
        space, predicate ?? null)
        .filter((f) => resolve(f.subject_id) === subj)
        .filter((f) => f.audience === 'public' || normAud(f.audience) === aud)
        .filter((f) => !(supersedes ?? []).includes(f.id))
        .map((f) => ({ factId: f.id, predicate: f.predicate,
          object: f.object_entity ?? f.object_text ?? f.object_fact ?? null }));
      emit('remember', space, data);
      return { factId, sameKindActive };
    },

    // audience：這次寫入根據的資訊範圍（預設公開）；較私下的資訊不能讓較公開的事實失效。
    invalidate(space, factId, at, by, audience = 'public') {
      checkAudience(audience);
      checkTime(db, space, at);
      checkWidth(space, audience, factId);
      const data = { factId, at };
      if (by != null) data.by = by;
      emit('invalidate', space, data);
    },

    mergeEntities(space, fromId, toId, reason) {
      if (fromId === toId) throw new Error('不能把人物併到自己');
      for (const id of [fromId, toId]) {
        const e = get('SELECT space FROM entities WHERE id = ?', id ?? null);
        if (!e) throw new Error(`找不到人物：${id}`);
        if (e.space !== space) throw new Error(`合併的兩個人物要在同一個空間（${id} 在 ${e.space}）`);
      }
      if (resolve(toId) === fromId) throw new Error('這個合併會形成迴圈');
      const mergeId = ulid();
      emit('merge', space, { mergeId, fromId, toId, reason });
      return mergeId;
    },

    unmerge(space, mergeId) {
      emit('unmerge', space, { mergeId });
    },

    resolveMerge(space, keepMergeId) {
      emit('resolve_merge', space, { keepMergeId });
    },

    close() {
      db.close();
    },
  };
  // 會先讀狀態再寫入的方法整個包在鎖內，驗證與寫入之間不會被別的程序插隊。
  for (const k of ['createSpace', 'setChapters', 'upsertEntity', 'addAlias', 'logEpisode', 'remember',
    'invalidate', 'mergeEntities', 'unmerge', 'resolveMerge']) {
    const f = store[k];
    store[k] = (...args) => locked(() => f.apply(store, args));
  }
  return attachQueries(store);
}
