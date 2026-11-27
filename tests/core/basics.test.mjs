import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nameKey } from '../../core/names.mjs';
import { openDb } from '../../core/sqlite.mjs';
import { ulid, Hlc } from '../../core/ids.mjs';
import { cmpTime, activeAt } from '../../core/time.mjs';

test('nameKey', () => {
  assert.equal(nameKey('林 小雨'), nameKey('林小雨'));
  assert.equal(nameKey('ＡＢ'), 'ab');
  assert.equal(nameKey('  '), '');
  assert.equal(nameKey(null), '');
});

test('openDb 建表', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['spaces', 'entities', 'aliases', 'facts', 'episodes', 'merges', 'overwrites', 'applied', 'vectors', 'fts']) {
    assert.ok(names.includes(t), `缺表：${t}`);
  }
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const runChild = (code) =>
  spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8' });

// 對照組：這版 Node 直接 import node:sqlite 會不會印警告（之後的 Node 可能已移除這個警告）
const control = runChild("import('node:sqlite')");
const nodeWarns = /ExperimentalWarning/.test(control.stderr);

test('core/sqlite.mjs 壓掉 SQLite 實驗警告（子程序）', (t) => {
  const r = runChild("import('./core/sqlite.mjs').then(m=>m.openDb(':memory:'))");
  assert.equal(r.status, 0, r.stderr);
  if (!nodeWarns) return t.skip('這版 Node 直接 import node:sqlite 不印警告，無從驗證壓掉');
  assert.doesNotMatch(r.stderr, /SQLite/);
});

test('對照組：直接 import node:sqlite 會印警告（不印就跳過）', (t) => {
  assert.equal(control.status, 0, control.stderr);
  if (!nodeWarns) return t.skip('這版 Node 已不印 SQLite 實驗警告');
  assert.match(control.stderr, /ExperimentalWarning/);
});

test('FTS trigram 可搜中文', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO fts(kind, ref_id, space, text) VALUES (?,?,?,?)').run('fact', 'f1', 's1', '黑洞先生是室友');
  const rows = db.prepare("SELECT ref_id FROM fts WHERE fts MATCH '黑洞先'").all();
  assert.equal(rows.length, 1);
});

test('ulid 不重複且遞增', () => {
  const ids = Array.from({ length: 1000 }, () => ulid());
  assert.equal(new Set(ids).size, 1000);
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1]);
});

test('Hlc', () => {
  const h = new Hlc('dev1');
  const a = h.now();
  const b = h.now();
  assert.ok(b > a);
  assert.match(a, /^\d{13}-\d{4}-dev1$/);
  const future = `${String(Date.now() + 60000).padStart(13, '0')}-0005-dev2`;
  h.observe(future);
  assert.ok(h.now() > future);
});

test('cmpTime 與 activeAt', () => {
  const sp = { time_axis: 'chapter', chapters: ['序章', 'ch01', 'ch02'] };
  assert.equal(cmpTime(sp, 'ch02', 'ch01'), 1);
  assert.equal(cmpTime(sp, 'ch01', 'ch01'), 0);
  assert.throws(() => cmpTime(sp, 'chX', 'ch01'), /未知的章節/);
  assert.equal(cmpTime({ time_axis: 'date' }, '2026-01-02', '2026-01-01'), 1);
  const f = { valid_from: 'ch01', valid_to: 'ch02' };
  assert.equal(activeAt(sp, f, 'ch01'), true);
  assert.equal(activeAt(sp, f, 'ch02'), false);
  assert.equal(activeAt(sp, f, '序章'), false);
  assert.equal(activeAt(sp, f, null), false);
  assert.equal(activeAt(sp, { valid_from: 'ch01', valid_to: null }, null), true);
});

test('Hlc.observe：遠端時間超過現在＋1 天只推進到現在＋1 天並 warn', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const h = new Hlc('dev1');
  const DAY = 86400000;
  const far = `${String(Date.now() + 30 * DAY).padStart(13, '0')}-0000-dev2`;
  h.observe(far);
  assert.equal(warn.mock.calls.length, 1);
  const ms = Number(h.now().split('-')[0]);
  assert.ok(ms <= Date.now() + DAY + 1000, `推進太多：${ms - Date.now()}`);
  assert.ok(ms >= Date.now() + DAY - 1000);
  const near = `${String(Date.now() + 60000).padStart(13, '0')}-0000-dev2`;
  new Hlc('dev3').observe(near); // 一天內照常推進、不 warn
  assert.equal(warn.mock.calls.length, 1);
});

test('Hlc 同一毫秒連續 10001 次 now()：計數到 9999 後進位到下一毫秒，格式都合法且遞增', async () => {
  const { isValidOp } = await import('../../core/store.mjs');
  const h = new Hlc('DEV');
  const realNow = Date.now;
  Date.now = () => 1700000000000; // 時鐘停住
  let prev = '';
  try {
    for (let i = 0; i < 10001; i++) {
      const t = h.now();
      assert.ok(isValidOp({ id: 'x', hlc: t, type: 'note' }), `第 ${i} 次格式不合：${t}`);
      assert.ok(t > prev, `第 ${i} 次沒有遞增：${prev} ${t}`);
      prev = t;
    }
  } finally { Date.now = realNow; }
  assert.equal(prev, '1700000000001-0000-DEV');
});
