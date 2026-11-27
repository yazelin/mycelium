#!/usr/bin/env node
// 菌絲體命令列：init、mcp、export、sync、rebuild。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { openStore, isValidOp } from '../core/store.mjs';
import { sync, rebuild } from '../core/sync.mjs';
import { compareOps } from '../core/apply.mjs';
import { runMcp } from '../core/mcp.mjs';

const USAGE = `用法：mycelium <指令> [選項]
指令：
  init --space <id> --name <名> --kind social|story --axis date|chapter   建立空間
  mcp                                                                     啟動 MCP server（stdio）
  export --space <id>                                                     把該空間的操作以 JSONL 印出
  sync                                                                    與 git 遠端同步
  rebuild                                                                 從操作紀錄重建資料庫
共用選項：--db <路徑>（預設 ~/.mycelium/mycelium.db）、--ops <目錄>（預設 ~/.mycelium/ops）、--allow-public（sync 預設只推 private repo；要推公開 repo 才加）`;

function usageExit() {
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['init', 'mcp', 'export', 'sync', 'rebuild'].includes(cmd)) usageExit();
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: {
      db: { type: 'string' }, ops: { type: 'string' }, 'require-private': { type: 'boolean' }, 'allow-public': { type: 'boolean' },
      space: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, axis: { type: 'string' },
    } }));
  } catch (e) {
    process.stderr.write(`參數錯誤：${e.message}\n`);
    usageExit();
  }
  const home = path.join(os.homedir(), '.mycelium');
  const dbPath = values.db ?? process.env.MYCELIUM_DB ?? path.join(home, 'mycelium.db');
  const opsDir = values.ops ?? process.env.MYCELIUM_OPS ?? path.join(home, 'ops');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const need = (k, label) => { if (!values[k]) { process.stderr.write(`缺少 ${label}\n`); process.exit(1); } return values[k]; };

  const store = openStore({ dbPath, opsDir });
  try {
    if (cmd === 'init') {
      const id = need('space', '--space');
      const name = need('name', '--name');
      const kind = need('kind', '--kind');
      const axis = need('axis', '--axis');
      if (!['social', 'story'].includes(kind)) { process.stderr.write('--kind 只能是 social 或 story\n'); process.exit(1); }
      if (!['date', 'chapter'].includes(axis)) { process.stderr.write('--axis 只能是 date 或 chapter\n'); process.exit(1); }
      if (store.listSpaces().some((s) => s.id === id)) { process.stderr.write(`空間已存在：${id}\n`); process.exit(1); }
      store.createSpace({ id, name, kind, timeAxis: axis });
      process.stdout.write(`已建立空間：${id}\n`);
    } else if (cmd === 'export') {
      const id = need('space', '--space');
      const ops = store.oplog.readAll().filter((o) => isValidOp(o) && o.space === id).sort(compareOps);
      process.stdout.write(ops.map((o) => JSON.stringify(o) + '\n').join(''));
    } else if (cmd === 'rebuild') {
      rebuild(store);
      process.stdout.write('已重建資料庫\n');
    } else if (cmd === 'sync') {
      try {
        const r = await sync(store, { requirePrivate: !values['allow-public'] });
        process.stdout.write(`同步完成：拉回 ${r.pulled} 筆，已推送\n`);
      } catch (e) {
        process.stderr.write(`同步失敗：${String(e.message).trim()}\n`);
        process.exitCode = 1;
      }
    } else if (cmd === 'mcp') {
      await runMcp(store);
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  process.stderr.write(`錯誤：${e.message}\n`);
  process.exit(1);
});
