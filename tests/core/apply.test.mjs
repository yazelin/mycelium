import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../core/sqlite.mjs';
import { applyOp, compareOps } from '../../core/apply.mjs';

let n = 0;
const hl = (k) => `${String(1000 + k).padStart(13, '0')}-0000-A`;
function op(type, data, k = ++n, space = 's1') {
  return { id: `op${n++}-${k}`, dev: 'A', hlc: hl(k), type, space, data };
}
function setup() {
  const db = openDb(':memory:');
  applyOp(db, op('create_space', { name: '江湖', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二', '三'] }, 1));
  for (const [id, name] of [['e1', '林小雨'], ['e2', '白衣客'], ['e3', '黑袍人']]) {
    applyOp(db, op('create_entity', { entityId: id, type: 'person', name, summary: '示範' }, 2));
  }
  return db;
}
const all = (db, sql, ...a) => db.prepare(sql).all(...a);
const count = (db) => Object.fromEntries(['spaces', 'entities', 'aliases', 'facts', 'episodes', 'merges', 'overwrites', 'applied', 'fts']
  .map((t) => [t, db.prepare(`SELECT count(*) c FROM ${t}`).get().c]));

test('create_space 與 set_chapters', () => {
  const db = setup();
  applyOp(db, op('set_chapters', { chapters: ['一', '二', '三', '四'] }));
  const s = db.prepare('SELECT * FROM spaces WHERE id = ?').get('s1');
  assert.equal(s.time_axis, 'chapter');
  assert.deepEqual(JSON.parse(s.chapters_json), ['一', '二', '三', '四']);
});

test('create_entity 寫入並建 fts', () => {
  const db = setup();
  const e = db.prepare('SELECT * FROM entities WHERE id = ?').get('e1');
  assert.equal(e.name, '林小雨');
  assert.equal(all(db, "SELECT * FROM fts WHERE kind='entity' AND ref_id='e1'").length, 1);
  assert.equal(all(db, "SELECT ref_id FROM fts WHERE fts MATCH '林小雨'").length, 1);
});

test('update_entity：先套新的再套舊的，仍是新值並記 overwrites', () => {
  const db = setup();
  applyOp(db, op('update_entity', { entityId: 'e1', field: 'name', value: '新名' }, 50));
  applyOp(db, op('update_entity', { entityId: 'e1', field: 'name', value: '舊名' }, 20));
  assert.equal(db.prepare('SELECT name FROM entities WHERE id=?').get('e1').name, '新名');
  const ow = all(db, 'SELECT * FROM overwrites WHERE entity_id = ?', 'e1');
  assert.ok(ow.some((r) => r.old_value === '舊名' && r.new_value === '新名'));
  assert.equal(all(db, "SELECT * FROM fts WHERE kind='entity' AND text LIKE '%新名%'").length, 1);
});

test('update_entity 較晚者蓋掉並記舊值', () => {
  const db = setup();
  applyOp(db, op('update_entity', { entityId: 'e1', field: 'summary', value: '甲' }, 30));
  applyOp(db, op('update_entity', { entityId: 'e1', field: 'summary', value: '乙' }, 40));
  assert.equal(db.prepare('SELECT summary FROM entities WHERE id=?').get('e1').summary, '乙');
  assert.ok(all(db, 'SELECT * FROM overwrites').some((r) => r.old_value === '甲' && r.new_value === '乙'));
});

test('add_alias 與同 handle 衝突', () => {
  const db = setup();
  applyOp(db, op('add_alias', { aliasId: 'a1', entityId: 'e1', alias: '小雨', platform: 'line', isHandle: true }));
  applyOp(db, op('add_alias', { aliasId: 'a2', entityId: 'e2', alias: ' 小雨 ', platform: 'line', isHandle: true }));
  assert.deepEqual(all(db, 'SELECT conflict FROM aliases ORDER BY id').map((r) => r.conflict), [1, 1]);
  applyOp(db, op('add_alias', { aliasId: 'a3', entityId: 'e3', alias: '小雨', platform: 'discord', isHandle: true }));
  assert.equal(db.prepare('SELECT conflict FROM aliases WHERE id=?').get('a3').conflict, 0);
  assert.equal(all(db, "SELECT * FROM fts WHERE kind='alias'").length, 3);
});

test('log_episode 與 audience 驗證', () => {
  const db = setup();
  applyOp(db, op('log_episode', { episodeId: 'p1', at: '一', source: 'chat', audience: 'person:e1', body: '落雨劍客出手', entityIds: ['e1'] }));
  assert.equal(db.prepare('SELECT audience FROM episodes').get().audience, 'person:e1');
  assert.throws(() => applyOp(db, op('log_episode', { episodeId: 'p2', at: '一', source: 'x', audience: 'private', body: 'x' })), /未知的可見範圍：private/);
  assert.equal(count(db).episodes, 1);
  assert.equal(count(db).applied, 5);
});

test('remember 帶 supersedes；invalidate 冪等', () => {
  const db = setup();
  applyOp(db, op('remember', { factId: 'f1', subjectId: 'e1', predicate: '住在', objectText: '山上', validFrom: '一', audience: 'public', author: 'a' }));
  applyOp(db, op('remember', { factId: 'f2', subjectId: 'e1', predicate: '住在', objectText: '城裡', validFrom: '二', audience: 'group:g', author: 'a', supersedes: ['f1'] }));
  const f1 = db.prepare('SELECT * FROM facts WHERE id=?').get('f1');
  assert.equal(f1.valid_to, '二');
  assert.equal(f1.superseded_by, 'f2');
  assert.equal(all(db, "SELECT * FROM fts WHERE kind='fact' AND text LIKE '%城裡%'").length, 1);
  applyOp(db, op('invalidate', { factId: 'f2', at: '三' }));
  applyOp(db, op('invalidate', { factId: 'f2', at: '三' }));
  assert.equal(db.prepare('SELECT valid_to FROM facts WHERE id=?').get('f2').valid_to, '三');
  applyOp(db, op('invalidate', { factId: 'f2', at: '三', by: 'x' }));
  assert.equal(db.prepare('SELECT valid_to FROM facts WHERE id=?').get('f2').valid_to, '三');
  applyOp(db, op('invalidate', { factId: 'f1', at: '三' }));
  assert.equal(db.prepare('SELECT valid_to FROM facts WHERE id=?').get('f1').valid_to, '二');
});

test('merge 衝突 → pending；resolve_merge 後剩一筆 active', () => {
  const db = setup();
  applyOp(db, op('merge', { mergeId: 'm1', fromId: 'e1', toId: 'e2', reason: '同人' }));
  assert.equal(db.prepare('SELECT merged_into FROM entities WHERE id=?').get('e1').merged_into, 'e2');
  applyOp(db, op('merge', { mergeId: 'm2', fromId: 'e1', toId: 'e3', reason: '同人' }));
  assert.deepEqual(all(db, 'SELECT status FROM merges ORDER BY id').map((r) => r.status), ['pending', 'pending']);
  assert.equal(db.prepare('SELECT merged_into FROM entities WHERE id=?').get('e1').merged_into, null);
  applyOp(db, op('resolve_merge', { keepMergeId: 'm2' }));
  assert.deepEqual(all(db, 'SELECT id, status FROM merges ORDER BY id').map((r) => r.status), ['undone', 'active']);
  assert.equal(db.prepare('SELECT merged_into FROM entities WHERE id=?').get('e1').merged_into, 'e3');
});

test('unmerge 清除 merged_into', () => {
  const db = setup();
  applyOp(db, op('merge', { mergeId: 'm1', fromId: 'e1', toId: 'e2', reason: 'r' }));
  applyOp(db, op('unmerge', { mergeId: 'm1' }));
  assert.equal(db.prepare('SELECT status FROM merges').get().status, 'undone');
  assert.equal(db.prepare('SELECT merged_into FROM entities WHERE id=?').get('e1').merged_into, null);
});

test('同一 op 套兩次，各表列數不變', () => {
  const db = setup();
  const ops = [
    op('add_alias', { aliasId: 'a1', entityId: 'e1', alias: '小雨' }),
    op('log_episode', { episodeId: 'p1', at: '一', source: 's', audience: 'public', body: '白衣客登場' }),
    op('remember', { factId: 'f1', subjectId: 'e1', predicate: '是', objectText: '劍客', validFrom: '一', audience: 'public', author: 'a' }),
    op('update_entity', { entityId: 'e1', field: 'name', value: '改名' }, 99),
    op('merge', { mergeId: 'm1', fromId: 'e1', toId: 'e2', reason: 'r' }),
  ];
  ops.forEach((o) => applyOp(db, o));
  const before = count(db);
  ops.forEach((o) => applyOp(db, o));
  assert.deepEqual(count(db), before);
});

test('未知類型與失敗時整體回滾', () => {
  const db = setup();
  const before = count(db);
  assert.throws(() => applyOp(db, op('nope', {})), /未知的操作類型/);
  assert.throws(() => applyOp(db, op('remember', { factId: 'f9', subjectId: 'e1', predicate: 'p', validFrom: '一', audience: 'x:y', author: 'a' })), /未知的可見範圍/);
  assert.deepEqual(count(db), before);
});

test('compareOps 依 hlc、dev、id 排序', () => {
  const a = { hlc: '1', dev: 'B', id: 'x' };
  const b = { hlc: '1', dev: 'A', id: 'z' };
  const c = { hlc: '0', dev: 'Z', id: 'z' };
  const d = { hlc: '1', dev: 'A', id: 'y' };
  assert.deepEqual([a, b, c, d].sort(compareOps), [c, d, b, a]);
  assert.equal(compareOps(a, a), 0);
});

test('打亂後用 compareOps 排序再套用，結果與原順序相同', () => {
  const mk = () => [
    op('create_entity', { entityId: 'e1', type: 'person', name: '林小雨' }, 10),
    op('remember', { factId: 'f1', subjectId: 'e1', predicate: '住在', objectText: '山上', validFrom: '一', audience: 'public', author: 'a' }, 11),
    op('remember', { factId: 'f2', subjectId: 'e1', predicate: '住在', objectText: '城裡', validFrom: '二', audience: 'public', author: 'a', supersedes: ['f1'] }, 12),
    op('invalidate', { factId: 'f2', at: '三' }, 13),
  ];
  const dump = (db) => JSON.stringify(['entities', 'facts', 'fts'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
  const ops = mk();
  const base = openDb(':memory:');
  applyOp(base, op('create_space', { name: '江湖', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二', '三'] }, 1));
  ops.forEach((o) => applyOp(base, o));
  const shuffled = [ops[3], ops[1], ops[2], ops[0]].sort(compareOps).reverse().sort(compareOps);
  const db2 = openDb(':memory:');
  applyOp(db2, op('create_space', { name: '江湖', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二', '三'] }, 1));
  [ops[3], ops[1], ops[2], ops[0]].sort(compareOps).forEach((o) => applyOp(db2, o));
  assert.deepEqual(shuffled.map((o) => o.id), ops.map((o) => o.id));
  assert.equal(dump(db2).replace(/op\d+-/g, ''), dump(base).replace(/op\d+-/g, ''));
});
