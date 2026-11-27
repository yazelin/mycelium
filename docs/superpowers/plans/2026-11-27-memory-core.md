# 菌絲體記憶核心（第一階段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mycelium repo 裡做出記憶核心：人事物、別名、有時效與可見範圍的事實、原始紀錄，以操作紀錄為主本、可跨裝置同步，並提供 CLI 與 MCP。

**Architecture:** 每次寫入先寫成一筆操作（追加到 `ops/<裝置>.jsonl` 並在本機 git commit），再由 `applyOp` 套進 SQLite。SQLite 只是查詢用的結果，可從操作整個重建。同步時若收到比本機最新還舊的操作，就整個重建，保證結果與順序無關。

**Tech Stack:** Node ≥ 22.13（`node:sqlite`、`node:test`），零 npm 執行期依賴，git CLI。

**Spec:** `docs/superpowers/specs/2026-11-27-memory-core-design.md`

**範圍：** 本計畫只做設計文件第十節的第 1 步。沒有任何既有作品資料，不做舊版匯入（亞澤 2026-11-27）。第 2 步（第一個 agent 接入）、第 3 步（HTTP 與 Pages 介面）、第 4 步（《續》試用與 skill 改接新核心）各自另寫計畫。既有的 `skills/mycelium/` 與 `effects/` 本計畫不動。

## Global Constraints

- Node 22.13 以上；`package.json` 加 `"engines": {"node": ">=22.13"}`。
- 執行期零 npm 依賴，不用原生模組（better-sqlite3、sqlite-vec、cr-sqlite 都不行）。
- 啟動時壓掉 `node:sqlite` 的 ExperimentalWarning（只壓這一種，其他警告照常印）。
- Windows、Mac、Linux 都要過 CI。
- 記憶核心本身不呼叫任何模型。
- 測試與範例只用示範角色（林小雨、白衣客、落雨劍客、城主、黑袍人），不放任何真實劇情或真實人物。
- 程式註解、錯誤訊息、CLI 輸出用正體中文、全形標點。
- 授權沿用 repo 的 MIT（林亞澤）。
- 不自動合併人物；取代事實時舊的標失效，不刪除。

## Review Focus

1. Windows 上 git 的 autocrlf 讓 jsonl 帶 `\r`：讀檔要容忍，ops 目錄要寫 `.gitattributes`（`* -text`）。→ Task 3 測試。
2. 程式中途當掉，jsonl 最後一行只寫一半：讀取時略過不完整的最後一行並印警告，不中斷。→ Task 3 測試。
3. 兩個字的中文名字（trigram 至少三字）：搜尋要退回 `LIKE`。→ Task 5 測試。
4. 兩台裝置把同一個 handle 加給不同人：同步後兩筆都留，標成衝突，不能讓唯一索引炸掉。→ Task 6 測試。
5. 太短或太常見的別名造成誤想起（例如「小」）：別名比對最少兩個字，另做「不該想起」的負控制。→ Task 5 測試。

---

## 檔案結構

```
core/
  names.mjs      nameKey()：名字比對用的正規化
  sqlite.mjs     開資料庫、壓警告、建表（schema 版本號）
  ids.mjs        ulid()、Hlc 類別（混合邏輯時鐘）
  time.mjs       時間點比較（date／chapter）
  oplog.mjs      操作檔讀寫、本機 git commit、remote 防護
  apply.mjs      applyOp(db, op)：唯一會改資料表的地方
  store.mjs      openStore() 與所有寫入 API（產生操作→寫檔→套用）
  query.mjs      recall、getEntity、search、timeline、neighbors
  sync.mjs       sync()、rebuild()
  mcp.mjs        stdio MCP server（自己實作最小 JSON-RPC）
bin/mycelium.mjs CLI
tests/core/*.test.mjs
.github/workflows/core.yml
```

---

### Task 1: 資料庫、id、時鐘、時間比較

**Files:**
- Create: `core/names.mjs`、`core/sqlite.mjs`、`core/ids.mjs`、`core/time.mjs`
- Modify: `package.json`（`engines`、`"test:core": "node --test tests/core/"`、`"bin": {"mycelium": "bin/mycelium.mjs"}`，`private` 保留）
- Test: `tests/core/basics.test.mjs`

