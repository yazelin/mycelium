import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../../core/store.mjs';
import { sync, rebuild, defaultCheckPrivate } from '../../core/sync.mjs';

process.env.GIT_AUTHOR_NAME = '測試';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = '測試';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SP = 'demo';

// 甲先建立空間並第一次 sync（推上空的遠端）；乙 clone 後開啟
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const bare = path.join(root, 'remote.git');
  git(root, 'init', '--bare', '-q', bare);
  const a = openStore({ dbPath: path.join(root, 'a.db'), opsDir: path.join(root, 'a-ops') });
  git(a.oplog.dir, 'remote', 'add', 'origin', bare);
  a.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二'] });
  const lin = a.upsertEntity(SP, { type: 'person', name: '林小雨' }).entityId;
  const white = a.upsertEntity(SP, { type: 'person', name: '白衣客' }).entityId;
  const black = a.upsertEntity(SP, { type: 'person', name: '黑袍人' }).entityId;
  const r = await sync(a, { branch: 'main', requirePrivate: false });
  assert.equal(r.pushed, true);
  git(root, 'clone', '-q', '-b', 'main', bare, path.join(root, 'b-ops'));
  const b = openStore({ dbPath: path.join(root, 'b.db'), opsDir: path.join(root, 'b-ops') });
  assert.equal(b.listSpaces().length, 1);
  return { root, bare, a, b, lin, white, black };
}
const snap = (s) => {
  const q = (t, o) => s.db.prepare(`SELECT * FROM ${t} ORDER BY ${o}`).all().map((r) => ({ ...r }));
  return { entities: q('entities', 'id'), facts: q('facts', 'id'), aliases: q('aliases', 'id'),
    merges: q('merges', 'id'), overwrites: q('overwrites', 'id') };
};
const S = (s) => JSON.stringify(s);

test('離線各自寫入，同步後兩邊一致；較晚的摘要勝，被蓋過的留在 overwrites', async () => {
  const { a, b, lin, white } = await setup();
  a.upsertEntity(SP, { entityId: lin, summary: '甲寫的摘要' });
  a.remember(SP, { subjectId: lin, predicate: '師父', objectEntity: white, validFrom: '一', audience: 'public', author: 'a' });
  b.upsertEntity(SP, { type: 'person', name: '落雨劍客' });
  b.upsertEntity(SP, { entityId: lin, summary: '乙寫的摘要' });
  await sync(a, { branch: 'main', requirePrivate: false });
  await sync(b, { branch: 'main', requirePrivate: false });
  await sync(a, { branch: 'main', requirePrivate: false });
  assert.equal(S(snap(a)), S(snap(b)));
  const row = a.db.prepare('SELECT summary FROM entities WHERE id=?').get(lin);
  assert.equal(row.summary, '乙寫的摘要');
  const ow = a.db.prepare('SELECT * FROM overwrites').all();
  assert.ok(ow.some((o) => JSON.stringify(o).includes('甲寫的摘要')));
  assert.equal(snap(a).facts.length, 1);
});

test('同步順序反過來（乙先）結果相同', async () => {
  const x = await setup();
  x.a.upsertEntity(SP, { entityId: x.lin, summary: '甲寫的摘要' });
  x.b.upsertEntity(SP, { entityId: x.lin, summary: '乙寫的摘要' });
  await sync(x.a, { branch: 'main', requirePrivate: false }); await sync(x.b, { branch: 'main', requirePrivate: false }); await sync(x.a, { branch: 'main', requirePrivate: false });
  const y = await setup();
  y.a.upsertEntity(SP, { entityId: y.lin, summary: '甲寫的摘要' });
  y.b.upsertEntity(SP, { entityId: y.lin, summary: '乙寫的摘要' });
  await sync(y.b, { branch: 'main', requirePrivate: false }); await sync(y.a, { branch: 'main', requirePrivate: false }); await sync(y.b, { branch: 'main', requirePrivate: false });
  assert.equal(S(snap(y.a)), S(snap(y.b)));
  const pick = (s) => s.db.prepare('SELECT summary FROM entities WHERE name=?').get('林小雨').summary;
  assert.equal(pick(x.a), '乙寫的摘要');
  assert.equal(pick(y.a), '乙寫的摘要');
});

test('兩邊把林小雨併到不同人，同步後是兩筆 pending', async () => {
  const { a, b, lin, white, black } = await setup();
  a.mergeEntities(SP, lin, white, '甲');
  b.mergeEntities(SP, lin, black, '乙');
  await sync(a, { branch: 'main', requirePrivate: false }); await sync(b, { branch: 'main', requirePrivate: false }); await sync(a, { branch: 'main', requirePrivate: false });
  for (const s of [a, b]) {
    const m = s.db.prepare(`SELECT status FROM merges WHERE from_id=?`).all(lin);
    assert.deepEqual(m.map((r) => r.status), ['pending', 'pending']);
  }
  assert.equal(S(snap(a)), S(snap(b)));
});

