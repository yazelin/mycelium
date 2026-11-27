# mycelium

一個 **記憶核心**（人、事、物關聯記憶）＋ 一個 **agent skill**（小說設定管理）＋ 一個 **敘事效果庫**。都是零依賴、沒有 build 步驟。

菌絲網路連結整片森林裡的樹；mycelium 連結你多部作品各自的設定資料網。

| | 是什麼 | 給誰 |
|---|---|---|
| 記憶核心（下方） | 人、事、物關聯記憶，MCP／CLI | 任何 AI agent |
| [`skills/mycelium/`](skills/mycelium/SKILL.md) | 長篇小說的設定管理，全部在終端機對話裡完成 | 寫長篇的人 ＋ 他的 agent |
| [`effects/`](https://yazelin.github.io/mycelium/) | 捲動驅動的敘事效果庫（`mycelium-fx`） | 在網頁上連載小說的人 |

---

## 記憶核心：人、事、物的關聯記憶

給 AI agent 用的關聯記憶：記人、事、物，以及它們之間隨時間變化的關係。資料全部留在自己的電腦上，不需要伺服器，也不需要雲端帳號。零 npm 依賴，需要 Node 22.13 以上，Windows、macOS、Linux 都測試過。

### 安裝與執行

不用先安裝，直接用 `npx` 跑：

```bash
npx github:yazelin/mycelium init --space demo --name 示範 --kind story --axis chapter
```

接上 Claude Code：

```bash
claude mcp add mycelium -- npx -y github:yazelin/mycelium mcp
```

### 資料放哪

- 資料庫：`~/.mycelium/mycelium.db`（SQLite，可隨時重建）
- 操作紀錄：`~/.mycelium/ops/`（真正的主本，每行一筆 JSON）
- 想換位置，設環境變數 `MYCELIUM_DB`、`MYCELIUM_OPS`，或用 `--db`、`--ops` 選項

### 指令

| 指令 | 作用 |
|---|---|
| `init --space <id> --name <名> --kind social\|story --axis date\|chapter` | 建立一個記憶空間 |
| `mcp` | 啟動 MCP server（stdio），給 agent 連線 |
| `export --space <id>` | 把該空間的操作以 JSONL 印出 |
| `sync` | 與 git 遠端同步操作紀錄 |
| `rebuild` | 從操作紀錄重建 SQLite 資料庫 |

`sync` 預設只推到 private repo：遠端不是 private 就拒絕推送，因為操作紀錄裡可能有私下得知的事。這個檢查只認得 GitHub 遠端，要先用 `gh auth login` 登入；其他主機一律拒絕。確定要推到公開 repo 或非 GitHub 主機時，加 `--allow-public`。

### 同步怎麼運作

每台裝置只往自己的 `ops/<主機名>-<裝置id>.jsonl` 追加一行行操作，不改別台的檔案，所以多台裝置用 git 同步時不會有衝突。`sync` 會拉回別台的新操作並重播進資料庫。SQLite 只是從操作紀錄算出來的快取，資料庫遺失或損壞時才需要 `rebuild`；程式更新後資料庫格式版本不同時，開啟時會自動清空重建。取代事實時，舊的標成失效而不刪除；也不會自動合併人物。

多個 Claude Code 各起一個 MCP server、再加上命令列 `sync`，可以同時用同一份記憶：寫入在 `ops/.lock` 這把鎖內排隊，寫入前會先讀進別的程序寫下的操作。沒有設定 git 身分（`user.name`／`user.email`）時，自動提交改用 `mycelium <mycelium@localhost>`。

寫入前會先驗證：章節軸的時間必須在章節清單裡，日期軸必須是 `YYYY-MM-DD` 或完整 ISO 時間；已被事實或紀錄用到的章節不能從清單移除。新建人物時 `type` 與 `name` 必填。

第一次同步前要先做兩件事。`~/.mycelium/ops` 會自動初始化成本機 git repo，但沒有遠端，`sync` 固定與遠端 `origin` 的 `main` 分支交換：

```bash
# 先在 GitHub 建一個 private repo（空的即可），再把它設成 origin
git -C ~/.mycelium/ops remote add origin <private repo 網址>
npx github:yazelin/mycelium sync
```

本機分支叫什麼都可以，推送一律是 `HEAD:main`。第二台裝置用同樣的兩行指令加入同一個遠端。

### 可見範圍

每筆紀錄帶一個 `audience` 標籤：

- `public`：任何人都看得到
- `person:<id>`：只有該人物的視角看得到
- `group:<名稱>`、`role:<名稱>`：給群組或角色

查詢（recall）時，呼叫者必須帶上自己能看哪些標籤（audiences），紀錄的標籤在其中才會回傳。輸出的事實若指向看不到的紀錄（`superseded_by`、`source_episode`、`object_fact`），該欄位會清成 null。

寫入時也照可見範圍：

- `remember` 回傳的同類仍成立事實，只列公開的、或與這次寫入同一範圍的。
- `upsert_entity` 可帶 `audiences`（預設 `['public']`），找重複候選時只比對看得到的別名。
- 較私下的資訊不能改動較公開的事實：寫入範圍與舊事實相同，或寫入範圍是 `public`，才能用 `supersedes` 取代或用 `invalidate` 讓它失效。`invalidate` 可帶 `audience`（預設 `public`）說明這次根據的資訊來自哪裡。

可見範圍標籤一律字串完全相同才算數，`person:<id>` 的 id 不經合併換算。人物 A 併入 B 之後，`person:A` 的私下紀錄仍只給 `person:A` 看，`person:B` 看不到；公開事實則照常歸到合併後的人物。

所以用平台帳號認人時，`findByHandle` 回傳 `{ entityId, resolvedId }`：`entityId` 是這個帳號原本綁定的人物，`resolvedId` 是合併後的人物。`person:` 標籤一律用 `entityId`，主體與關係用 `resolvedId`。`upsert_entity` 回傳的候選也同時帶 `entityId`（命中的那一列）與 `resolvedId`，同一個合併後的人物只列一次。

已知限制：人物名稱、摘要與合併視為公開資訊。私下得知的同一人關係，請用 `person:` 標籤的事實來記，不要寫進人物摘要或合併。

### English summary

The memory core is a zero-dependency (Node 22.13+) relational memory for AI agents: people, events and things, with relations that change over time. Everything stays on your own machine, in a SQLite cache rebuilt from append-only JSONL operation logs. Each device appends only to its own `ops/<device>.jsonl`, so syncing through git never conflicts. Facts carry an `audience` label (`public`, `person:<id>`, `group:`, `role:`), and recall requires the caller's audiences. A narrower audience can never supersede or invalidate a broader fact (only the same audience or `public` can). `person:` labels match exactly and do not follow merges; use the id bound to the handle. Entity names, summaries and merges are treated as public. Run it with `npx github:yazelin/mycelium <command>` and connect Claude Code with `claude mcp add mycelium -- npx -y github:yazelin/mycelium mcp`.

---

## agent skill：小說設定的終端機介面

給本機 agent（Claude Code / Codex / Gemini CLI…）用。在對話裡就能讀作品設定回答
一致性問題、**直接改設定**（角色、章節狀態、伏筆、關係都能改／加／刪）、把新章節
抽成設定候選（含別名合併判斷）、帶著全部設定討論劇情、批量匯入舊稿。

一部作品的資料就是**你自己的 private repo 裡的 `data/*.json`**——沒有伺服器、沒有
資料庫、沒有第二份主本。存取走你本來就登入的 `gh`，不需要 PAT。

- **`edit` / `add` / `rm` 直接寫**：你在對話裡說「改成這樣」就是確認
- **每次寫入前自動快照**到 `snapshots/<timestamp>/`（repo 與本機各一份），
  `snapshots` / `diff` / `restore` 讓反悔只要一行指令
- **編輯一律保留紀錄 id**，所以關係與伏筆的連結不會斷
- **別名是這個工具存在的理由**：身分反轉的劇情（某角色其實就是另一個角色）
  不會被記成兩個人

### `mycelium precheck`：動筆前先攤開

```bash
node scripts/mycelium.mjs precheck 第七章
```

寫任何一章之前先跑。掃作品 repo 的 `設定/*.md`，對這一章列三張清單：
**必讀**（提到這一章或這一章的人的段落）、**未決**（還沒拍板的）、**紅線**（不准做的）。

為兩個實際發生過的病做的：agent 沒讀設定就動筆；以及把使用者已經拍板的決定
又重新想一次、甚至覆蓋掉。判定用段落繼承——一行沒寫角色名，但它在那個角色的
標題底下，就算他的。

### `mycelium decisions`：全書決定總帳

```bash
node scripts/mycelium.mjs decisions                 # 全部
node scripts/mycelium.mjs decisions --open          # 只看還沒拍板的
node scripts/mycelium.mjs decisions --red           # 只看紅線
node scripts/mycelium.mjs decisions 艾可            # 只看跟某個關鍵字有關的
```

`precheck` 是「這一章要注意什麼」，`decisions` 是「整部作品到底決定了什麼」。
**提任何新想法之前先查一次**——這件事是不是已經拍板過了。

一行只要說了「還沒決定」，就不算已定案，即使同一行也出現「寫死」（多半是「別寫死」）。
判錯的方向要挑安全的那邊：把未決當成定案＝叫人不要再想，那是最糟的。

### `mycelium review`：審查 AI 生出來的東西

```bash
node scripts/mycelium.mjs review                        # 三種模式各產一個檔案
node scripts/mycelium.mjs review --mode 公開 --volume 2  # 公開到第 2 卷
```

AI 一天可以生出二十幾個角色、三十幾條伏筆——人來不及看。沒看，它就會在你沒同意
的前提上繼續蓋。`review` 就是為了這件事做的：

- **全部可瀏覽**：角色、關係、章節、伏筆。一條關係都沒有的角色在關係圖上不存在，
  在這裡看得到
- **標出上次以來的新改動**：每一次寫入都是作品 repo 的一個 commit，指令讀 git 歷史
  算出哪一筆什麼時候被動過；頁面記住上次看到哪（localStorage），下次打開只剩新的
- **三種模式**：作者（全部）／製作（表層＋視覺設定，給畫師）／公開（依卷數解鎖）

製作與公開是**另外兩個檔案**，裡面的底層內容連 DOM 都沒有——過濾在產生檔案的時候
就做完了。前端隱藏不算數：看一次原始碼就破功。

分層靠設定內文本來就有的 `════ 【表層】 ════` / `════ 【底層】 ════` 標題，
規則是白名單：沒有標記的一律當底層。

### `mycelium graph`：只有關係圖那一張

```bash
node scripts/mycelium.mjs graph                 # 寫到本機快取，印出路徑
node scripts/mycelium.mjs graph --out ~/桌面/關係.graph.html
```

產生一個**自帶樣式與 cytoscape 的單一 HTML**：點兩下就開，不連網、不用伺服器。
節點大小＝牽連多寡、形狀與顏色＝類型，點一個角色就只留下他的糾纏並展開他的設定；
圖例本身是類型篩選器，還沒牽上線的角色預設收起來。

十幾條關係誰跟誰糾纏，用看的三秒，用講的三分鐘——這是對話唯一取代不了的東西
（`review` 頁裡的「關係圖」檢視就是同一張）。

⚠ **這兩個指令匯出的檔案裡是整部作品的設定與伏筆。** 預設寫在本機快取
（`~/.cache/mycelium-skill/`），指令會**拒絕**寫進任何有 remote 的 git 工作目錄；
本 repo 的 `.gitignore` 另外擋掉 `*.graph.html` 與 `*.review.html`。

### 安裝

```bash
git clone https://github.com/yazelin/mycelium ~/mycelium
ln -s ~/mycelium/skills/mycelium ~/.claude/skills/mycelium
```

需要 `node` 18+ 與已登入的 `gh`，零 npm 依賴。作品設定寫在
`~/.config/mycelium/works.json`，一部作品一個 repo，可以有很多部。
完整用法見 [`skills/mycelium/SKILL.md`](skills/mycelium/SKILL.md)。

---

## 敘事效果庫（`effects/`）

連載小說時讓**頁面本身參與說故事**：讀者不是讀到世界在劣化，是他的畫面在劣化。
複製 `effects/mycelium-fx.js` 與 `effects/mycelium-fx.css` 兩個檔案就能用在任何部落格。

寫文章時只標 `data-fx` 屬性：

```html
<section data-fx="eyelid">                    <!-- 睜眼：全黑一條縫，捲動後展開 -->
<p data-fx="freeze" data-fx-ms="240">          <!-- 凍結：短暫吃掉捲動輸入 -->
<div data-fx="drag" data-fx-factor="1.8">      <!-- 阻力：捲動變重（上限 3） -->
<div data-fx="afterimage" data-fx-opacity=".035"><!-- 殘影：固定不動的內容複本 -->
<p data-fx="scramble" data-fx-level="0.25">    <!-- 亂序：字序視覺打亂，DOM 仍是原文 -->
<p data-fx="stutter" data-fx-times="3">        <!-- 重複：同段遞增重複 -->
```

`freeze` 是**上膛→擊發**：進入視窗只上膛，下一次捲動輸入才擊發，
所以讀者停下來讀多久都不會把效果白白用掉。

無障礙與韌性是硬性的：`prefers-reduced-motion: reduce` 全部關閉、
鍵盤捲動與捲軸拖曳絕不攔截、關掉 JS 一樣讀得完整篇、
`scramble` 的 DOM 永遠是正確原文、`[data-fx-toggle]` 是記在 localStorage 的全站關閉開關。

**任何需要讀者主動輸入才會前進的效果，都必須同時有「提示」與「自動前進的保險」**——
目前只有 `eyelid` 屬於這類（全黑一條縫，不捲就一直是黑的）：約 2.5 秒後浮出一個很淡的
向下 chevron，約 7 秒後開始自己緩緩展開（呼吸速度，不是瞬間跳開），任何捲動輸入隨時
接管、提示淡出。之後加新效果如果也需要讀者動作才會繼續，這條規則一樣適用（見
`effects/mycelium-fx.js` 檔頭的硬性原則第 6 條）。

**示範頁（可即時拉滑桿調參數）：<https://yazelin.github.io/mycelium/>**
手感這種東西看說明是判斷不出來的，要自己捲一次。

### 場景與聲音（選用模組）

場景與聲音是兩個較重的選用模組，各自獨立載入：

```html
<script src="effects/mycelium-fx.js"></script>              <!-- 要三支一起用的話，這支放最前面 -->
<script src="effects/mycelium-scenery.js" defer></script>   <!-- 場景背景 -->
<script src="effects/mycelium-audio.js" defer></script>     <!-- 環境配樂 -->
```

`mycelium-fx.js` 會直接接管 `MyceliumFX` 這個命名空間，所以它要在另外兩支之前載入，
`MyceliumFX.scenery` 與 `MyceliumFX.ambientPreset` 才會在。只用其中一支的話沒有這個限制。

這兩個模組跟既有效果一樣聽 `[data-fx-toggle]`：讀者關掉全站效果時，場景背景與環境層
一起收掉、迫升停在 0、粒子停住，配樂一律靜音。配樂另外有自己的靜音偏好（只想關聲音、
視覺留著），但那是從屬的：全站開關開著的時候才輪到它決定。

```html
<!-- 場景背景：一張自帶天空的圖，捲到錨點時從底部迫升 -->
<div data-fx="scenery" data-fx-src="場景.webp" data-fx-anchor=".situp"
     data-fx-rise="44" data-fx-motes="90" data-fx-leaves="10" data-fx-shade="1"></div>

<!-- 環境配樂・好聽（用你自己的 CC 音檔，無縫循環） -->
<div data-fx="ambient" data-fx-src="ambient.mp3" data-fx-fade="5"
     data-fx-eq="#eq" data-fx-eqdata="…離線頻譜 base64…"></div>

<!-- 環境配樂・不用檔案（即時合成，音色較單薄但零授權、無限不重複） -->
<div data-fx="ambient" data-fx-preset="soft-f" data-fx-eq="#eq"></div>
```

自訂合成預設：

```js
MyceliumFX.ambientPreset('mytune', { bpm, chords, bass, scale, melody });
```

### 素材生成食譜（作者端一次性，不進 code）

**場景圖**（給 `data-fx-src`）——用 codex-imagegen 產一張自帶天空的插畫，上緣淡到近白好接頁面：

> 提示詞要點：意識界／輕小說風、低視角、自帶天空且頂端近白、單張全景、無人物文字。生出後可選在本機去背或直接用不透明圖。

**loop 波形頻譜**（給 `data-fx-eqdata`，供 `file://` 顯示波形）——`file://` 下 AnalyserNode 讀不到媒體檔頻譜，所以離線先算好：

```python
# ffmpeg 解碼 → 每 1/20 秒取 32 條對數分頻（60Hz–8kHz）→ log 壓縮 → base64
# （完整腳本見 docs；產出的字串貼進 data-fx-eqdata）
```

**合成配樂參數**（給 `ambientPreset`）——若想仿某首 CC 曲的調性，可用 ffmpeg + numpy 對該曲做 chroma／onset 分析抽出 bpm、和弦、旋律骨架。這只是作曲前置，抽出來的是通用音樂參數。

## 本地開發

```bash
npm install
npx playwright install chromium
npm run serve      # 另開一個 terminal，http://127.0.0.1:8919
npm test           # Playwright：敘事效果庫的行為契約
npm run test:skill # agent skill 的腳本測試（不需要瀏覽器）
```

沒有 build 步驟，改完存檔重整就看得到。

設計文件：[`docs/superpowers/specs/2026-07-22-mycelium-design.md`](docs/superpowers/specs/2026-07-22-mycelium-design.md)
——最後一段記錄了「網頁是主介面」這個原始前提怎麼被實際使用推翻。

## 作者

[yazelin](https://yazelin.github.io/) — [GitHub](https://github.com/yazelin) | [Facebook](https://www.facebook.com/yaze.lin.gm) | [Buy me a coffee](https://buymeacoffee.com/yazelin)

## 授權

MIT © 林亞澤，見 LICENSE。