**Interfaces:**
- Produces:
  - `nameKey(name): string`：NFKC、去掉所有空白、轉小寫；null 或全空白回空字串。核心不 import `skills/` 底下任何檔案。
  - `openDb(path: string): DatabaseSync`：建所有表，`PRAGMA user_version = 1`，`:memory:` 可用。
  - 資料表（欄位名後續任務照用）：
    - `spaces(id, name, kind, time_axis, chapters_json)`
    - `entities(id, space, type, name, summary, merged_into, name_hlc, summary_hlc, created_hlc)`
    - `aliases(id, space, entity_id, alias, alias_key, platform, is_handle, conflict)`
    - `facts(id, space, subject_id, predicate, object_entity, object_text, object_fact, valid_from, valid_to, audience, source_episode, confidence, author, superseded_by, hlc)`
    - `episodes(id, space, at, source, audience, body, entity_ids_json, hlc)`
    - `merges(id, space, from_id, to_id, reason, status, hlc)`：status ∈ `active`／`undone`／`pending`
    - `overwrites(id, entity_id, field, old_value, new_value, hlc)`
    - `applied(op_id PRIMARY KEY, hlc)`
    - `vectors(ref_id, kind, model, dim, vec BLOB)`：只建表，本階段不寫入也不查（設計文件預留給以後的向量模組）
    - FTS5 trigram 虛擬表 `fts(kind, ref_id, space, text)`
  - `ulid(): string`
  - `class Hlc { constructor(device: string); now(): string; observe(remote: string): void }`：格式 `"<13 位毫秒>-<4 位計數>-<裝置id>"`，字串比較即時間順序。
  - `cmpTime(space: {time_axis, chapters}, a: string, b: string): -1|0|1`：`date` 用 ISO 字串比；`chapter` 用 chapters 陣列索引，不在清單裡就丟錯「未知的章節：X」。
  - `activeAt(space, fact, at: string|null): boolean`：`at` 為 null 表示「現在」，即 `valid_to` 為空。

- [ ] **Step 1: 寫失敗測試** `tests/core/basics.test.mjs`
  - `nameKey('林 小雨') === nameKey('林小雨')`；`nameKey('ＡＢ') === 'ab'`；`nameKey('  ') === ''`。
  - `openDb(':memory:')` 後 `user_version` 為 1，十張表都存在。
  - 建立 `openDb` 時 `process.emitWarning` 不會印出 SQLite 的 ExperimentalWarning（用 `process.on('warning')` 收集，斷言沒有 `/SQLite/`）。
  - FTS：插入「黑洞先生是室友」，`MATCH '黑洞先'` 找得到。
  - `ulid()` 連續產生 1000 個不重複且字串遞增。
  - Hlc：同一毫秒連呼叫兩次，第二個大於第一個；`observe` 一個未來的時戳後，`now()` 大於它。
  - `cmpTime({time_axis:'chapter', chapters:['序章','ch01','ch02']}, 'ch02', 'ch01') === 1`；未知章節丟出含「未知的章節」的錯誤。
  - `activeAt`：`valid_from 'ch01', valid_to 'ch02'` 在 `ch01` 為真、在 `ch02` 為假（失效點不含）。

- [ ] **Step 2: 執行確認失敗** — `node --test tests/core/basics.test.mjs`，預期因模組不存在而 FAIL。
- [ ] **Step 3: 實作** 三個檔案與 package.json 變更。壓警告：在 import `node:sqlite` 前包住 `process.emitWarning`，只吞 `name === 'ExperimentalWarning' && /SQLite/.test(msg)`。
- [ ] **Step 4: 執行確認通過** — 同上，PASS。
- [ ] **Step 5: Commit** `feat(core): 資料庫、id、混合時鐘與時間比較`

---

### Task 2: 套用操作 applyOp

