import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { openStore } from '../../core/store.mjs';
import { runMcp } from '../../core/mcp.mjs';

process.env.GIT_AUTHOR_NAME = '測試';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = '測試';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

// 開一個 store 與 MCP 連線，送出若干行，等輸入結束後收回所有回應
async function session(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const store = openStore({ dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops') });
  store.createSpace({ id: 'demo', name: '示範', kind: 'story', timeAxis: 'chapter', chapters: ['一', '二'] });
  const input = new PassThrough();
  const output = new PassThrough();
  let buf = '';
  output.on('data', (d) => { buf += d; });
  const done = runMcp(store, { input, output });
  for (const l of lines) input.write((typeof l === 'string' ? l : JSON.stringify(l)) + '\n');
  input.end();
  await done;
  return { store, out: buf.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('initialize、tools/list、通知不回應', async () => {
  const { out } = await session([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'nope' },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(out[0].result.capabilities, { tools: {} });
  assert.equal(out[0].result.serverInfo.name, 'mycelium');
  const names = out[1].result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_alias', 'get_entity', 'invalidate', 'list_spaces', 'log_episode', 'merge_entities',
    'neighbors', 'recall', 'remember', 'search', 'timeline', 'unmerge', 'upsert_entity']);
  const d = (n) => out[1].result.tools.find((t) => t.name === n).description;
  assert.match(d('recall'), /audiences 必填/);
  assert.match(d('upsert_entity'), /系統不會自動合併/);
  assert.match(d('remember'), /系統不會自動合併/);
  assert.match(d('merge_entities'), /person:<對象>/);
  assert.match(d('add_alias'), /audience 設成 person:<對象>/);
  assert.equal(out[2].error.code, -32601);
});

test('upsert_entity 後 recall；不帶 audiences 回 isError 且 server 繼續', async () => {
  const { out } = await session([
    call(1, 'upsert_entity', { space: 'demo', type: 'person', name: '林小雨', summary: '採藥少女' }),
    call(2, 'recall', { space: 'demo', names: ['林小雨'] }),
    call(3, 'recall', { space: 'demo', names: ['林小雨'], audiences: ['public'] }),
    call(4, 'list_spaces', {}),
    call(5, 'no_such_tool', {}),
  ]);
  const r1 = JSON.parse(out[0].result.content[0].text);
  assert.equal(r1.created, true);
  assert.equal(out[1].result.isError, true);
  assert.match(out[1].result.content[0].text, /audiences/);
  assert.equal(out[2].result.isError, undefined);
  assert.match(out[2].result.content[0].text, /林小雨/);
  assert.equal(JSON.parse(out[3].result.content[0].text)[0].id, 'demo');
  assert.equal(out[4].result.isError, true);
});

test('剖析錯誤回 -32700，之後仍可用', async () => {
  const { out } = await session(['{壞掉', { jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assert.equal(out[0].error.code, -32700);
  assert.equal(out[0].id, null);
  assert.equal(out[1].result.tools.length, 13);
});

test('remember 與 log_episode 寫入並回傳同類事實', async () => {
  const { out, store } = await session([
    call(1, 'upsert_entity', { space: 'demo', type: 'person', name: '白衣客' }),
  ]);
  const id = JSON.parse(out[0].result.content[0].text).entityId;
  const input = new PassThrough(); const output = new PassThrough(); let buf = '';
  output.on('data', (d) => { buf += d; });
  const p = runMcp(store, { input, output });
  const fact = { space: 'demo', subjectId: id, predicate: 'wields', objectText: '落雨劍', validFrom: '一', audience: 'public', author: 'test' };
  input.write(JSON.stringify(call(1, 'remember', fact)) + '\n');
  input.write(JSON.stringify(call(2, 'remember', { ...fact, objectText: '木劍' })) + '\n');
  input.write(JSON.stringify(call(3, 'log_episode', { space: 'demo', at: '一', source: 'chat', audience: 'public', body: '白衣客登場' })) + '\n');
  input.end(); await p;
  const r = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(JSON.parse(r[1].result.content[0].text).sameKindActive.length, 1);
  assert.equal(r[2].result.isError, undefined);
});

// ---- 接入前：MCP 層的負控制 ----
test('upsert_entity 缺 type 回 isError，主本沒有新行', async () => {
  const { out, store } = await session([call(1, 'upsert_entity', { space: 'demo', name: '城主' })]);
  assert.equal(out[0].result.isError, true);
  assert.match(out[0].result.content[0].text, /type/);
  assert.equal(store.oplog.readAll().filter((o) => o.type === 'create_entity').length, 0);
});

test('remember 的 sameKindActive 不帶出私下事實；upsert_entity 不比對隱藏別名', async () => {
  const { out, store } = await session([
    call(1, 'upsert_entity', { space: 'demo', type: 'person', name: '林小雨' }),
    call(2, 'upsert_entity', { space: 'demo', type: 'person', name: '城主' }),
  ]);
  const lin = JSON.parse(out[0].result.content[0].text).entityId;
  const lord = JSON.parse(out[1].result.content[0].text).entityId;
  const input = new PassThrough(); const output = new PassThrough(); let buf = '';
  output.on('data', (d) => { buf += d; });
  const p = runMcp(store, { input, output });
  const base = { space: 'demo', subjectId: lin, predicate: '住在', validFrom: '一', author: 'test' };
  const lines = [
    call(1, 'remember', { ...base, objectText: '城主私下說的秘密地址', audience: `person:${lord}` }),
    call(2, 'remember', { ...base, objectText: '山腳', audience: 'public' }),
    call(3, 'add_alias', { space: 'demo', entityId: lin, alias: '小愛秘名', audience: `person:${lord}` }),
    call(4, 'upsert_entity', { space: 'demo', type: 'person', name: '小愛秘名' }),
    call(5, 'upsert_entity', { space: 'demo', type: 'person', name: '小愛秘名', audiences: ['public', `person:${lord}`] }),
  ];
  for (const l of lines) input.write(JSON.stringify(l) + '\n');
  input.end(); await p;
  const r = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(!r[1].result.content[0].text.includes('秘密地址'));
  assert.equal(JSON.parse(r[1].result.content[0].text).sameKindActive.length, 0);
  assert.ok(!r[3].result.content[0].text.includes(lin));
  assert.ok(JSON.parse(r[4].result.content[0].text).candidates.some((c) => c.entityId === lin));
});

test('tools/list 的 inputSchema 頂層沒有 anyOf／oneOf／allOf', async () => {
  const { out } = await session([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  for (const t of out[0].result.tools) {
    for (const k of ['anyOf', 'oneOf', 'allOf']) assert.equal(t.inputSchema[k], undefined, `${t.name} 有 ${k}`);
  }
  const up = out[0].result.tools.find((t) => t.name === 'upsert_entity');
  assert.match(up.description, /type、name 必填/);
});
