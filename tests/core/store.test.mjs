import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, rebuildAll } from '../../core/store.mjs';
import { openDb } from '../../core/sqlite.mjs';

process.env.GIT_AUTHOR_NAME = '測試';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = '測試';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

const mkdirs = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  return { dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops'), autoCommit: false };
};
const SP = 'demo';
function seed(s) {
  s.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二'] });
  const a = s.upsertEntity(SP, { type: 'person', name: '林小雨' }).entityId;
  const b = s.upsertEntity(SP, { type: 'person', name: '白衣客' }).entityId;
  const f = s.remember(SP, { subjectId: a, predicate: '師父', objectEntity: b, validFrom: '一', audience: 'public', author: 'test' });
  return { a, b, f };
}

test('寫入後重開同一路徑，資料都在', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a, b, f } = seed(s);
  s.close();
  const s2 = openStore(cfg);
  assert.equal(s2.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  assert.equal(s2.db.prepare('SELECT object_entity o FROM facts WHERE id=?').get(f.factId).o, b);
  assert.equal(s2.listSpaces().length, 1);
  s2.close();
});

test('刪掉 SQLite 檔再開，由操作重建', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { f } = seed(s);
  s.close();
  fs.rmSync(cfg.dbPath);
  const s2 = openStore(cfg);
  assert.ok(s2.db.prepare('SELECT 1 FROM facts WHERE id=?').get(f.factId));
  s2.close();
});

test('重開後新操作的時鐘晚於既有操作', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  seed(s);
  s.close();
  const s2 = openStore(cfg);
  const before = s2.oplog.readAll().map((o) => o.hlc).sort().at(-1);
  s2.upsertEntity(SP, { type: 'person', name: '黑袍人' });
  const last = s2.oplog.readAll().at(-1);
  assert.ok(last.hlc > before);
  s2.close();
});

test('upsertEntity 回傳重複候選；有 entityId 時只更新', () => {
  const s = openStore(mkdirs());
  const { a } = seed(s);
  const r = s.upsertEntity(SP, { type: 'person', name: '林 小雨' });
  assert.equal(r.created, true);
  assert.ok(r.candidates.some((c) => c.entityId === a && c.why === 'name'));
  const u = s.upsertEntity(SP, { entityId: a, type: 'person', name: '林小雨', summary: '劍客學徒' });
  assert.equal(u.created, false);
  assert.equal(s.db.prepare('SELECT summary FROM entities WHERE id=?').get(a).summary, '劍客學徒');
  s.addAlias(SP, a, '落雨劍客');
  const r2 = s.upsertEntity(SP, { type: 'person', name: '落雨劍客' });
  assert.ok(r2.candidates.some((c) => c.entityId === a && c.why === 'alias'));
  s.close();
});

test('remember 回傳同類仍成立的事實', () => {
  const s = openStore(mkdirs());
  const { a, f } = seed(s);
  const black = s.upsertEntity(SP, { type: 'person', name: '黑袍人' }).entityId;
  const r = s.remember(SP, { subjectId: a, predicate: '師父', objectEntity: black, validFrom: '二', audience: 'public', author: 'test' });
  assert.ok(r.sameKindActive.some((x) => x.factId === f.factId));
  s.invalidate(SP, f.factId, '二');
  const r2 = s.remember(SP, { subjectId: a, predicate: '師父', objectText: '城主', validFrom: '二', audience: 'public', author: 'test' });
  assert.ok(!r2.sameKindActive.some((x) => x.factId === f.factId));
  s.close();
});

test('壞的 audience 在寫檔前就被擋下', () => {
  const s = openStore(mkdirs());
  const { a } = seed(s);
  const n = s.oplog.readAll().length;
  assert.throws(() => s.remember(SP, { subjectId: a, predicate: 'x', objectText: 'y', validFrom: '一', audience: 'private', author: 't' }), /未知的可見範圍/);
  assert.equal(s.oplog.readAll().length, n);
  s.close();
});

