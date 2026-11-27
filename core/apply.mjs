// 套用操作：唯一會改資料表的入口。
// 約定：操作必須依 (hlc, dev, id) 由小到大套用（用 compareOps 排序）。
// hlc 不保證全域唯一：同一台裝置的兩個程序（多個 MCP server、命令列 sync）可能產生相同的 hlc。
// 排序最後由 op id（ulid）決定，所以仍是全序；欄位時間戳平手時以值的字串順序決定，結果與套用順序無關。
// Store 在跨程序鎖內寫入、寫入前先觀察別的程序寫下的 hlc，正常情況下不會撞號。
// 保證冪等（applied 已有就返回）；不保證亂序收斂，排序由呼叫端（Store 開啟／重播、同步）負責，
// 同步收到比已套用最新者更舊的操作時，要從頭重建。
// 引用別筆資料的操作（supersedes／invalidate／resolve_merge）hlc 一定晚於被引用者，排序重播時被引用者必已存在。
import { cmpTime } from './time.mjs';
import { nameKey } from './names.mjs';

const AUDIENCE_RE = /^(public|(person|group|role):.+)$/u;

function checkAudience(a) {
  if (typeof a !== 'string' || !AUDIENCE_RE.test(a)) throw new Error(`未知的可見範圍：${a}`);
  return a;
}