**Files:**
- Create: `core/apply.mjs`
- Test: `tests/core/apply.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `openDb`、`cmpTime`、資料表。
- Produces: `applyOp(db, op): void`，冪等（`applied` 已有該 id 就直接返回）。操作形狀 `{id, dev, hlc, type, space, data}`。`type` 與 `data`：
  - `create_space` `{name, kind:'social'|'story', timeAxis:'date'|'chapter', chapters?:string[]}`（space 即 op.space）
  - `set_chapters` `{chapters}`
  - `create_entity` `{entityId, type, name, summary?}`
  - `update_entity` `{entityId, field:'name'|'summary', value}`：欄位 hlc 較晚才寫入，蓋掉的舊值寫 `overwrites`；較早的操作只寫 `overwrites`（記下被忽略的值）。
  - `add_alias` `{aliasId, entityId, alias, platform?, isHandle?}`：同 space 同 platform 同 handle 已屬於別人時，兩筆的 `conflict` 都設 1，不丟錯。
  - `log_episode` `{episodeId, at, source, audience, body, entityIds?}`
  - `remember` `{factId, subjectId, predicate, objectEntity?|objectText?|objectFact?, validFrom, validTo?, audience, sourceEpisode?, confidence?, author, supersedes?:string[]}`：`supersedes` 裡的事實若尚未失效，`valid_to = validFrom`、`superseded_by = factId`。
  - `invalidate` `{factId, at, by?}`：已失效且原時間較早就不動（冪等）。
  - `merge` `{mergeId, fromId, toId, reason}`：`fromId` 已有另一筆 active 合併指向不同對象時，兩筆都改 `pending`，`merged_into` 清空。
  - `unmerge` `{mergeId}`、`resolve_merge` `{keepMergeId}`
  - 每種寫入同步維護 `fts`（entities 名稱＋摘要、aliases、facts 謂語＋object_text、episodes body）。
- 可見範圍是一個標籤 `audience`（亞澤 2026-11-27 選定，為以後公司內部系統 的群組、角色權限預留）：`'public'`、`'person:<entityId>'`、`'group:<名稱>'`、`'role:<名稱>'`。格式不符就丟錯「未知的可見範圍：X」。本階段所有測試與格莉奇只用 `public` 與 `person:`；`group:`、`role:` 只做字串比對，沒有其他語意。

- [ ] **Step 1: 寫失敗測試**，每種 type 至少一案，另加：
  - 同一 op 套兩次，各表列數不變。
  - `update_entity` 先套新的再套舊的，name 仍是新的，`overwrites` 有一筆舊值。
  - `remember` 帶 `supersedes`，舊事實 `valid_to` 等於新事實 `validFrom`。
  - 兩筆 `merge` 把林小雨分別併到白衣客、黑袍人 → 兩筆都 `pending`、林小雨 `merged_into` 為空；`resolve_merge` 後只剩一筆 active。
  - `add_alias` 同 handle 給兩人 → 兩筆 `conflict = 1`（Review Focus 4 的基礎）。
- [ ] **Step 2: 執行確認失敗** — `node --test tests/core/apply.test.mjs`
- [ ] **Step 3: 實作 `applyOp`**，每種 type 一個小函式，整個套用包在一個 transaction 裡。
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat(core): applyOp 套用操作（冪等、欄位時間戳較晚者勝、合併衝突待決定）`

---

### Task 3: 操作檔與本機 git

**Files:**
- Create: `core/oplog.mjs`
- Test: `tests/core/oplog.test.mjs`

**Interfaces:**
- Produces:
  - `class OpLog { constructor({dir, device, deviceName, autoCommit = true}); append(op): void; readAll(): op[]; files(): string[] }`
    - 檔名 `<deviceName>-<device>.jsonl`；`dir` 不是 git repo 就 `git init`，並寫 `.gitattributes`（`* -text`）。
    - `append`：一行 JSON＋`\n`，用 `fs.appendFileSync`；`autoCommit` 時 `git add <檔> && git commit -q -m "op <type> <id>"`。
    - `readAll`：讀目錄下所有 `*.jsonl`，去掉行尾 `\r`，略過空行；最後一行 JSON 解析失敗時略過並 `console.warn('略過不完整的最後一行：<檔名>')`；中間行壞掉則丟錯（檔名＋行號）。
  - `loadDevice(dir): {device, deviceName}`：讀寫 `<dir>/.device.json`（不進 git，`.gitignore` 加上），沒有就用 `ulid()` 尾 8 碼與 `os.hostname()` 建立。

