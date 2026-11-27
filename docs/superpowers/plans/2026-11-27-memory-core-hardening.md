# 記憶核心加固（第二階段前置）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉第一個 agent 接入前必修的三項：壞操作不再讓開啟失敗、鎖檔不再有競態、合併後 person: 私事不擴散。

**Architecture:** 只改 core/ 既有模組與測試，不加新模組。

**Tech Stack:** Node ≥ 22.13（node:sqlite、node:test），零 npm 依賴。

**Spec:** `docs/superpowers/specs/2026-11-27-memory-core-design.md`（§12、§13；本計畫新增 §14）

## Global Constraints

- Node 22.13 以上；執行期零 npm 依賴；不用原生模組。
- Windows、Mac、Linux 都要過 CI（`.github/workflows/core.yml`）。
- 測試與範例只用示範角色（林小雨、白衣客、落雨劍客、城主、黑袍人）。
- 程式註解、錯誤訊息、警告用正體中文、全形標點。
- git 一律 `execFileSync('git', [...])`，不經 shell。
- 測試指令：`node --test "tests/core/*.test.mjs"`。

## Review Focus

1. 一筆壞操作被略過後，每台裝置的結果仍然相同（略過的判斷只看操作本身，不看本機狀態）。
2. 鎖檔被判定殘留而移除時，不能刪到別的程序剛拿到的新鎖。
3. 合併後，綁在 `person:<舊 id>` 的私事對 `person:<新 id>` 不可見，但 public 事實照常跟著合併。
4. 長時間 `git fetch`（網路慢）期間，其他程序仍能寫入（不卡在鎖上）。
5. 中間壞行被略過時要 warn，且之後的行仍被讀到。

---

### Task 1: 壞操作不讓開啟失敗

**Files:**
- Modify: `core/oplog.mjs`（`readAll`）、`core/store.mjs`（`catchUp`、`rebuildAll`、`replayOp`）
- Test: `tests/core/oplog.test.mjs`、`tests/core/store.test.mjs`

**Interfaces:**
- Produces: `readAll()` 不再因中間壞行丟錯：略過該行並 `console.warn('略過無法解析的操作：<檔名> 第 N 行')`；仍回傳其餘各行。
- Produces: `export function isValidOp(op): boolean`（core/store.mjs）：op 是物件、`id` 為非空字串、`hlc` 符合 `^\d{13}-\d{4}-.+$`、`type` 為字串。`catchUp` 在 observe、子集合檢查、排序之前，先濾掉不合格的 op，每筆 `console.warn('略過格式不合的操作：<id 或 (無 id)>')`。`rebuildAll` 也只重播合格的 op。

- [ ] **Step 1: 寫失敗測試**
  - oplog：檔案三行，中間一行是 `{壞`，`readAll()` 回傳兩筆且有含「第 2 行」的 warn。（取代原本「中間壞行丟錯」的測試。）
  - store：在 jsonl 末尾手動加入 `{"id":"x","hlc":"garbage","type":"create_entity","space":"demo","data":{}}`、`null`、`{"hlc":"0000000000001-0000-dev","type":"create_entity"}`（無 id）各一行；重新 `openStore` 不丟錯、既有資料都在、三筆各有一個 warn；再重開一次 applied 筆數不變（不會每次重建）。
- [ ] **Step 2: 執行確認失敗**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 執行確認通過**（全套）
- [ ] **Step 5: Commit** `fix(core): 格式不合的操作與中間壞行改為略過並警告`

---

### Task 2: 鎖檔加固

**Files:**
- Modify: `core/oplog.mjs`（鎖的取得與釋放）、`core/sync.mjs`（fetch 移出鎖外）
- Test: `tests/core/oplog.test.mjs`、`tests/core/sync.test.mjs`

**Interfaces:**
- Produces: 鎖檔內容為 JSON `{pid, host, token}`（token 用 `ulid()`）。釋放時讀回，token 相同才刪；不同就只 warn 不刪。
- Produces: 判定殘留：鎖檔 mtime 超過 60 秒，且（同 host 時）該 pid 已不存在（`process.kill(pid, 0)` 丟 ESRCH）。移除殘留鎖改用「rename 成 `.lock.stale-<token>` 再刪」，rename 失敗代表別人已處理，重新嘗試取得。
- Produces: 持鎖期間每 10 秒 `fs.utimesSync` 更新鎖檔 mtime（用 setInterval，釋放時清掉；同步函式內無法跑 interval 時，於長操作前後手動 touch）。
- Produces: `sync` 先在鎖外執行 `git fetch -q <remote> <branch>`（第一次遠端分支不存在時容忍），鎖內才 `git merge --no-edit FETCH_HEAD`（第一次加 `--allow-unrelated-histories`）與 catchUp。
- [ ] **Step 1: 寫失敗測試**
  - 別人的鎖（token 不同）在我們釋放時不被刪。
  - 殘留鎖：寫一個 pid 不存在、mtime 設為 2 分鐘前的鎖檔，取得鎖成功；兩個 Store 同時競爭殘留鎖時只有一個拿到（另一個重試後拿到，不會互刪）。
  - sync 在 fetch 期間不持鎖：用注入或替身方式讓 fetch 階段可觀察（例如 sync 接受 `onFetched` 回呼，在回呼裡另一個 Store 寫入成功）。
- [ ] **Step 2–4:** 確認失敗、實作、通過（全套）
- [ ] **Step 5: Commit** `fix(core): 鎖檔記錄持有者並防止誤刪；sync 的 fetch 移出鎖外`

---

### Task 3: 合併後 person: 私事不擴散

**Files:**
- Modify: `core/query.mjs`（`normAud`／`visibility`）、`core/store.mjs`（`checkWidth`、`sameKindActive`、`upsertEntity` 候選的 audience 比對）
- Modify: `README.md`、`docs/superpowers/specs/2026-11-27-memory-core-design.md`（新增 §14，並把 §13 的「下一階段實作」改為已實作）
- Test: `tests/core/query.test.mjs`、`tests/core/store.test.mjs`

**Interfaces:**
- Produces: audience 比對一律「字串完全相同」，`person:X` 的 X 不經 resolve。主體、關係仍照常 resolve（合併後的公開事實照常歸到合併後的人物）。
- [ ] **Step 1: 寫失敗測試**（改寫原本「合併後 person:林小雨 用 person:白衣客 查得到」那條）
  - 林小雨有 `person:林小雨` 的私事與一條公開事實；林小雨併入白衣客後：`['public','person:白衣客']` 看得到公開事實、看不到私事；`['public','person:林小雨']` 兩者都看得到。
  - 別名、episode、search、timeline、neighbors、sameKindActive、upsertEntity 候選各一條同樣的負控制。
  - checkWidth：`person:林小雨` 的事實在合併後，用 `person:白衣客` 取代它會被拒。
- [ ] **Step 2–4:** 確認失敗、實作、通過（全套）
- [ ] **Step 5: Commit** `fix(core): 可見範圍標籤改為字串完全比對，合併不擴散私事`

---

### Task 4: PR

- [ ] 全套 `npm run test:core`、`npm run test:skill` 通過。
- [ ] 開 PR（不 auto-merge），CI 三系統 × Node 22／24 全綠後由主控合併。
