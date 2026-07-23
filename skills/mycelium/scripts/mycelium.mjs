#!/usr/bin/env node
'use strict';
// mycelium skill CLI —— 讓終端機裡的 agent（或人）讀作品設定、產抽取提示詞、
// 寫提案、必要時直接寫入（一定先快照）。
//
// 這支腳本不需要 agent 在旁邊也能跑：每個子指令都是自己讀輸入、印人看得懂的
// 輸出。LLM 負責的是「判斷」（一致性、別名、發想），機械的部分全在這裡。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatContext } from './context.mjs';
import { buildGraphHtml, buildGraphModel, gitTreeWithRemote } from './graph.mjs';
import { fetchHistory } from './history.mjs';
import { MODES, MODE_LABEL, buildReviewModel } from './review.mjs';
import { buildReviewHtml } from './review-page.mjs';
import { EXTRACT_SYSTEM, buildExtractUserMessage, formatKnownEntities } from './extract-prompt.mjs';
import { VISUAL_FIELDS, isForeshadowOverdue as isOverdue, sortChapters } from './records.mjs';
import { applyCandidates, assertValidProjectData, buildProposal, validateCandidates } from './candidates.mjs';
import {
  RECORD_TYPES, addRecord, describeRecord, diffData, editRecord, isEmptyDiff, planRemoval, removeRecord,
} from './edits.mjs';
import {
  CONFIG_PATH, cacheDir, ghGetRaw, ghPutFile, localSnapshots, pullData, readCachedData,
  readConfig, readSnapshot, remoteSnapshots, resolveRepo, timestamp, writeData, writeSnapshot,
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
  context                     印出整部作品壓成一段的設定 context（討論劇情時先餵這個）
  entity <名字>                單一角色的完整設定（含別名、關係、相關伏筆）
  foreshadow [--open]         伏筆清單；--open 只列未回收（含逾期標記）
  chapters                    卷/章清單與狀態
  known                       既有角色名單（抽取提示詞用的那一份）
  proposals                   列出 repo 裡現有的提案檔
  graph [--out <檔案.html>]    匯出可離線開的人物關係圖 HTML（點兩下就能看）
                              預設寫到本機快取；不准寫進有 remote 的 git 目錄
  review [--mode all|author|製作…] [--volume N] [--out <資料夾>] [--history N]
                              匯出「審閱頁」：全部設定可瀏覽、標出上次以來的新改動、
                              三種模式（作者／製作／公開）。預設三種都產。
                              製作與公開的檔案裡**沒有**底層內容，不是藏起來。

抽章節（LLM 由你自己的 agent 跑）：
  extract-prompt --text <章節檔>       印出 system + user 兩段提示詞
  extract-prompt --text <章節檔> --json 以 JSON 印出（好餵給 API）

改資料（edit / add / rm 預設就直接寫，每次寫入前一定先快照）：
  edit entity <名字|id> [--rename ...] [--type ...] [--notes ...]
                        [--add-alias ...] [--rm-alias ...] [--add-tag ...] [--rm-tag ...]
                        [--field 欄位=值] [--rm-field 欄位]
                        [--visual <版本名> --appearance ... --outfit ... --palette ...
                         --features ... --prompt ... --visual-notes ...] [--rm-visual <版本名>]
                        （視覺設定是給畫師與生圖模型看的規格；一個角色可以有很多版）
  edit chapter <標題|id> [--status 未寫|草稿|完稿] [--title ...] [--summary ...]
                         [--wordcount N] [--volume N] [--order N] [--content-file <檔>]
  edit foreshadow <標題|id> [--status 埋設中|已回收|棄用] [--title ...] [--notes ...]
                            [--plant <章節>] [--recover <章節>] [--plant none]
                            [--link-entity ...] [--unlink-entity ...]
                            [--link-relation <id>] [--unlink-relation <id>]
  edit relation <id|來源>目標> [--type ...] [--notes ...]

  add entity <名字> [--type ...] [--notes ...] [--aliases a,b] [--tags a,b] [--field 欄位=值]
  add chapter --title ... [--volume N] [--status ...] [--wordcount N] [--summary ...] [--content-file <檔>]
  add foreshadow --title ... [--plant <章節>] [--recover <章節>] [--status ...] [--notes ...]
                 [--link-entity ...] [--link-relation <id>]
  add relation --source <角色> --target <角色> --type ... [--notes ...]

  rm entity|chapter|foreshadow|relation <名字|id>
                        刪掉一筆。刪 entity 會連帶刪掉它身上所有關係，
                        動手前會先把要刪的東西全部印出來。

  以上都可以加 --dry-run：只算給你看，不寫任何東西。
  重複的選項可以給多次，例如 --add-alias 白衣客 --add-alias 落雨劍客。

反悔（讓直接寫入變便宜）：
  snapshots                   列出快照（時間、各 store 筆數）
  restore <timestamp>         還原到某個快照（還原前也會先存一份現況快照）
  diff [<timestamp>]          現況跟快照差在哪（省略時比最近一份）

寫（預設只寫提案）：
  validate <候選檔.json>                驗證候選格式，不寫任何東西
  propose <候選檔.json> [--source ...] [--note ...] [--dry-run]
                                       寫成 repo 的 proposals/<timestamp>.json
  snapshot                             把現在的 data/*.json 存一份快照
  apply <候選檔.json> [--chapters <章節檔.json>] [--update-existing] --yes
                                       直接改 data/*.json（批量套用抽取候選；
                                       一定會先自動快照）
                                       --update-existing：候選名字已存在時，
                                       改成更新既有那一筆（保留 id），而不是略過

候選檔格式（LLM 抽章節之後回傳的那一份）：
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
      let value;
      if (next === undefined || next.startsWith('--')) value = true;
      else { value = next; i++; }
      // 同一個選項給第二次就變成陣列（--add-alias 白衣客 --add-alias 落雨劍客），
      // 之前是後面蓋掉前面，會靜默丟掉使用者輸入的東西。
      if (Object.prototype.hasOwnProperty.call(opts, key)) {
        opts[key] = Array.isArray(opts[key]) ? [...opts[key], value] : [opts[key], value];
      } else opts[key] = value;
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



function specFromOpts(opts, map) {
  const spec = {};
  for (const [flag, key] of Object.entries(map)) {
    if (opts[flag] !== undefined) spec[key] = opts[flag];
  }
  return spec;
}

function readContentFile(opts) {
  const path = opts['content-file'];
  if (path === undefined) return undefined;
  if (path === true) die('--content-file 要給檔案路徑。');
  if (Array.isArray(path)) die('--content-file 只能給一個檔案。');
  if (!existsSync(path)) die(`找不到正文檔：${path}`);
  return readFileSync(path, 'utf8');
}

/** review 的模式。中文也收，因為使用者跟 agent 講的是「製作模式」不是 production。 */
const MODE_ALIAS = {
  author: 'author', 作者: 'author', production: 'production', 製作: 'production',
  public: 'public', 公開: 'public',
};
function parseModes(raw) {
  if (raw === undefined || raw === true || raw === 'all' || raw === '全部') return MODES.slice();
  const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => String(s).trim()).filter(Boolean);
  const out = [];
  for (const m of list) {
    const norm = MODE_ALIAS[m];
    if (!norm) die(`--mode 只收 ${Object.keys(MODE_ALIAS).join(' / ')} 或 all，收到「${m}」。`);
    if (!out.includes(norm)) out.push(norm);
  }
  return out.length ? out : MODES.slice();
}