- [ ] **Step 1: 寫失敗測試**（用 `fs.mkdtempSync` 暫存目錄）：
  - append 三筆後 `readAll` 回三筆，`git log --oneline` 有三個 commit。
  - 行尾帶 `\r\n` 的檔讀得出正確 JSON（Review Focus 1）。
  - 最後一行只有 `{"id":"x",` → 回其餘各行、有警告、不丟錯（Review Focus 2）。
  - 中間一行壞掉 → 丟錯，訊息含檔名與行號。
  - `.gitattributes` 內容是 `* -text`。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**（git 一律用 `execFileSync('git', [...], {cwd: dir})`，不經 shell，Windows 才不會出問題）
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat(core): 操作檔讀寫與本機 git 自動提交`

---

### Task 4: Store 寫入 API

**Files:**
- Create: `core/store.mjs`
- Test: `tests/core/store.test.mjs`

**Interfaces:**
- Consumes: `openDb`、`Hlc`、`ulid`、`applyOp`、`OpLog`、`loadDevice`、`nameKey`（Task 1 的 `core/names.mjs`，別名比對與重複候選都用它）。
- Produces: `openStore({dbPath, opsDir, autoCommit?}): Store`。開啟時若 `applied` 筆數少於操作檔筆數，就照 (hlc, dev, id) 排序把缺的套進去。Store 方法（每個都是「建 op → oplog.append → applyOp」，回傳新 id 或結果）：
  - `createSpace({id, name, kind, timeAxis, chapters?})`、`setChapters(space, chapters)`
  - `upsertEntity(space, {type, name, summary?, entityId?}) → {entityId, created: boolean, candidates: Array<{entityId, name, why: 'name'|'alias'|'fts'}>}`：沒給 entityId 時一律建新的，同時回傳可能重複的候選；有給就對有變動的欄位發 `update_entity`。
  - `addAlias(space, entityId, alias, {platform?, isHandle?})`：`nameKey(alias)` 少於 2 個字丟錯「別名至少兩個字」。
  - `findByHandle(space, platform, handle) → entityId|null`
  - `logEpisode(space, {at, source, audience, body, entityIds?}) → episodeId`
  - `remember(space, {subjectId, predicate, objectEntity?|objectText?|objectFact?, validFrom, validTo?, audience, sourceEpisode?, confidence?, author, supersedes?}) → {factId, sameKindActive: Array<{factId, predicate, object}>}`：回傳同主體、同謂語、仍成立的其他事實，讓呼叫者決定要不要 `invalidate`。
  - `invalidate(space, factId, at, by?)`、`mergeEntities(space, fromId, toId, reason)`、`unmerge(space, mergeId)`、`resolveMerge(space, keepMergeId)`
  - `resolve(entityId) → entityId`：沿 `merged_into` 走到底。
  - `close()`

- [ ] **Step 1: 寫失敗測試**：
  - 建 story space「示範」→ 加林小雨、白衣客 → 記「林小雨 師父 白衣客」→ 重新 `openStore` 同一路徑，資料都在。
  - 刪掉 SQLite 檔再 `openStore` → 由操作重建，事實仍在。
  - 再 `upsertEntity` 一個名叫「林 小雨」的 → `created: true` 且 `candidates` 含林小雨、`why: 'name'`。
  - `remember` 第二條「林小雨 師父 黑袍人」→ `sameKindActive` 含第一條。
  - `addAlias(..., '小')` 丟錯（Review Focus 5 的寫入端）。
  - 合併後 `resolve(林小雨) === 白衣客`；`unmerge` 後回到自己。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat(core): Store 寫入 API（操作先寫檔再套用、重開可重建）`

---

### Task 5: 查詢與想起

**Files:**
- Create: `core/query.mjs`
- Test: `tests/core/query.test.mjs`

**Interfaces:**
- Consumes: Store 的 `db` 與 `resolve`、`activeAt`、`nameKey`。
- Produces（都掛在 Store 上，也單獨 export 成 `fn(store, ...)`）：
  - `recall(space, {text?, names?, at?, audiences, hops = 1, maxChars = 1500}) → {entities, facts, episodes, text}`
    - `audiences: string[]` 必填（例：公開場合 `['public']`；跟某人私下 `['public', 'person:<id>']`）；沒帶或空陣列就丟錯「recall 要指定能看哪些可見範圍」。
    - 可見規則：一筆紀錄的 `audience` 在 `audiences` 裡才回傳；`person:` 兩邊都先經 `resolve` 再比，所以合併後的人仍看得到合併前綁給他的私事。走關係帶出的人也套同一規則。
    - 步驟：以 `nameKey` 掃 `text` 找出所有長度 ≥2 的別名與正式名稱 → `resolve` → 取 `activeAt(at)` 且可見的事實 → 沿 `object_entity` 與反向 `subject_id` 走 `hops` 層 → 全文搜尋 `text` 補最多 5 筆可見 episodes。
    - `text` 欄位：給模型看的中文段落，依人分段，每條事實一行，超過 `maxChars` 就截在整行邊界。格式由實作者決定。
  - `getEntity(space, id, {at?, audiences}) → {entity, aliases, activeFacts, pastFacts}`
  - `search(space, query, {audiences, limit = 20})`：`nameKey(query)` 長度 ≥3 用 FTS `MATCH`，否則用 `LIKE '%q%'`（Review Focus 3）。
  - `timeline(space, {entityId?, audiences}) → facts`（依 `valid_from` 用 `cmpTime` 排序）
  - `neighbors(space, entityId, {hops = 1, at?, audiences})`

