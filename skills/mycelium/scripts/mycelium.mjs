#!/usr/bin/env node
'use strict';
// mycelium skill CLI —— 讓終端機裡的 agent（或人）讀作品設定、產抽取提示詞、
// 寫提案、必要時直接寫入（一定先快照）。
//
// 這支腳本不需要 agent 在旁邊也能跑：每個子指令都是自己讀輸入、印人看得懂的
// 輸出。LLM 負責的是「判斷」（一致性、別名、發想），機械的部分全在這裡。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatContext } from '../../../ai-context.js';
import { EXTRACT_SYSTEM, buildExtractUserMessage, formatKnownEntities } from '../../../extract-prompt.js';
import { applyCandidates, assertValidProjectData, buildProposal, validateCandidates } from './candidates.mjs';
import {
  CONFIG_PATH, cacheDir, ghGetRaw, ghPutFile, pullData, readCachedData,
  readConfig, resolveRepo, timestamp, writeData, writeSnapshot,
} from './repo.mjs';

const USAGE = `mycelium skill —— 小說設定的終端機介面

用法：node mycelium.mjs <指令> [選項]

作品選擇（所有指令通用）：
  --repo <owner/name>   直接指定作品 repo
  --work <作品名>        用 ~/.config/mycelium/works.json 裡的名字
  （也吃環境變數 MYCELIUM_REPO；都沒有就用設定檔的 default）

讀（不會寫任何東西）：
  works                       列出設定檔裡的作品
  pull                        從 repo 抓 data/*.json 到本機快取，印各 store 筆數
  context                     印出跟網頁 AI 一模一樣的設定 context 區塊
  entity <名字>                單一角色的完整設定（含別名、關係、相關伏筆）
  foreshadow [--open]         伏筆清單；--open 只列未回收（含逾期標記）
  chapters                    卷/章清單與狀態
  known                       既有角色名單（抽取提示詞用的那一份）
  proposals                   列出 repo 裡現有的提案檔

抽章節（LLM 由你自己的 agent 跑）：
  extract-prompt --text <章節檔>       印出 system + user 兩段提示詞
  extract-prompt --text <章節檔> --json 以 JSON 印出（好餵給 API）

寫（預設只寫提案）：
  validate <候選檔.json>                驗證候選格式，不寫任何東西
  propose <候選檔.json> [--source ...] [--note ...] [--dry-run]
                                       寫成 repo 的 proposals/<timestamp>.json
  snapshot                             把現在的 data/*.json 存一份快照
  apply <候選檔.json> [--chapters <章節檔.json>] --yes
                                       直接改 data/*.json（使用者明講才可以用；
                                       一定會先自動快照）

候選檔格式跟 app 的 AI 抽取結果完全相同：
  {"entities":[{"name":"黑袍人","aliasOf":"城主","type":null,"notes":"","reason":"本章揭露城主就是黑袍人"}],
   "relations":[{"source":"林小雨","target":"城主","type":"追殺","reason":"城主軍全境追殺林小雨"}],
   "foreshadow":[{"title":"林小雨的真實身份","notes":"","reason":"城主的台詞埋了伏筆"}]}
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else { opts[key] = next; i++; }
    } else opts._.push(a);
  }
  return opts;
}

function die(msg) {
  console.error('錯誤：' + msg);
  process.exit(1);
}

function loadData(opts) {
  const repo = resolveRepo(opts);
  if (opts.cached) {
    const cached = readCachedData(repo);
    if (!cached) die(`本機還沒有 ${repo.slug} 的快取，先跑一次 pull。`);
    return { repo, data: cached };
  }
  const { data } = pullData(repo);
  return { repo, data };
}

function readJsonFile(path) {
  if (!existsSync(path)) die(`找不到檔案：${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`${path} 不是合法 JSON：${e.message}`);
  }
}

function isOverdue(item, chapterById) {
  // 跟 foreshadow.js 同一條判斷：還在埋設中、有指定回收章、而那章已經完稿。
  if (item.status !== '埋設中' || !item.recoverChapterId) return false;
  const ch = chapterById[item.recoverChapterId];
  return !!ch && ch.status === '完稿';
}

