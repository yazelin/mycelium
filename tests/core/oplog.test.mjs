import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn as spawnFn } from 'node:child_process';
import { OpLog, loadDevice } from '../../core/oplog.mjs';

process.env.GIT_AUTHOR_NAME = '測試';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = '測試';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oplog-'));
const mk = (dir) => new OpLog({ dir, device: 'DEV1', deviceName: 'pc' });
const op = (id, type = 'note') => ({ id, dev: 'DEV1', hlc: `0-0-${id}`, type, space: 's', data: { v: id } });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });

test('append 三筆：readAll 回三筆、git 有初始化加三個 commit', () => {
  const dir = tmp();
  const log = mk(dir);
  log.append(op('a')); log.append(op('b')); log.append(op('c'));
  assert.deepEqual(log.readAll().map((o) => o.id), ['a', 'b', 'c']);
  assert.equal(git(dir, 'log', '--oneline').trim().split('\n').length, 4); // 初始化一個＋三筆操作
  assert.deepEqual(log.files(), ['pc-DEV1.jsonl']);
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^op note c/);
});

test('.gitattributes 是 * -text，.gitignore 含 .device.json', () => {
  const dir = tmp();
  mk(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8').trim(), '* -text');
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.device\.json$/m);
});

test('行尾 \\r\\n 讀得出正確 JSON', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'pc-DEV1.jsonl'), JSON.stringify(op('a')) + '\r\n' + JSON.stringify(op('b')) + '\r\n');
  assert.deepEqual(log.readAll().map((o) => o.id), ['a', 'b']);
});

test('最後一行不完整：略過並警告，不丟錯', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'pc-DEV1.jsonl'), JSON.stringify(op('a')) + '\n{"id":"x",');
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    assert.deepEqual(log.readAll().map((o) => o.id), ['a']);
  } finally { console.warn = orig; }
  assert.deepEqual(warns, ['略過不完整的最後一行：pc-DEV1.jsonl']);
});

test('中間行壞掉：略過該行並警告含檔名與行號，回傳其餘各行', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'pc-DEV1.jsonl'), JSON.stringify(op('a')) + '\n{壞\n' + JSON.stringify(op('c')) + '\n');
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    assert.deepEqual(log.readAll().map((o) => o.id), ['a', 'c']);
  } finally { console.warn = orig; }
  assert.deepEqual(warns, ['略過無法解析的操作：pc-DEV1.jsonl 第 2 行']);
});

test('讀取多個裝置的檔、略過空行', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'other-DEV2.jsonl'), '\n' + JSON.stringify(op('z')) + '\n\n');
  log.append(op('a'));
  assert.deepEqual(log.files().sort(), ['other-DEV2.jsonl', 'pc-DEV1.jsonl']);
  assert.deepEqual(log.readAll().map((o) => o.id).sort(), ['a', 'z']);
});

test('autoCommit:false 不提交；已是 git repo 不重複 init', () => {
  const dir = tmp();
  const log = new OpLog({ dir, device: 'DEV1', deviceName: 'pc', autoCommit: false });
  log.append(op('a'));
  assert.throws(() => git(dir, 'rev-parse', 'HEAD'), /./);
  new OpLog({ dir, device: 'DEV1', deviceName: 'pc' }); // 再開一次不應壞
  assert.equal(log.readAll().length, 1);
});

test('loadDevice：建立後穩定，且 .device.json 不進 git', () => {
  const dir = tmp();
  const d1 = loadDevice(dir);
  assert.match(d1.device, /^[0-9A-Z]{8}$/);
  assert.equal(d1.deviceName, os.hostname());
  assert.deepEqual(loadDevice(dir), d1);
  const log = new OpLog({ dir, ...d1 });
  log.append(op('a'));
  assert.ok(!git(dir, 'status', '--porcelain').includes('.device.json'));
  assert.ok(!git(dir, 'ls-files').split('\n').includes('.device.json'));
});

test('append 前截掉當機留下的半行', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'pc-DEV1.jsonl'), JSON.stringify(op('a')) + '\n' + JSON.stringify(op('b')) + '\n{"id":"x",');
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try { log.append(op('c')); } finally { console.warn = orig; }
  assert.deepEqual(warns, ['截掉不完整的最後一行：pc-DEV1.jsonl']);
  assert.deepEqual(log.readAll().map((o) => o.id), ['a', 'b', 'c']);
});

test('autoCommit 時設定檔納入 git', () => {
  const dir = tmp();
  mk(dir);
  const files = git(dir, 'ls-files').split('\n');
  assert.ok(files.includes('.gitattributes') && files.includes('.gitignore'));
  assert.equal(git(dir, 'log', '-1', '--format=%s').trim(), 'init ops 目錄');
});