- [ ] **Step 1: 寫失敗測試**（social space，日期軸）：
  - 洩漏負控制 1：城主有一條 `person:城主` 的事實；`recall({text:'城主今天來了', audiences:['public']})` 結果與 `text` 都不含那條。
  - 洩漏負控制 2：落雨劍客私下說了關於城主的事（`person:落雨劍客`）；用 `['public','person:城主']` 查時不含；用 `['public','person:落雨劍客']` 查時含。
  - 走關係洩漏：從白衣客走一層帶出城主時，城主的 private 事實一樣不出現。
  - 時間：`at` 早於失效時間時能拿到舊事實，現在則拿不到。
  - 章節軸：`at:'ch01'` 時「林小雨 知道 <某事實>」尚未生效，`at:'ch02'` 時有。
  - 兩字名：`search('城主')` 找得到（Review Focus 3）。
  - 誤想起負控制：有一個別名「白衣」的人物，`recall({text:'她穿白色衣服'})` 不帶出他；`recall({text:'白衣客來了'})` 會帶出（Review Focus 5）。
  - `recall` 不帶 `audiences` 丟錯；`remember` 帶 `audience:'secret'` 丟出「未知的可見範圍」。
  - 合併：`person:林小雨` 的事實，在林小雨併入白衣客後，用 `['public','person:白衣客']` 查得到。
  - `maxChars: 100` 時 `text.length <= 100`。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat(core): recall／search／timeline／neighbors，可見範圍標籤`

---

### Task 6: 同步與重建

**Files:**
- Create: `core/sync.mjs`
- Test: `tests/core/sync.test.mjs`

**Interfaces:**
- Consumes: Store、OpLog、applyOp。
- Produces:
  - `rebuild(store): void`：清空所有資料表與 `applied`，依 (hlc, dev, id) 重播全部操作。
  - `sync(store, {remote = 'origin', branch = 'main', requirePrivate = false}) → {pulled: number, pushed: boolean, rebuilt: boolean}`：
    1. `requirePrivate` 時，遠端網址若是 GitHub，用 `gh api repos/<owner>/<repo> --jq .private`（或匿名 `https://api.github.com/repos/<owner>/<repo>` 回 200 即視為公開）確認是 private，不是就丟錯「遠端不是 private repo，拒絕推送」。檢查方式抽成可注入的 `checkPrivate(url) → Promise<boolean>`，測試用假的。
    2. `git pull --no-rebase -q <remote> <branch>`（只有各自的檔，不會衝突；真的衝突就丟錯並保留現場）。
    3. 讀出未套用的操作；若其中任一筆 hlc 小於 `applied` 裡最大的 hlc，呼叫 `rebuild`，否則依序套用。對每筆遠端操作呼叫 `hlc.observe`。
    4. `git push -q <remote> HEAD:<branch>`。