test('addAlias 太短丟錯；findByHandle', () => {
  const s = openStore(mkdirs());
  const { a } = seed(s);
  assert.throws(() => s.addAlias(SP, a, '小'), /別名至少兩個字/);
  s.addAlias(SP, a, '@xiaoyu', { platform: 'line', isHandle: true });
  assert.equal(s.findByHandle(SP, 'line', '@XiaoYu'), a);
  assert.equal(s.findByHandle(SP, 'line', '@nobody'), null);
  s.close();
});

test('合併、resolve、unmerge；自併與迴圈被拒', () => {
  const s = openStore(mkdirs());
  const { a, b } = seed(s);
  assert.throws(() => s.mergeEntities(SP, a, a, 'x'), /不能把人物併到自己/);
  const m = s.mergeEntities(SP, a, b, '同一人');
  assert.equal(s.resolve(a), b);
  assert.throws(() => s.mergeEntities(SP, b, a, 'x'), /這個合併會形成迴圈/);
  s.unmerge(SP, m);
  assert.equal(s.resolve(a), a);
  s.close();
});

test('未套用的操作比已套用的舊：整個重建，結果等於排序後重播', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { f } = seed(s);
  s.close();
  // 另一台裝置較舊的操作：取代林小雨的師父事實。依排序重播時該事實尚不存在，所以不會被取代；
  // 若只是照到達順序就地套用，舊事實會被錯誤地標失效。
  const old = { id: '00OLD', dev: 'ZZZ', hlc: '0000000000001-0000-ZZZ', type: 'remember', space: SP,
    data: { factId: 'oldfact', subjectId: 'x', predicate: '師父', objectText: '城主', validFrom: '二',
      audience: 'public', author: 'test', supersedes: [f.factId] } };
  fs.writeFileSync(path.join(cfg.opsDir, 'other-ZZZ.jsonl'), JSON.stringify(old) + '\n');
  const s2 = openStore(cfg);
  assert.ok(s2.db.prepare('SELECT 1 FROM facts WHERE id=?').get('oldfact'));
  const row = s2.db.prepare('SELECT valid_to, superseded_by FROM facts WHERE id=?').get(f.factId);
  assert.equal(row.valid_to, null);
  assert.equal(row.superseded_by, null);
  s2.close();
});

test('未套用的操作都比已套用的新：就地補套，不清空既有資料', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a } = seed(s);
  // 哨兵列：重建會清掉 overwrites 與 applied，補套則不會
  s.db.prepare("INSERT INTO overwrites(id, entity_id, field, old_value, new_value, hlc) VALUES ('sentinel',?,?,?,?,?)")
    .run(a, 'name', 'x', 'y', '0');
  s.db.prepare("INSERT INTO vectors(ref_id, kind, model, dim, vec) VALUES ('v1','entity','m',1,x'00')").run();
  s.close();
  const fresh = { id: '99NEW', dev: 'ZZZ', hlc: '9999999999999-0000-ZZZ', type: 'create_entity', space: SP,
    data: { entityId: 'new1', type: 'person', name: '城主' } };
  fs.writeFileSync(path.join(cfg.opsDir, 'other-ZZZ.jsonl'), JSON.stringify(fresh) + '\n');
  const s2 = openStore(cfg);
  assert.ok(s2.db.prepare('SELECT 1 FROM entities WHERE id=?').get('new1'));
  assert.ok(s2.db.prepare("SELECT 1 FROM overwrites WHERE id='sentinel'").get());
  assert.ok(s2.db.prepare("SELECT 1 FROM vectors WHERE ref_id='v1'").get());
  s2.close();
});

// ---- C1：毒操作 ----
test('upsertEntity 缺 type 或 name 丟錯，主本沒有新行，重開正常', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  seed(s);
  const n = s.oplog.readAll().length;
  assert.throws(() => s.upsertEntity(SP, { name: '城主' }), /type/);
  assert.throws(() => s.upsertEntity(SP, { type: 'person' }), /name/);
  assert.equal(s.oplog.readAll().length, n);
  s.close();
  const s2 = openStore(cfg);
  assert.equal(s2.oplog.readAll().length, n);
  s2.close();
});

test('套用失敗的操作不寫進主本（先套用、成功才 append）', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a } = seed(s);
  const n = s.oplog.readAll().length;
  assert.throws(() => s._emit('update_entity', SP, { entityId: a, field: 'bogus', value: 'x' }), /未知的實體欄位/);
  assert.equal(s.oplog.readAll().length, n);
  s.close();
  const s2 = openStore(cfg);
  assert.equal(s2.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  s2.close();
});