test('完整但缺換行的最後一筆：補換行不截掉', () => {
  const dir = tmp();
  const log = mk(dir);
  fs.writeFileSync(path.join(dir, 'pc-DEV1.jsonl'), JSON.stringify(op('a')) + '\n' + JSON.stringify(op('b')));
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try { log.append(op('c')); } finally { console.warn = orig; }
  assert.deepEqual(warns, []);
  assert.deepEqual(log.readAll().map((o) => o.id), ['a', 'b', 'c']);
});

// 沒有任何 git 身分的環境：清掉 GIT_*／EMAIL，HOME 指向空目錄，不讀系統設定
function noIdentityEnv() {
  const home = tmp();
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_CONFIG_NOSYSTEM') delete env[k];
  delete env.EMAIL;
  return env;
}

test('沒有 git 身分時也能初始化並 append（改用 mycelium 預設身分）', async () => {
  const dir = tmp();
  const { spawnSync } = await import('node:child_process');
  const url = new URL('../../core/oplog.mjs', import.meta.url).href;
  const code = `const { OpLog } = await import(${JSON.stringify(url)});
    const log = new OpLog({ dir: ${JSON.stringify(dir)}, device: 'DEV1', deviceName: 'pc' });
    log.append({ id: 'a', dev: 'DEV1', hlc: '0-0-a', type: 'note', space: 's', data: {} });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: noIdentityEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^op note a/);
});

// ---- 鎖檔加固 ----
const mkLog = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
  return new OpLog({ dir, device: 'd1', deviceName: 'h' });
};

test('鎖檔內容含 pid、host、token', () => {
  const log = mkLog();
  log.withLock(() => {
    const info = JSON.parse(fs.readFileSync(log.lockPath, 'utf8'));
    assert.equal(info.pid, process.pid);
    assert.equal(info.host, os.hostname());
    assert.ok(info.token);
  });
  assert.equal(fs.existsSync(log.lockPath), false);
});

test('釋放時鎖已換成別人的：不刪並警告', () => {
  const log = mkLog();
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  try {
    log.withLock(() => {
      fs.writeFileSync(log.lockPath, JSON.stringify({ pid: 1, host: 'other', token: 'someone-else' }));
    });
  } finally { console.warn = orig; }
  assert.ok(fs.existsSync(log.lockPath));
  assert.equal(JSON.parse(fs.readFileSync(log.lockPath, 'utf8')).token, 'someone-else');
  assert.ok(warns.length > 0);
});

const deadPid = () => {
  // 取一個已結束的子程序 pid
  const r = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r);
};
const writeStale = (log, pid) => {
  fs.writeFileSync(log.lockPath, JSON.stringify({ pid, host: os.hostname(), token: 'old' }));
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(log.lockPath, old, old);
};

test('殘留鎖（pid 已不存在、mtime 超過 60 秒）可被取得', () => {
  const log = mkLog();
  writeStale(log, deadPid());
  const warns = []; const orig = console.warn; console.warn = (m) => warns.push(m);
  let got = false;
  try { log.withLock(() => { got = true; }); } finally { console.warn = orig; }
  assert.equal(got, true);
  assert.equal(fs.existsSync(log.lockPath), false);
  assert.equal(fs.readdirSync(log.dir).some((f) => f.includes('.lock.stale-')), false);
});

test('mtime 很舊但 pid 還活著：不當殘留鎖', () => {
  const log = mkLog();
  writeStale(log, process.pid);
  const log2 = new OpLog({ dir: log.dir, device: 'd2', deviceName: 'h' });
  log2.lockWaitMs = 300;
  assert.throws(() => log2.withLock(() => {}), /等不到/);
});

test('兩個程序同時搶殘留鎖：恰好一個先拿到，另一個等它放掉後拿到', () => {
  const log = mkLog();
  writeStale(log, deadPid());
  const code = `
    import { OpLog } from ${JSON.stringify(path.resolve('core/oplog.mjs'))};
    const l = new OpLog({ dir: process.argv[1], device: 'p'+process.pid, deviceName: 'h', autoCommit: false });
    l.withLock(() => { const t = Date.now(); while (Date.now() - t < 300); console.log('ok'); });
  `;
  const { spawn } = require_cp();
  const run = () => new Promise((res) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code, log.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('close', (status) => res({ status, out }));
  });
  return Promise.all([run(), run()]).then((rs) => {
    for (const r of rs) { assert.equal(r.status, 0); assert.match(r.out, /ok/); }
    assert.equal(fs.existsSync(log.lockPath), false);
  });
});
function require_cp() { return { spawn: spawnFn }; }