- [ ] **Step 1: 寫失敗測試**（用暫存目錄建一個 `git init --bare` 當遠端，兩個裝置各 clone 一份）：
  - 甲、乙各自離線寫入（新增人物、記事實、甲改林小雨摘要、乙晚一點也改）→ 甲 sync、乙 sync、甲再 sync → 兩邊的 `entities`、`facts`、`aliases`、`merges` 查詢結果（排序後）完全相同；摘要是較晚的乙的值，`overwrites` 有甲的值。
  - 反過來的 sync 順序（乙先）得到同樣結果。
  - 甲把林小雨併到白衣客、乙把林小雨併到黑袍人 → 同步後兩邊都是兩筆 `pending`。
  - 甲、乙把同一個 larch handle 加給不同人 → 同步後兩筆 `conflict = 1`、沒有丟錯（Review Focus 4）。
  - `rebuild` 前後 `recall` 的回傳相同。
  - `requirePrivate: true` 且注入的 `checkPrivate` 回 false → 丟錯、沒有 push（遠端的 commit 數不變）。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat(core): 跨裝置同步與重建（結果與順序無關）`

---

### Task 7: MCP server 與 CLI

**Files:**
- Create: `core/mcp.mjs`、`bin/mycelium.mjs`
- Test: `tests/core/mcp.test.mjs`、`tests/core/cli.test.mjs`

**Interfaces:**
- Consumes: Store 全部方法、`sync`、`rebuild`。
- Produces:
  - `runMcp(store, {input = process.stdin, output = process.stdout})`：換行分隔的 JSON-RPC 2.0；支援 `initialize`（回 `protocolVersion: '2025-06-18'`、`capabilities: {tools: {}}`、`serverInfo: {name: 'mycelium', version}`）、`notifications/initialized`、`tools/list`、`tools/call`。未知方法回 `-32601`。
  - 工具名稱與參數（參數名照 Store 方法，`space` 必填）：`log_episode`、`upsert_entity`、`add_alias`、`remember`、`invalidate`、`merge_entities`、`unmerge`、`recall`、`get_entity`、`search`、`timeline`、`neighbors`、`list_spaces`。工具錯誤回 `isError: true` 加中文訊息，不讓 server 結束。每個工具的 `description` 用中文寫清楚何時用；`upsert_entity` 與 `remember` 的說明要寫「回傳的候選或同類事實要自己判斷，系統不會自動合併」。
  - CLI：`mycelium <指令> [選項]`，共用選項 `--db <路徑>`、`--ops <目錄>`（預設 `~/.mycelium/mycelium.db`、`~/.mycelium/ops`，環境變數 `MYCELIUM_DB`、`MYCELIUM_OPS` 可覆蓋）、`--require-private`（傳給 sync）。
    - `init --space <id> --name <名> --kind social|story --axis date|chapter`
    - `mcp`
    - `export --space <id>`（該 space 的操作 JSONL 印到 stdout，依 hlc 排序）
    - `sync`、`rebuild`
    - 未知指令印用法並以 1 結束。

- [ ] **Step 1: 寫失敗測試**
  - MCP：用 PassThrough stream 送 `initialize`、`tools/list`（含 13 個工具名稱）、`tools/call upsert_entity`、`tools/call recall`（不帶 audiences → `isError: true`、server 仍回應下一個請求）。
  - CLI：用 `execFileSync(process.execPath, ['bin/mycelium.mjs', ...])` 跑 `init` → 用 Store 寫入幾筆 → `export` 行數等於寫入的操作數；`sync` 在沒有 remote 的 ops 目錄回非 0 與中文錯誤（git 找不到 origin）。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**（`bin/mycelium.mjs` 首行 `#!/usr/bin/env node`）
- [ ] **Step 4: 執行確認通過**
- [ ] **Step 5: Commit** `feat: mycelium CLI 與 MCP server`

---

### Task 8: 跨平台 CI 與文件

**Files:**
- Create: `.github/workflows/core.yml`
- Modify: `README.md`（新增「記憶核心」一節，含英文段落）、`skills/mycelium/SKILL.md` 不動

**Interfaces:**
- Consumes: `npm run test:core`、CLI。

- [ ] **Step 1: 寫 workflow**：matrix `os: [ubuntu-latest, windows-latest, macos-latest]` × `node: [22, 24]`；步驟 checkout、setup-node、設定 git 使用者（測試會 commit）、`npm run test:core`、`node bin/mycelium.mjs init --space demo --name 示範 --kind story --axis chapter --db tmp/t.db --ops tmp/ops`。不需要 `npm ci`（零依賴）。
- [ ] **Step 2: README**：記憶核心是什麼、安裝（`npx github:yazelin/mycelium init ...`）、接 Claude Code（`claude mcp add mycelium -- npx -y github:yazelin/mycelium mcp`）、資料放哪、同步怎麼運作、可見範圍規則、英文摘要段落。對外中文先跑 `speak-tw` 檢查。
- [ ] **Step 3: 本機全跑** — `npm run test:core && npm run test:skill`，兩者都 PASS（舊 skill 測試不能壞）。
- [ ] **Step 4: Commit 並開 PR**，`gh pr merge --auto --merge`；確認三個系統、兩個 Node 版本的 job 全綠。