test('主本裡套用不了的操作：重開時略過並 warn，其餘資料正常', (t) => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a } = seed(s);
  s.close();
  const bad = { id: '01BAD', dev: 'ZZZ', hlc: '9999999999990-0000-ZZZ', type: 'update_entity', space: SP,
    data: { entityId: a, field: 'bogus', value: 'x' } };
  const good = { id: '01GOOD', dev: 'ZZZ', hlc: '9999999999991-0000-ZZZ', type: 'create_entity', space: SP,
    data: { entityId: 'new1', type: 'person', name: '城主' } };
  fs.writeFileSync(path.join(cfg.opsDir, 'other-ZZZ.jsonl'), [bad, good].map((o) => JSON.stringify(o) + '\n').join(''));
  const warn = t.mock.method(console, 'warn', () => {});
  const s2 = openStore(cfg);
  assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('01BAD')));
  assert.ok(s2.db.prepare('SELECT 1 FROM entities WHERE id=?').get('new1'));
  assert.equal(s2.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  s2.close();
  const s3 = openStore(cfg); // 再開一次也不丟錯
  assert.ok(s3.db.prepare('SELECT 1 FROM entities WHERE id=?').get('new1'));
  s3.close();
});

test('章節軸寫入未知章節被拒且不寫入', () => {
  const s = openStore(mkdirs());
  const { a, f } = seed(s);
  const n = s.oplog.readAll().length;
  const base = { subjectId: a, predicate: '有', objectText: '劍', audience: 'public', author: 't' };
  assert.throws(() => s.remember(SP, { ...base, validFrom: '九' }), /未知的章節：九/);
  assert.throws(() => s.remember(SP, { ...base, validFrom: '一', validTo: '九' }), /未知的章節：九/);
  assert.throws(() => s.invalidate(SP, f.factId, '九'), /未知的章節：九/);
  assert.throws(() => s.logEpisode(SP, { at: '九', source: 'x', audience: 'public', body: 'b' }), /未知的章節：九/);
  assert.equal(s.oplog.readAll().length, n);
  s.close();
});

test('setChapters 不准移除已被用到的章節', () => {
  const s = openStore(mkdirs());
  seed(s);
  assert.throws(() => s.setChapters(SP, ['二']), /一/);
  s.setChapters(SP, ['一', '二', '三']);
  assert.deepEqual(JSON.parse(s.listSpaces()[0].chapters_json), ['一', '二', '三']);
  s.close();
});

// ---- I3：多程序同時使用同一個 db 與 ops ----
test('兩個 Store 交錯寫入：時鐘嚴格遞增、沒有重複、重開一致', (t) => {
  const cfg = mkdirs();
  const fixed = Date.now();
  t.mock.method(Date, 'now', () => fixed); // 同一毫秒內交錯寫入，最容易撞出相同的時鐘
  const s1 = openStore(cfg);
  const s2 = openStore(cfg);
  s1.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二'] });
  const ids = [];
  for (let i = 0; i < 10; i++) {
    ids.push(s1.upsertEntity(SP, { type: 'person', name: `林小雨${i}` }).entityId);
    ids.push(s2.upsertEntity(SP, { type: 'person', name: `白衣客${i}` }).entityId);
  }
  const ops = s1.oplog.readAll();
  const hlcs = ops.map((o) => o.hlc);
  for (let i = 1; i < hlcs.length; i++) assert.ok(hlcs[i] > hlcs[i - 1], `第 ${i} 筆時鐘沒有遞增：${hlcs[i - 1]} ${hlcs[i]}`);
  assert.equal(new Set(ops.map((o) => o.id)).size, ops.length);
  for (const id of ids) {
    assert.ok(s1.db.prepare('SELECT 1 FROM entities WHERE id=?').get(id));
    assert.ok(s2.db.prepare('SELECT 1 FROM entities WHERE id=?').get(id));
  }
  assert.equal(s1.db.prepare('SELECT COUNT(*) n FROM applied').get().n, ops.length);
  s1.close(); s2.close();
  assert.ok(!fs.existsSync(path.join(cfg.opsDir, '.lock')));
  assert.match(fs.readFileSync(path.join(cfg.opsDir, '.gitignore'), 'utf8'), /^\.lock$/m);
});