test('兩邊把同一個 handle 加給不同人，兩筆 conflict=1 且不丟錯', async () => {
  const { a, b, lin, white } = await setup();
  a.addAlias(SP, lin, '雨姑娘', { platform: 'larch', isHandle: true });
  b.addAlias(SP, white, '雨姑娘', { platform: 'larch', isHandle: true });
  await sync(a, { branch: 'main', requirePrivate: false }); await sync(b, { branch: 'main', requirePrivate: false }); await sync(a, { branch: 'main', requirePrivate: false });
  for (const s of [a, b]) {
    const rows = s.db.prepare(`SELECT conflict FROM aliases WHERE alias='雨姑娘'`).all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.conflict === 1));
  }
  assert.equal(S(snap(a)), S(snap(b)));
});

test('rebuild 前後 recall 相同', async () => {
  const { a, b, lin, white } = await setup();
  a.remember(SP, { subjectId: lin, predicate: '師父', objectEntity: white, validFrom: '一', audience: 'public', author: 'a' });
  b.upsertEntity(SP, { entityId: lin, summary: '乙寫的摘要' });
  await sync(a, { branch: 'main', requirePrivate: false }); await sync(b, { branch: 'main', requirePrivate: false }); await sync(a, { branch: 'main', requirePrivate: false });
  const opts = { names: ['林小雨'], audiences: ['public'] };
  const before = a.recall(SP, opts);
  rebuild(a);
  assert.equal(S(a.recall(SP, opts)), S(before));
  assert.ok(before.facts.length >= 1);
});

test('requirePrivate 且 checkPrivate 回 false：丟錯、不推送', async () => {
  const { a, bare, lin } = await setup();
  const count = () => git(bare, 'rev-list', '--count', 'main').trim();
  const n = count();
  a.upsertEntity(SP, { entityId: lin, summary: '不該被推出去' });
  await assert.rejects(sync(a, { branch: 'main', requirePrivate: true, checkPrivate: () => false }),
    /拒絕推送/);
  assert.equal(count(), n);
  // 回 true 就推
  const r = await sync(a, { branch: 'main', requirePrivate: true, checkPrivate: () => true });
  assert.equal(r.pushed, true);
  assert.notEqual(count(), n);
});

test('requirePrivate 預設檢查：非 GitHub 遠端拒絕', async () => {
  const { a } = await setup();
  await assert.rejects(sync(a, { branch: 'main', requirePrivate: true }), /無法確認遠端是不是 private，拒絕推送/);
});

test('第一次同步：遠端分支還不存在也不報錯', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const bare = path.join(root, 'r.git');
  git(root, 'init', '--bare', '-q', bare);
  const a = openStore({ dbPath: path.join(root, 'a.db'), opsDir: path.join(root, 'ops') });
  git(a.oplog.dir, 'remote', 'add', 'origin', bare);
  a.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter' });
  const r = await sync(a, { branch: 'main', requirePrivate: false });
  assert.deepEqual(r, { pulled: 0, pushed: true, rebuilt: false });
});

test('async checkPrivate 回 false：丟錯、遠端 commit 數不變', async () => {
  const { a, bare, lin } = await setup();
  const n = git(bare, 'rev-list', '--count', 'main').trim();
  a.upsertEntity(SP, { entityId: lin, summary: '不該被推出去' });
  await assert.rejects(sync(a, { branch: 'main', requirePrivate: true, checkPrivate: async () => false }), /拒絕推送/);
  assert.equal(git(bare, 'rev-list', '--count', 'main').trim(), n);
});

test('網址主機名要錨定：gitlab.com/github.com/x/y 不算 GitHub', () => {
  assert.throws(() => defaultCheckPrivate('https://gitlab.com/github.com/x/y'), /無法確認遠端是不是 private/);
  assert.throws(() => defaultCheckPrivate('https://evil.com/?github.com/x/y'), /無法確認遠端是不是 private/);
});

test('合併進行中拒絕同步', async () => {
  const { a } = await setup();
  fs.writeFileSync(path.join(a.oplog.dir, '.git', 'MERGE_HEAD'), git(a.oplog.dir, 'rev-parse', 'HEAD'));
  await assert.rejects(sync(a, { branch: 'main', requirePrivate: false }), /合併還沒完成/);
});

test('pull 失敗：丟錯且不推送', async () => {
  const { root, a, bare, lin } = await setup();
  const n = git(bare, 'rev-list', '--count', 'main').trim();
  a.upsertEntity(SP, { entityId: lin, summary: 'x' });
  git(a.oplog.dir, 'remote', 'set-url', 'origin', path.join(root, 'gone.git'));
  await assert.rejects(sync(a, { branch: 'main', requirePrivate: false }), /git pull 失敗/);
  assert.equal(git(bare, 'rev-list', '--count', 'main').trim(), n);
});