export function compareOps(a, b) {
  for (const k of ['hlc', 'dev', 'id']) {
    const x = String(a[k] ?? '');
    const y = String(b[k] ?? '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const nul = (v) => (v === undefined ? null : v);

function ftsSet(db, kind, refId, space, text) {
  db.prepare('DELETE FROM fts WHERE kind = ? AND ref_id = ?').run(kind, nul(refId));
  db.prepare('INSERT INTO fts(kind, ref_id, space, text) VALUES (?,?,?,?)').run(kind, nul(refId), nul(space), nul(text));
}

function getSpace(db, id) {
  const row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(nul(id));
  if (!row) return { time_axis: 'date', chapters: [] };
  return { ...row, chapters: row.chapters_json ? JSON.parse(row.chapters_json) : [] };
}

function cmpAt(db, spaceId, a, b) {
  return cmpTime(getSpace(db, spaceId), a, b);
}

// ---- 空間 ----
function createSpace(db, op) {
  const d = op.data;
  const chapters = d.chapters == null ? null : JSON.stringify(d.chapters);
  db.prepare(`INSERT INTO spaces(id, name, kind, time_axis, chapters_json) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
      time_axis = excluded.time_axis, chapters_json = COALESCE(excluded.chapters_json, chapters_json)`)
    .run(nul(op.space), nul(d.name), nul(d.kind), nul(d.timeAxis), chapters);
}

function setChapters(db, op) {
  db.prepare(`INSERT INTO spaces(id, chapters_json) VALUES (?,?)
    ON CONFLICT(id) DO UPDATE SET chapters_json = excluded.chapters_json`)
    .run(nul(op.space), JSON.stringify(op.data.chapters ?? []));
}

// ---- 實體 ----
const FIELD_COL = { name: ['name', 'name_hlc'], summary: ['summary', 'summary_hlc'] };

function entityText(db, id) {
  const e = db.prepare('SELECT space, name, summary FROM entities WHERE id = ?').get(nul(id));
  if (!e) throw new Error(`操作缺少人物 id`);
  ftsSet(db, 'entity', id, e.space, [e.name, e.summary].filter((x) => x != null && x !== '').join(' '));
}

// 欄位時間戳較晚者勝；平手時以值的字串順序決定，結果與套用順序無關。被蓋掉的值寫 overwrites。
function writeField(db, op, entityId, field, value) {
  const [col, hcol] = FIELD_COL[field];
  const cur = db.prepare(`SELECT ${col} AS v, ${hcol} AS h FROM entities WHERE id = ?`).get(nul(entityId));
  const curV = cur.v;
  const curH = cur.h;
  let wins;
  if (curH == null) wins = true;
  else if (op.hlc !== curH) wins = op.hlc > curH;
  else wins = String(value ?? '') > String(curV ?? '');
  const ow = db.prepare(
    'INSERT OR IGNORE INTO overwrites(id, entity_id, field, old_value, new_value, hlc) VALUES (?,?,?,?,?,?)');
  const owId = `${op.id}:${field}`;
  if (wins) {
    if (curH != null && curV !== value) ow.run(owId, nul(entityId), field, nul(curV), nul(value), nul(op.hlc));
    db.prepare(`UPDATE entities SET ${col} = ?, ${hcol} = ? WHERE id = ?`).run(nul(value), nul(op.hlc), nul(entityId));
  } else if (curV !== value) {
    ow.run(owId, nul(entityId), field, nul(value), nul(curV), nul(op.hlc));
  }
}

// 實體列不存在時先建空殼，讓比建立更早到的更新不會遺失。
function ensureEntity(db, op, entityId) {
  db.prepare('INSERT OR IGNORE INTO entities(id, space, created_hlc) VALUES (?,?,?)')
    .run(nul(entityId), nul(op.space), nul(op.hlc));
}

function createEntity(db, op) {
  const d = op.data;
  ensureEntity(db, op, d.entityId);
  db.prepare(`UPDATE entities SET type = COALESCE(type, ?), space = COALESCE(space, ?),
    created_hlc = CASE WHEN created_hlc IS NULL OR created_hlc > ? THEN ? ELSE created_hlc END WHERE id = ?`)
    .run(nul(d.type), nul(op.space), nul(op.hlc), nul(op.hlc), nul(d.entityId));
  writeField(db, op, d.entityId, 'name', d.name);
  if (d.summary != null) writeField(db, op, d.entityId, 'summary', d.summary);
  entityText(db, d.entityId);
}

function updateEntity(db, op) {
  const d = op.data;
  if (!FIELD_COL[d.field]) throw new Error(`未知的實體欄位：${d.field}`);
  ensureEntity(db, op, d.entityId);
  writeField(db, op, d.entityId, d.field, d.value);
  entityText(db, d.entityId);
}

function addAlias(db, op) {
  const d = op.data;
  const key = nameKey(d.alias);
  const handle = d.isHandle ? 1 : 0;
  const platform = nul(d.platform);
  const audience = d.audience ?? 'public';
  checkAudience(audience);
  db.prepare(`INSERT OR IGNORE INTO aliases(id, space, entity_id, alias, alias_key, platform, is_handle, conflict, audience)
    VALUES (?,?,?,?,?,?,?,0,?)`).run(nul(d.aliasId), nul(op.space), nul(d.entityId), nul(d.alias), key, platform, handle, audience);
  if (handle) {
    const others = db.prepare(`SELECT id FROM aliases WHERE space = ? AND platform IS ? AND is_handle = 1
      AND alias_key = ? AND entity_id != ?`).all(nul(op.space), platform, key, nul(d.entityId));
    if (others.length) {
      const mark = db.prepare('UPDATE aliases SET conflict = 1 WHERE id = ?');
      mark.run(d.aliasId);
      for (const o of others) mark.run(o.id);
    }
  }
  ftsSet(db, 'alias', d.aliasId, op.space, d.alias);
}

// ---- 事件與事實 ----
function logEpisode(db, op) {
  const d = op.data;
  checkAudience(d.audience);
  db.prepare(`INSERT OR IGNORE INTO episodes(id, space, at, source, audience, body, entity_ids_json, hlc)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(nul(d.episodeId), nul(op.space), nul(d.at), nul(d.source), d.audience, nul(d.body),
      JSON.stringify(d.entityIds ?? []), nul(op.hlc));
  ftsSet(db, 'episode', d.episodeId, op.space, d.body);
}

function remember(db, op) {
  const d = op.data;
  checkAudience(d.audience);
  db.prepare(`INSERT OR IGNORE INTO facts(id, space, subject_id, predicate, object_entity, object_text,
    object_fact, valid_from, valid_to, audience, source_episode, confidence, author, superseded_by, hlc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`)
    .run(nul(d.factId), nul(op.space), nul(d.subjectId), nul(d.predicate), nul(d.objectEntity), nul(d.objectText),
      nul(d.objectFact), nul(d.validFrom), nul(d.validTo), d.audience, nul(d.sourceEpisode),
      d.confidence ?? 1, nul(d.author), nul(op.hlc));
  // 被取代的舊事實依約定已存在；若不存在，UPDATE 不影響任何列，略過是安全的。
  for (const oldId of d.supersedes ?? []) {
    db.prepare(`UPDATE facts SET valid_to = ?, superseded_by = ? WHERE id = ? AND (valid_to IS NULL OR valid_to = '')`)
      .run(nul(d.validFrom), nul(d.factId), nul(oldId));
  }
  ftsSet(db, 'fact', d.factId, op.space,
    [d.predicate, d.objectText].filter((x) => x != null && x !== '').join(' '));
}

function invalidate(db, op) {
  const d = op.data;
  const f = db.prepare('SELECT space, valid_to FROM facts WHERE id = ?').get(nul(d.factId));
  if (!f) return; // 依排序約定，失效操作晚於該事實的建立；不存在代表資料有誤，略過
  if (f.valid_to != null && f.valid_to !== '' && cmpAt(db, f.space, f.valid_to, d.at) <= 0) return;
  db.prepare('UPDATE facts SET valid_to = ?, superseded_by = COALESCE(?, superseded_by) WHERE id = ?')
    .run(nul(d.at), nul(d.by), nul(d.factId));
}

// ---- 合併 ----
// 某個 from 的合併狀態重算：只有一筆 active 才生效；多個不同對象 → 全部 pending 且不指向任何人。
function recomputeMerge(db, fromId) {
  const live = db.prepare(`SELECT id, to_id, status FROM merges WHERE from_id = ? AND status != 'undone'`).all(nul(fromId));
  const targets = new Set(live.map((m) => m.to_id));
  if (live.length === 0) {
    db.prepare('UPDATE entities SET merged_into = NULL WHERE id = ?').run(fromId);
  } else if (targets.size > 1) {
    db.prepare(`UPDATE merges SET status = 'pending' WHERE from_id = ? AND status = 'active'`).run(fromId);
    db.prepare('UPDATE entities SET merged_into = NULL WHERE id = ?').run(fromId);
  } else {
    // 同一對象的重複合併：全部視為 active
    db.prepare(`UPDATE merges SET status = 'active' WHERE from_id = ? AND status = 'pending'`).run(fromId);
    db.prepare('UPDATE entities SET merged_into = ? WHERE id = ?').run([...targets][0], fromId);
  }
}

function merge(db, op) {
  const d = op.data;
  const row = db.prepare('SELECT status FROM merges WHERE id = ?').get(nul(d.mergeId));
  if (row) {
    // 先到的 unmerge 留下的墓碑：補欄位，狀態維持 undone
    db.prepare('UPDATE merges SET space = ?, from_id = ?, to_id = ?, reason = ?, hlc = ? WHERE id = ?')
      .run(nul(op.space), nul(d.fromId), nul(d.toId), nul(d.reason), nul(op.hlc), nul(d.mergeId));
  } else {
    db.prepare(`INSERT INTO merges(id, space, from_id, to_id, reason, status, hlc) VALUES (?,?,?,?,?,'active',?)`)
      .run(nul(d.mergeId), nul(op.space), nul(d.fromId), nul(d.toId), nul(d.reason), nul(op.hlc));
  }
  recomputeMerge(db, d.fromId);
}

function unmerge(db, op) {
  const d = op.data;
  const row = db.prepare('SELECT from_id FROM merges WHERE id = ?').get(nul(d.mergeId));
  if (!row) {
    db.prepare(`INSERT INTO merges(id, space, status, hlc) VALUES (?,?,'undone',?)`).run(nul(d.mergeId), nul(op.space), nul(op.hlc));
    return;
  }
  db.prepare(`UPDATE merges SET status = 'undone' WHERE id = ?`).run(nul(d.mergeId));
  if (row.from_id != null) recomputeMerge(db, row.from_id);
}

function resolveMerge(db, op) {
  const keep = db.prepare('SELECT from_id, to_id FROM merges WHERE id = ?').get(nul(op.data.keepMergeId));
  if (!keep || keep.from_id == null) return; // 依排序約定，保留的合併必先於此操作存在；缺少時略過
  db.prepare(`UPDATE merges SET status = 'undone' WHERE from_id = ? AND id != ? AND status != 'undone'`)
    .run(keep.from_id, nul(op.data.keepMergeId));
  db.prepare(`UPDATE merges SET status = 'active' WHERE id = ?`).run(nul(op.data.keepMergeId));
  db.prepare('UPDATE entities SET merged_into = ? WHERE id = ?').run(keep.to_id, keep.from_id);
}

const HANDLERS = {
  create_space: createSpace,
  set_chapters: setChapters,
  create_entity: createEntity,
  update_entity: updateEntity,
  add_alias: addAlias,
  log_episode: logEpisode,
  remember,
  invalidate,
  merge,
  unmerge,
  resolve_merge: resolveMerge,
};

export function applyOp(db, op) {
  const handler = HANDLERS[op.type];
  if (!handler) throw new Error(`未知的操作類型：${op.type}`);
  db.exec('SAVEPOINT apply_op');
  try {
    if (db.prepare('SELECT 1 FROM applied WHERE op_id = ?').get(nul(op.id))) {
      db.exec('RELEASE apply_op');
      return;
    }
    handler(db, op);
    db.prepare('INSERT INTO applied(op_id, hlc) VALUES (?,?)').run(nul(op.id), nul(op.hlc));
    db.exec('RELEASE apply_op');
  } catch (e) {
    db.exec('ROLLBACK TO apply_op');
    db.exec('RELEASE apply_op');
    throw e;
  }
}