function requireType(raw) {
  const type = String(raw || '').replace(/ies$/, 'y').replace(/s$/, '');
  const norm = { entity: 'entity', chapter: 'chapter', foreshadow: 'foreshadow', relation: 'relation' }[type];
  if (!norm) die(`類型要是 ${RECORD_TYPES.join(' / ')} 其中之一，收到「${raw}」。`);
  return norm;
}

/**
 * 所有直接寫入都走這一條：先算（算不出來就整個中止，一個字都沒動）→ 先快照
 * → 才寫 → 印出快照位置與還原指令 → 印過期警告。
 *
 * 順序是刻意的：驗證在快照之前，所以打錯字不會留一堆垃圾快照；快照在寫入之
 * 前，所以快照裡永遠是「改動之前」的狀態。
 */
function mutate(opts, message, fn) {
  const repo = resolveRepo(opts);
  const { data } = pullData(repo);
  let result;
  try { result = fn(data); } catch (e) { die(e.message); }
  assertValidProjectData(result.data);
  if (opts['dry-run']) {
    for (const line of result.log) console.log(line);
    console.log('\n（dry-run：什麼都沒有寫。拿掉 --dry-run 才會真的改。）');
    return;
  }
  const snap = writeSnapshot(repo, data);
  writeData(repo, result.data, `${message} ${snap.ts}`);
  for (const line of result.log) console.log(line);
  console.log(`\n已寫入 ${repo.slug} 的 data/*.json。`);
  console.log(`寫入前的快照：${repo.slug} 的 ${snap.remoteDir}（本機：${snap.localDir}）`);
  console.log(`要反悔：node scripts/mycelium.mjs restore ${snap.ts}`);
}

