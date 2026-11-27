import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openStore } from '../../core/store.mjs';

const BIN = path.resolve('bin/mycelium.mjs');
const env = (root) => ({ ...process.env, MYCELIUM_DB: path.join(root, 'c.db'), MYCELIUM_OPS: path.join(root, 'ops'),
  GIT_AUTHOR_NAME: '測試', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: '測試', GIT_COMMITTER_EMAIL: 't@example.com' });
const run = (root, ...args) => spawnSync(process.execPath, [BIN, ...args], { env: env(root), encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));

test('init 後 export 行數等於操作數，且依 hlc 排序', () => {
  const root = tmp();
  const r = run(root, 'init', '--space', 'demo', '--name', '示範', '--kind', 'story', '--axis', 'chapter');
  assert.equal(r.status, 0, r.stderr);
  const store = openStore({ dbPath: path.join(root, 'c.db'), opsDir: path.join(root, 'ops') });
  store.upsertEntity('demo', { type: 'person', name: '林小雨' });
  store.upsertEntity('demo', { type: 'person', name: '黑袍人' });
  store.close();
  const e = run(root, 'export', '--space', 'demo');
  assert.equal(e.status, 0, e.stderr);
  const ops = e.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(ops.length, 3);
  assert.deepEqual(ops.map((o) => o.hlc), ops.map((o) => o.hlc).sort());
  assert.equal(ops[0].type, 'create_space');
});

test('rebuild 成功；--db / --ops 選項可用', () => {
  const root = tmp();
  const db = path.join(root, 'x.db'); const ops = path.join(root, 'xo');
  const r = spawnSync(process.execPath, [BIN, 'init', '--space', 's', '--name', 'S', '--kind', 'social', '--axis', 'date', '--db', db, '--ops', ops],
    { env: env(root), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(db));
  assert.equal(run(root, 'rebuild').status, 0);
});

test('sync 沒有 remote 回非 0 與中文錯誤', () => {
  const root = tmp();
  run(root, 'init', '--space', 'demo', '--name', '示範', '--kind', 'story', '--axis', 'chapter');
  const s = run(root, 'sync');
  assert.notEqual(s.status, 0);
  assert.match(s.stderr, /同步失敗/);
  const s2 = run(root, 'sync', '--require-private');
  assert.notEqual(s2.status, 0);
});

test('未知指令印用法並以 1 結束', () => {
  const r = run(tmp(), 'foo');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /用法/);
});

test('export 遇到 null 行不丟錯，只輸出有效操作', () => {
  const root = tmp();
  assert.equal(run(root, 'init', '--space', 'demo', '--name', '示範', '--kind', 'story', '--axis', 'chapter').status, 0);
  const ops = path.join(root, 'ops');
  const f = fs.readdirSync(ops).find((n) => n.endsWith('.jsonl'));
  fs.appendFileSync(path.join(ops, f), 'null\n');
  const e = run(root, 'export', '--space', 'demo');
  assert.equal(e.status, 0, e.stderr);
  assert.equal(e.stdout.split('\n').filter(Boolean).length, 1);
});