test('另一個程序套用了時鐘較快的遠端操作後，這邊下一筆寫入仍排在後面', () => {
  const cfg = mkdirs();
  const mcp = openStore(cfg); // 長駐的 MCP server
  const { a } = seed(mcp);
  // 另一台裝置（時鐘快 10 分鐘）改了摘要；命令列 sync（另一個程序）把它拉進來
  const fut = `${String(Date.now() + 600000).padStart(13, '0')}-0000-OTHERDEV`;
  fs.writeFileSync(path.join(cfg.opsDir, 'other-OTHERDEV.jsonl'), JSON.stringify({ id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', dev: 'OTHERDEV',
    hlc: fut, type: 'update_entity', space: SP, data: { entityId: a, field: 'summary', value: '遠端的舊改動' } }) + '\n');
  const cli = openStore(cfg);
  cli.close();
  mcp.upsertEntity(SP, { entityId: a, summary: '本機最新改動' });
  assert.equal(mcp.db.prepare('SELECT summary FROM entities WHERE id=?').get(a).summary, '本機最新改動');
  assert.ok(mcp.oplog.readAll().filter((o) => o.dev === mcp.device).at(-1).hlc > fut);
  mcp.close();
});

test('殘留超過 60 秒的鎖檔視為殘留並移除', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const lock = path.join(cfg.opsDir, '.lock');
  fs.writeFileSync(lock, 'old');
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  seed(s);
  assert.ok(!fs.existsSync(lock));
  s.close();
});

test('兩個子程序同時寫同一個 db 與 ops：全部寫進、時鐘不重複', async () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  s.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter', chapters: ['一'] });
  s.close();
  const storeUrl = new URL('../../core/store.mjs', import.meta.url).href;
  const code = (tag) => `const { openStore } = await import(${JSON.stringify(storeUrl)});
    const s = openStore(${JSON.stringify(cfg)});
    for (let i = 0; i < 15; i++) s.upsertEntity('${SP}', { type: 'person', name: '${tag}' + i });
    s.close();`;
  const { spawn } = await import('node:child_process');
  const run = (tag) => new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code(tag)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(err))));
  });
  await Promise.all([run('林小雨'), run('白衣客')]);
  const s2 = openStore(cfg);
  const ops = s2.oplog.readAll();
  assert.equal(ops.length, 31);
  assert.equal(new Set(ops.map((o) => o.hlc)).size, 31);
  assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM entities').get().n, 30);
  assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM applied').get().n, 31);
  s2.close();
});

// ---- I4：rebuildAll 包在交易裡 ----
test('rebuildAll 中途失敗：回滾，舊資料保留', () => {
  const s = openStore(mkdirs());
  const { a } = seed(s);
  const ops = s.oplog.readAll();
  const bomb = { id: 'x', get hlc() { throw new Error('壞掉的操作'); } };
  assert.throws(() => rebuildAll(s.db, [...ops, bomb]), /壞掉的操作/);
  assert.equal(s.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM applied').get().n, ops.length);
  s.close();
});

// ---- I5：資料庫裡有主本沒有的已套用操作 ----
test('資料庫搭配另一個 ops 目錄開啟：整個重建成只含新 ops 的內容並 warn', (t) => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a } = seed(s);
  s.close();
  const other = { ...mkdirs(), dbPath: cfg.dbPath };
  const warn = t.mock.method(console, 'warn', () => {});
  const s2 = openStore(other);
  assert.ok(warn.mock.calls.some((c) => /重建/.test(String(c.arguments[0]))));
  assert.equal(s2.db.prepare('SELECT 1 FROM entities WHERE id=?').get(a), undefined);
  assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM applied').get().n, 0);
  assert.equal(s2.listSpaces().length, 0);
  s2.close();
});