function printDiff(diff) {
  const label = { entities: '角色', relations: '關係', chapters: '章節', foreshadow: '伏筆', chatlogs: '對話紀錄' };
  const short = (v) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  };
  for (const [store, d] of Object.entries(diff)) {
    if (!d.added.length && !d.removed.length && !d.changed.length) continue;
    console.log(`${label[store] || store}：新增 ${d.added.length}、刪除 ${d.removed.length}、修改 ${d.changed.length}`);
    for (const r of d.added) console.log(`  + ${r.name || r.title || r.type || r.id}（id ${r.id}）`);
    for (const r of d.removed) console.log(`  - ${r.name || r.title || r.type || r.id}（id ${r.id}）`);
    for (const c of d.changed) {
      console.log(`  ~ ${c.record.name || c.record.title || c.record.type || c.id}（id ${c.id}）`);
      for (const f of c.fields) console.log(`      ${f.key}：${short(f.from)} → ${short(f.to)}`);
    }
  }
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
    const sorted = sortChapters(data.chapters);
    if (!sorted.length) { console.log('還沒有任何章節。'); return; }
    let total = 0;
    for (const c of sorted) {
      total += Number(c.wordCount) || 0;
      console.log(`- 第${c.volume}卷・${c.title}［${c.status}］${c.wordCount ? ` ${c.wordCount} 字` : ''}${c.summary ? `：${c.summary}` : ''}`);
    }
    console.log(`共 ${sorted.length} 章、${total} 字。`);
  },

  /**
   * 匯出關係圖。這是網頁收掉之後（#34）唯一保留下來的視覺面：
   * 空間佈局是對話給不了的東西，其餘（瀏覽、編輯、備份、提案）對話都做得比較快。
   *
   * 產出是一個自帶樣式與 cytoscape 的單一 HTML，點兩下就開，不連網、不需要伺服器。
   * 預設寫到本機快取目錄而不是工作目錄：裡面是整部作品的真實設定，
   * 不應該一個手滑就躺進某個 git repo 裡。
   */
  graph(opts) {
    const { repo, data } = loadData(opts);
    const model = buildGraphModel(data);
    if (!model.nodes.length) die('設定庫裡還沒有角色，畫不出關係圖。');
    const outOpt = opts.out;
    if (outOpt === true) die('--out 要給檔案路徑。');
    if (Array.isArray(outOpt)) die('--out 只能給一個路徑。');
    const dir = join(cacheDir(repo), 'graph');
    // 副檔名固定是 .graph.html，跟本 repo .gitignore 的 `*.graph.html` 對得起來。
    const out = outOpt ? resolve(String(outOpt)) : join(dir, `${repo.name}.graph.html`);
    const outDir = join(out, '..');
    mkdirSync(outDir, { recursive: true });
    const tracked = opts.force ? null : gitTreeWithRemote(outDir);
    if (tracked) {
      die(`${outDir}\n     在一個有 remote 的 git 工作目錄裡（${tracked}）。\n`
        + '     這份 HTML 帶著整部作品的設定與伏筆，推上去就是公開。\n'
        + '     真的要寫在這裡就加 --force，並自己確認它有被 .gitignore 蓋到。');
    }
    const generatedAt = new Date().toLocaleString('zh-TW', { hour12: false });
    writeFileSync(out, buildGraphHtml({ model, title: repo.name, generatedAt }), 'utf8');
    const dangling = (data.relations || []).length - model.edges.length;
    console.log(`關係圖：角色 ${model.nodes.length}、關係 ${model.edges.length}。`);
    if (dangling > 0) console.log(`（略過 ${dangling} 筆端點已不存在的關係——它們會讓整張圖畫不出來。）`);
    console.log(out);
    console.log('點兩下就能開，不需要網路，也不需要跑伺服器。');
  },

  /**
   * 審閱頁（#38）。graph 回答的是「誰跟誰糾纏」，review 回答的是另外三個問題：
   *
   *   1. 全部東西在哪裡（沒有關係的角色在關係圖上根本不存在）
   *   2. 上次看完之後，AI 又動了什麼（從 git 歷史算，每一次寫入都是一個 commit）
   *   3. 這一份可以給誰看（作者／畫師／讀者，看到的東西不一樣）
   *
   * 三種模式各產一個檔案，不是同一個檔案切換顯示——製作與公開模式的底層內容
   * 必須連 DOM 都沒有，否則看一次原始碼就破功。過濾在這裡（產生的時候）做完。
   */
  async review(opts) {
    const { repo, data } = loadData(opts);
    if (!(data.entities || []).length) die('設定庫裡還沒有任何東西，沒有可以審閱的內容。');

    const modes = parseModes(opts.mode);
    const volume = opts.volume === undefined ? 1 : Number(opts.volume);
    if (!Number.isFinite(volume) || volume < 1) die(`--volume 要是 1 以上的數字，收到「${opts.volume}」。`);

    const outOpt = opts.out;
    if (outOpt === true) die('--out 要給資料夾路徑。');
    if (Array.isArray(outOpt)) die('--out 只能給一個路徑。');
    const outDir = outOpt ? resolve(String(outOpt)) : join(cacheDir(repo), 'review');
    mkdirSync(outDir, { recursive: true });
    const tracked = opts.force ? null : gitTreeWithRemote(outDir);
    if (tracked) {
      die(`${outDir}\n     在一個有 remote 的 git 工作目錄裡（${tracked}）。\n`
        + '     審閱頁帶著整部作品的設定、伏筆與底層，推上去就是公開。\n'
        + '     真的要寫在這裡就加 --force，並自己確認它有被 .gitignore 蓋到。');
    }

    let history = null;
    if (modes.includes('author') && !opts['no-history']) {
      const limit = opts.history === undefined ? 40 : Number(opts.history);
      if (!Number.isFinite(limit) || limit < 1) die(`--history 要是 1 以上的數字，收到「${opts.history}」。`);
      try {
        history = await fetchHistory(repo, { limit });
      } catch (e) {
        // 讀不到歷史不該讓整個指令失敗：少了新舊標記，頁面其他部分照樣有用。
        console.log(`（讀不到 git 歷史，這次沒有新舊標記：${e.message}）`);
      }
    }

    const generatedAt = new Date().toLocaleString('zh-TW', { hour12: false });
    const fileOf = (m) => `${repo.name}.${m === 'public' ? `public-v${volume}` : m}.review.html`;
    const siblings = Object.fromEntries(modes.map((m) => [m, fileOf(m)]));

    for (const mode of modes) {
      const model = buildReviewModel(data, {
        mode, volume, history, title: repo.name, generatedAt, repoSlug: repo.slug,
      });
      const out = join(outDir, fileOf(mode));
      writeFileSync(out, buildReviewHtml({ model, siblings }), 'utf8');
      const n = `角色 ${model.entities.length}、關係 ${model.relations.length}、章節 ${model.chapters.length}、伏筆 ${model.foreshadow.length}`;
      console.log(`${MODE_LABEL[mode]}模式：${n}`);
      if (mode !== 'author') {
        console.log(`  已在產生時移除：底層段落 ${model.dropped.sections} 段、伏筆 ${model.dropped.foreshadow} 筆`
          + (model.dropped.entities ? `、未登場角色 ${model.dropped.entities} 個` : ''));
      } else if (history) {
        console.log(`  讀了最近 ${history.scanned} 次寫入，標出 ${Object.keys(history.changes).length} 筆有動過的紀錄。`);
      }
      console.log(`  ${out}`);
    }
    console.log('\n點兩下就能開，不需要網路，也不需要跑伺服器。頁面上方可以互相切換模式。');
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
    console.log('data/*.json 完全沒有動。逐項跟使用者確認過，再用 apply 寫進設定庫。');
  },

  snapshot(opts) {
    const repo = resolveRepo(opts);
    const { data } = pullData(repo);
    const snap = writeSnapshot(repo, data);
    console.log(`快照完成：${repo.slug} 的 ${snap.remoteDir}`);
    console.log(`本機另存一份：${snap.localDir}`);
  },


  edit(opts) {
    const type = requireType(opts._[0]);
    const ref = opts._[1];
    if (!ref) die(`要指定改哪一筆，例如：edit ${type} 林小雨 --notes "…"`);
    const content = readContentFile(opts);
    const maps = {
      entity: {
        rename: 'rename', type: 'type', notes: 'notes', 'add-alias': 'addAlias', 'rm-alias': 'rmAlias',
        'add-tag': 'addTag', 'rm-tag': 'rmTag', field: 'field', 'rm-field': 'rmField',
        // 製作層：視覺版本（同一個角色可以有很多版）
        visual: 'visual', 'rm-visual': 'rmVisual',
        ...Object.fromEntries(VISUAL_FIELDS.map((f) => [f.flag, f.spec])),
      },
      chapter: { status: 'status', title: 'title', summary: 'summary', wordcount: 'wordCount', volume: 'volume', order: 'order' },
      foreshadow: { status: 'status', title: 'title', notes: 'notes', plant: 'plant', recover: 'recover', 'link-entity': 'linkEntity', 'unlink-entity': 'unlinkEntity', 'link-relation': 'linkRelation', 'unlink-relation': 'unlinkRelation' },
      relation: { type: 'type', notes: 'notes' },
    };
    const spec = specFromOpts(opts, maps[type]);
    if (content !== undefined) {
      if (type !== 'chapter') die('--content-file 只用在 edit chapter。');
      spec.content = content;
    }
    mutate(opts, `agent edit ${type}`, (data) => editRecord(data, type, ref, spec));
  },

  add(opts) {
    const type = requireType(opts._[0]);
    const content = readContentFile(opts);
    const maps = {
      entity: { type: 'type', notes: 'notes', aliases: 'aliases', tags: 'tags', field: 'field' },
      chapter: { title: 'title', volume: 'volume', status: 'status', wordcount: 'wordCount', summary: 'summary', order: 'order' },
      foreshadow: { title: 'title', notes: 'notes', status: 'status', plant: 'plant', recover: 'recover', 'link-entity': 'linkEntity', 'link-relation': 'linkRelation' },
      relation: { source: 'source', target: 'target', type: 'type', notes: 'notes' },
    };
    const spec = specFromOpts(opts, maps[type]);
    // 位置參數也收：add entity 城主 等同 add entity --name 城主。
    if (type === 'entity') spec.name = opts.name !== undefined ? opts.name : opts._[1];
    if ((type === 'chapter' || type === 'foreshadow') && spec.title === undefined) spec.title = opts._[1];
    if (type === 'entity' && spec.aliases !== undefined && typeof spec.aliases === 'string') {
      spec.aliases = spec.aliases.split(',');
    }
    if (type === 'entity' && spec.tags !== undefined && typeof spec.tags === 'string') {
      spec.tags = spec.tags.split(',');
    }
    if (content !== undefined) {
      if (type !== 'chapter') die('--content-file 只用在 add chapter。');
      spec.content = content;
    }
    mutate(opts, `agent add ${type}`, (data) => addRecord(data, type, spec));
  },

  rm(opts) {
    const type = requireType(opts._[0]);
    const ref = opts._[1];
    if (!ref) die(`要指定刪哪一筆，例如：rm ${type} 城主`);
    const repo = resolveRepo(opts);
    const { data } = pullData(repo);
    // 先把「會被刪掉什麼」整份印出來再動手——刪 entity 會連帶帶走關係，
    // 使用者有權在事前看到完整清單，而不是事後才發現關係圖少了幾條線。
    let plan;
    try { plan = planRemoval(data, type, ref); } catch (e) { die(e.message); }
    console.log(`將刪除：${describeRecord(data, type, plan.record)}（id ${plan.record.id}）`);
    for (const c of plan.cascade) {
      console.log(`連帶刪除 ${c.records.length} 筆關係：`);
      for (const r of c.records) console.log(`  - ${describeRecord(data, 'relation', r)}（id ${r.id}）`);
    }
    for (const w of plan.warn) console.log(`注意：${w}`);
    console.log('');
    mutate(opts, `agent rm ${type}`, (d) => removeRecord(d, type, ref));
  },

  snapshots(opts) {
    const repo = resolveRepo(opts);
    const local = new Set(localSnapshots(repo));
    const remote = opts.cached ? [] : remoteSnapshots(repo);
    const all = Array.from(new Set([...local, ...remote])).sort();
    if (!all.length) { console.log('還沒有任何快照。跑一次 snapshot 就會有第一份。'); return; }
    for (const ts of all) {
      const where = [local.has(ts) ? '本機' : null, remote.includes(ts) ? 'repo' : null].filter(Boolean).join('＋');
      let counts = '';
      if (local.has(ts)) {
        const snap = readSnapshot(repo, ts);
        counts = Object.entries(snap.data).map(([store, arr]) => `${store} ${arr.length}`).join('、');
      } else {
        counts = '（本機沒有快取，需要時 restore/diff 會自動從 repo 抓）';
      }
      console.log(`- ${ts}［${where}］${counts}`);
    }
    console.log('\n還原：node scripts/mycelium.mjs restore <timestamp>');
  },

  restore(opts) {
    const ts = opts._[0];
    if (!ts) die('要指定快照時間戳：restore 20260722-101530（可先跑 snapshots 看清單）');
    const repo = resolveRepo(opts);
    const snap = readSnapshot(repo, ts);
    if (!snap) die(`找不到快照 ${ts}。跑 snapshots 看有哪些。`);
    try { assertValidProjectData(snap.data); } catch (e) { die(`快照 ${ts} 的內容不合法：${e.message}`); }
    mutate(opts, `agent restore ${ts}`, (data) => {
      const diff = diffData(data, snap.data);
      const log = [`從 ${snap.from} 還原到 ${ts}。`];
      if (isEmptyDiff(diff)) log.push('（現況跟這份快照一模一樣，等於沒變。）');
      return { data: snap.data, log };
    });
  },

  diff(opts) {
    const repo = resolveRepo(opts);
    const local = localSnapshots(repo);
    const remote = opts.cached ? [] : remoteSnapshots(repo);
    const all = Array.from(new Set([...local, ...remote])).sort();
    const ts = opts._[0] || all[all.length - 1];
    if (!ts) die('還沒有任何快照可以比。先跑一次 snapshot。');
    const snap = readSnapshot(repo, ts);
    if (!snap) die(`找不到快照 ${ts}。跑 snapshots 看有哪些。`);
    const { data } = opts.cached ? { data: readCachedData(repo) } : pullData(repo);
    if (!data) die('本機還沒有快取，先跑一次 pull。');
    const diff = diffData(snap.data, data);
    console.log(`比對基準：快照 ${ts}（${snap.from}）→ 現況`);
    if (isEmptyDiff(diff)) { console.log('沒有任何差異。'); return; }
    printDiff(diff);
  },

  apply(opts) {
    const path = opts._[0];
    if (!path) die('要給候選檔：apply candidates.json --yes');
    if (!opts.yes) {
      die('apply 會直接改 data/*.json。只有使用者明講「直接寫」時才可以用，並要加 --yes。' +
        '\n     預設請改用 propose——先寫成提案，逐項跟使用者確認過再套用。');
    }
    const raw = readJsonFile(path);
    const chapters = opts.chapters ? readJsonFile(opts.chapters) : [];
    if (!Array.isArray(chapters)) die('--chapters 的檔案要是章節物件的陣列。');
    const repo = resolveRepo(opts);
    const { data } = pullData(repo);

    // 快照永遠先做，而且做在任何寫入之前：repo 的 data/*.json 就是主本，
    // 這裡蓋錯就是直接蓋掉使用者的稿子，沒有第二份可以救。
    const snap = writeSnapshot(repo, data);
    console.log(`已先快照：${repo.slug} 的 ${snap.remoteDir}（本機：${snap.localDir}）`);

    let result;
    try { result = applyCandidates(data, raw, { chapters, updateExisting: !!opts['update-existing'] }); } catch (e) { die(e.message); }
    assertValidProjectData(result.data);
    writeData(repo, result.data, `agent apply ${snap.ts}`);
    for (const line of result.log) console.log('  ' + line);
    console.log(`已直接寫入 ${repo.slug} 的 data/*.json。`);
    console.log(`要還原就把 ${snap.remoteDir} 底下的檔案覆蓋回 data/。`);
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(USAGE); return; }
  const fn = commands[cmd];
  if (!fn) die(`沒有這個指令：${cmd}\n${USAGE}`);
  const opts = parseArgs(argv.slice(1));
  try {
    // 大部分指令是同步的，review 要並行抓 git 歷史所以是 async——
    // await 一個非 Promise 也沒事，這裡不需要分兩條路。
    await fn(opts);
  } catch (e) {
    die(e.message);
  }
}

main();