const commands = {
  works() {
    const cfg = readConfig();
    const names = Object.keys(cfg.works);
    if (!names.length) {
      console.log(`設定檔 ${CONFIG_PATH} 還沒有任何作品。範例內容：`);
      console.log(JSON.stringify({ default: '落雨', works: { 落雨: 'yourname/your-novel-repo' } }, null, 2));
      return;
    }
    for (const n of names) console.log(`${n === cfg.default ? '*' : ' '} ${n}\t${cfg.works[n]}`);
  },

  pull(opts) {
    const repo = resolveRepo(opts);
    const { data, missing, cachedAt } = pullData(repo);
    console.log(`作品 repo：${repo.slug}`);
    for (const [store, arr] of Object.entries(data)) console.log(`  ${store}\t${arr.length} 筆`);
    if (missing.length) console.log(`（repo 裡還沒有：${missing.map((m) => `data/${m}.json`).join('、')}）`);
    console.log(`本機快取：${cachedAt}`);
  },

  context(opts) {
    const { data } = loadData(opts);
    console.log(formatContext(data));
  },

  known(opts) {
    const { data } = loadData(opts);
    console.log(formatKnownEntities(data.entities) || '（尚無）');
  },

  entity(opts) {
    const name = opts._[0];
    if (!name) die('要給角色名字，例如：entity 林小雨');
    const { data } = loadData(opts);
    const hit = data.entities.find((e) => e.name === name || (e.aliases || []).includes(name));
    if (!hit) {
      const near = data.entities.filter((e) => e.name.includes(name)).map((e) => e.name);
      die(`設定庫裡沒有「${name}」。${near.length ? '相近的有：' + near.join('、') : ''}`);
    }
    const byId = Object.fromEntries(data.entities.map((e) => [e.id, e]));
    console.log(`${hit.name}［${hit.type || '未分類'}］`);
    if (hit.aliases && hit.aliases.length) console.log(`別名：${hit.aliases.join('、')}`);
    if (hit.tags && hit.tags.length) console.log(`標籤：${hit.tags.join('、')}`);
    console.log(`設定：${hit.notes || '（空）'}`);
    const rels = data.relations.filter((r) => r.sourceId === hit.id || r.targetId === hit.id);
    console.log(`關係（${rels.length}）：`);
    for (const r of rels) {
      const s = (byId[r.sourceId] || {}).name || '?';
      const t = (byId[r.targetId] || {}).name || '?';
      console.log(`  - ${s} —${r.type}→ ${t}${r.notes ? `：${r.notes}` : ''}`);
    }
    const fs = data.foreshadow.filter((f) => (f.relatedEntityIds || []).includes(hit.id));
    if (fs.length) {
      console.log(`相關伏筆（${fs.length}）：`);
      for (const f of fs) console.log(`  - ${f.title}［${f.status}］`);
    }
    const mentions = data.chapters.filter((c) => {
      const hay = `${c.title || ''}\n${c.summary || ''}\n${c.content || ''}`;
      return [hit.name, ...(hit.aliases || [])].some((n) => hay.includes(n));
    });
    if (mentions.length) {
      console.log(`出現章節（${mentions.length}）：`);
      for (const c of mentions) console.log(`  - 第${c.volume}卷・${c.title}［${c.status}］`);
    }
  },

  foreshadow(opts) {
    const { data } = loadData(opts);
    const chapterById = Object.fromEntries(data.chapters.map((c) => [c.id, c]));
    const items = opts.open ? data.foreshadow.filter((f) => f.status === '埋設中') : data.foreshadow;
    if (!items.length) { console.log(opts.open ? '沒有未回收的伏筆。' : '還沒有任何伏筆。'); return; }
    for (const f of items) {
      const plant = chapterById[f.plantChapterId];
      const recover = chapterById[f.recoverChapterId];
      const flags = isOverdue(f, chapterById) ? ' ⚠ 逾期未回收' : '';
      console.log(`- ${f.title}［${f.status}］${flags}`);
      if (plant) console.log(`    埋設：第${plant.volume}卷・${plant.title}`);
      if (recover) console.log(`    預計回收：第${recover.volume}卷・${recover.title}［${recover.status}］`);
      if (f.notes) console.log(`    ${f.notes}`);
    }
  },

  chapters(opts) {
    const { data } = loadData(opts);
    const sorted = data.chapters.slice().sort((a, b) => (a.volume - b.volume) || (a.order - b.order));
    if (!sorted.length) { console.log('還沒有任何章節。'); return; }
    let total = 0;
    for (const c of sorted) {
      total += Number(c.wordCount) || 0;
      console.log(`- 第${c.volume}卷・${c.title}［${c.status}］${c.wordCount ? ` ${c.wordCount} 字` : ''}${c.summary ? `：${c.summary}` : ''}`);
    }
    console.log(`共 ${sorted.length} 章、${total} 字。`);
  },

  proposals(opts) {
    const repo = resolveRepo(opts);
    const raw = ghGetRaw(repo, 'proposals');
    if (raw === null) { console.log('這個 repo 還沒有 proposals/。'); return; }
    const list = JSON.parse(raw);
    if (!list.length) { console.log('proposals/ 是空的。'); return; }
    for (const f of list) console.log(`- ${f.path}`);
  },

  'extract-prompt'(opts) {
    const path = opts.text || opts._[0];
    if (!path) die('要給章節檔：extract-prompt --text 第12章.txt');
    if (!existsSync(path)) die(`找不到檔案：${path}`);
    const chapter = readFileSync(path, 'utf8');
    const { data } = loadData(opts);
    const user = buildExtractUserMessage(data.entities, chapter);
    if (opts.json) {
      console.log(JSON.stringify([
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: user },
      ], null, 2));
      return;
    }
    console.log('===== system =====');
    console.log(EXTRACT_SYSTEM);
    console.log('===== user =====');
    console.log(user);
  },

  validate(opts) {
    const path = opts._[0];
    if (!path) die('要給候選檔：validate candidates.json');
    const raw = readJsonFile(path);
    let c;
    try { c = validateCandidates(raw); } catch (e) { die(e.message); }
    console.log(`候選格式正確：角色 ${c.entities.length}、關係 ${c.relations.length}、伏筆 ${c.foreshadow.length}。`);
    const aliases = c.entities.filter((e) => e.aliasOf);
    if (aliases.length) {
      console.log('別名合併判斷：');
      for (const a of aliases) console.log(`  - ${a.name} → 併入「${a.aliasOf}」：${a.reason}`);
    }
  },

  propose(opts) {
    const path = opts._[0];
    if (!path) die('要給候選檔：propose candidates.json');
    const raw = readJsonFile(path);
    let proposal;
    try { proposal = buildProposal(raw, { source: opts.source, note: opts.note }); } catch (e) { die(e.message); }
    const ts = timestamp();
    const body = JSON.stringify(proposal, null, 2) + '\n';
    const repo = resolveRepo(opts);
    if (opts['dry-run']) {
      const dir = join(cacheDir(repo), 'proposals');
      mkdirSync(dir, { recursive: true });
      const local = join(dir, `${ts}.json`);
      writeFileSync(local, body, 'utf8');
      console.log(`（dry-run，沒有推上 GitHub）提案寫在本機：${local}`);
      return;
    }
    ghPutFile(repo, `proposals/${ts}.json`, body, `proposal ${ts}`);
    console.log(`已寫入提案：${repo.slug} 的 proposals/${ts}.json`);
    console.log(`內容：角色 ${proposal.entities.length}、關係 ${proposal.relations.length}、伏筆 ${proposal.foreshadow.length}。`);
    console.log('data/*.json 完全沒有動。請到網頁的提案畫面逐項確認後才會寫進設定庫。');
  },

  snapshot(opts) {
    const repo = resolveRepo(opts);
    const { data } = pullData(repo);
    const snap = writeSnapshot(repo, data);
    console.log(`快照完成：${repo.slug} 的 ${snap.remoteDir}`);
    console.log(`本機另存一份：${snap.localDir}`);
  },

  apply(opts) {
    const path = opts._[0];
    if (!path) die('要給候選檔：apply candidates.json --yes');
    if (!opts.yes) {
      die('apply 會直接改 data/*.json。只有使用者明講「直接寫」時才可以用，並要加 --yes。' +
        '\n     預設請改用 propose——提案由使用者在網頁上逐項確認。');
    }
    const raw = readJsonFile(path);
    const chapters = opts.chapters ? readJsonFile(opts.chapters) : [];
    if (!Array.isArray(chapters)) die('--chapters 的檔案要是章節物件的陣列。');
    const repo = resolveRepo(opts);
    const { data } = pullData(repo);

    // 快照永遠先做，而且做在任何寫入之前——瀏覽器那份 IndexedDB 才是主本，
    // 一旦這裡蓋錯，使用者之後「從 GitHub 匯入」就會把自己的稿子洗掉。
    const snap = writeSnapshot(repo, data);
    console.log(`已先快照：${repo.slug} 的 ${snap.remoteDir}（本機：${snap.localDir}）`);

    let result;
    try { result = applyCandidates(data, raw, { chapters }); } catch (e) { die(e.message); }
    assertValidProjectData(result.data);
    writeData(repo, result.data, `agent apply ${snap.ts}`);
    for (const line of result.log) console.log('  ' + line);
    console.log(`已直接寫入 ${repo.slug} 的 data/*.json。`);
    console.log('提醒使用者：如果瀏覽器裡還有沒同步的修改，請先在網頁做一次「同步到 GitHub」再匯入，否則會互蓋。');
    console.log(`要還原就把 ${snap.remoteDir} 底下的檔案覆蓋回 data/。`);
  },
};

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(USAGE); return; }
  const fn = commands[cmd];
  if (!fn) die(`沒有這個指令：${cmd}\n${USAGE}`);
  const opts = parseArgs(argv.slice(1));
  try {
    fn(opts);
  } catch (e) {
    die(e.message);
  }
}

main();