// ---- schema 版本 ----
test('舊版資料庫（user_version 1、aliases 沒有 audience）：清空重建並從主本重播', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a, f } = seed(s);
  s.addAlias(SP, a, '落雨劍客', { audience: `person:${a}` });
  s.close();
  const db = openDb(cfg.dbPath);
  db.exec('DROP TABLE aliases');
  db.exec(`CREATE TABLE aliases(id TEXT PRIMARY KEY, space TEXT, entity_id TEXT, alias TEXT, alias_key TEXT,
    platform TEXT, is_handle INTEGER DEFAULT 0, conflict INTEGER DEFAULT 0)`);
  db.exec('PRAGMA user_version = 1');
  db.close();
  const s2 = openStore(cfg);
  assert.equal(s2.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(s2.db.prepare('SELECT audience FROM aliases WHERE entity_id=?').get(a).audience, `person:${a}`);
  assert.ok(s2.db.prepare('SELECT 1 FROM facts WHERE id=?').get(f.factId));
  s2.close();
});

// ---- minor ----
test('日期軸寫入要用 ISO 格式', () => {
  const s = openStore(mkdirs());
  s.createSpace({ id: 'sns', name: '社群', kind: 'social', timeAxis: 'date' });
  const a = s.upsertEntity('sns', { type: 'person', name: '林小雨' }).entityId;
  const base = { subjectId: a, predicate: '在', objectText: '城裡', audience: 'public', author: 't' };
  const n = s.oplog.readAll().length;
  for (const bad of ['2026/01/01', '昨天', '2026-1-1', 'ch01']) {
    assert.throws(() => s.remember('sns', { ...base, validFrom: bad }), /日期格式/, bad);
  }
  assert.throws(() => s.logEpisode('sns', { at: '上週', source: 'x', audience: 'public', body: 'b' }), /日期格式/);
  assert.equal(s.oplog.readAll().length, n);
  const f = s.remember('sns', { ...base, validFrom: '2026-01-01' }).factId;
  s.remember('sns', { ...base, validFrom: '2026-01-01T10:00:00Z' });
  s.remember('sns', { ...base, validFrom: '2026-01-01T10:00:00.123+08:00' });
  assert.throws(() => s.invalidate('sns', f, '明天'), /日期格式/);
  s.invalidate('sns', f, '2026-02-01');
  s.close();
});

test('mergeEntities 兩邊要在同一個空間', () => {
  const s = openStore(mkdirs());
  const { a } = seed(s);
  s.createSpace({ id: 'other', name: '別處', kind: 'story', timeAxis: 'chapter', chapters: ['一'] });
  const x = s.upsertEntity('other', { type: 'person', name: '城主' }).entityId;
  assert.throws(() => s.mergeEntities(SP, a, x, '同一人'), /同一個空間/);
  assert.throws(() => s.mergeEntities('other', a, x, '同一人'), /同一個空間/);
  assert.throws(() => s.mergeEntities(SP, a, 'nobody', '同一人'), /找不到人物/);
  s.close();
});

test('格式不合的操作行：開啟不丟錯、資料都在、各警告一次、重開不重建', () => {
  const cfg = mkdirs();
  const s = openStore(cfg);
  const { a } = seed(s);
  s.close();
  const file = fs.readdirSync(cfg.opsDir).find((f) => f.endsWith('.jsonl'));
  fs.appendFileSync(path.join(cfg.opsDir, file), [
    '{"id":"x","hlc":"garbage","type":"create_entity","space":"demo","data":{}}',
    'null',
    '{"hlc":"0000000000001-0000-dev","type":"create_entity"}',
    '',
  ].join('\n'));
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  let s2;
  try {
    s2 = openStore(cfg);
  } finally { console.warn = orig; }
  assert.equal(s2.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  assert.equal(warns.filter((m) => m.startsWith('略過格式不合的操作')).length, 3);
  assert.ok(warns.includes('略過格式不合的操作：x'));
  assert.ok(warns.includes('略過格式不合的操作：(無 id)'));
  const n = s2.db.prepare('SELECT COUNT(*) c FROM applied').get().c;
  s2.close();
  const s3 = openStore(cfg);
  assert.equal(s3.db.prepare('SELECT COUNT(*) c FROM applied').get().c, n);
  assert.equal(s3.db.prepare('SELECT name FROM entities WHERE id=?').get(a).name, '林小雨');
  s3.close();
});