test('同步觸發重建時回傳 rebuilt: true', async () => {
  const { a, b, lin } = await setup();
  a.upsertEntity(SP, { entityId: lin, summary: '甲' });
  b.upsertEntity(SP, { entityId: lin, summary: '乙' });
  await sync(a, { branch: 'main', requirePrivate: false });
  const r = await sync(b, { branch: 'main', requirePrivate: false });
  const r2 = await sync(a, { branch: 'main', requirePrivate: false });
  assert.ok(r.rebuilt || r2.rebuilt);
});

test('時鐘偏快的裝置同步後，另一台的下一筆寫入要排在所有遠端操作之後', async () => {
  const { a, b, lin } = await setup();
  const real = Date.now;
  Date.now = () => real() + 3600_000;
  try { b.upsertEntity(SP, { entityId: lin, summary: '乙（快一小時）' }); } finally { Date.now = real; }
  await sync(b, { branch: 'main', requirePrivate: false });
  await sync(a, { branch: 'main', requirePrivate: false });
  a.upsertEntity(SP, { entityId: lin, summary: '甲（較晚寫）' });
  assert.equal(a.db.prepare('SELECT summary FROM entities WHERE id=?').get(lin).summary, '甲（較晚寫）');
  await sync(a, { branch: 'main', requirePrivate: false }); await sync(b, { branch: 'main', requirePrivate: false });
  assert.equal(b.db.prepare('SELECT summary FROM entities WHERE id=?').get(lin).summary, '甲（較晚寫）');
});

test('預設就要求 private：沒指定時非 GitHub 遠端拒絕推送', async () => {
  const { a, bare, lin } = await setup();
  const count = () => git(bare, 'rev-list', '--count', 'main').trim();
  const n = count();
  a.upsertEntity(SP, { entityId: lin, summary: '不該被推出去' });
  await assert.rejects(sync(a, { branch: 'main' }), /無法確認遠端是不是 private，拒絕推送/);
  assert.equal(count(), n);
});

test('fetch 階段不持鎖：onFetched 回呼裡另一個 Store 可寫入', async () => {
  const { a, b, root } = await setup();
  const b2 = openStore({ dbPath: path.join(root, 'b2.db'), opsDir: b.oplog.dir });
  let wrote = false;
  await sync(b, { branch: 'main', requirePrivate: false, onFetched: () => {
    b2.upsertEntity(SP, { type: 'person', name: '城主' }); // 若鎖被持有會等不到鎖而丟錯
    wrote = true;
  } });
  assert.equal(wrote, true);
});

test('遠端追蹤分支已存在但與遠端沒有共同歷史（上次第一次同步失敗）：仍能合併', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const bare = path.join(root, 'r.git');
  git(root, 'init', '--bare', '-q', bare);
  // 乙先推上一段自己的歷史（初始化 commit 換個時間，不跟甲的撞成同一個 commit）
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = '2020-01-01T00:00:00Z';
  let b;
  try { b = openStore({ dbPath: path.join(root, 'b.db'), opsDir: path.join(root, 'b-ops') }); } finally {
    delete process.env.GIT_AUTHOR_DATE; delete process.env.GIT_COMMITTER_DATE;
  }
  git(b.oplog.dir, 'remote', 'add', 'origin', bare);
  b.createSpace({ id: SP, name: '示範', kind: 'story', timeAxis: 'chapter' });
  b.upsertEntity(SP, { type: 'person', name: '城主' });
  await sync(b, { branch: 'main', requirePrivate: false });
  // 甲是另一份獨立歷史；遠端追蹤分支殘留（指向甲自己的 commit），看起來像「已同步過」
  const a = openStore({ dbPath: path.join(root, 'a.db'), opsDir: path.join(root, 'a-ops') });
  git(a.oplog.dir, 'remote', 'add', 'origin', bare);
  a.upsertEntity(SP, { type: 'person', name: '林小雨' });
  git(a.oplog.dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // 前提：甲與遠端確實沒有共同歷史
  const remoteHead = git(bare, 'rev-parse', 'main').trim();
  git(a.oplog.dir, 'fetch', '-q', bare, 'main:refs/check/remote');
  assert.throws(() => git(a.oplog.dir, 'merge-base', 'HEAD', remoteHead));
  git(a.oplog.dir, 'update-ref', '-d', 'refs/check/remote');
  await sync(a, { branch: 'main', requirePrivate: false });
  const names = a.db.prepare('SELECT name FROM entities ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(names.sort(), ['城主', '林小雨'].sort());
});
