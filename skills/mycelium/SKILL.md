---
name: mycelium
description: 在終端機幫忙寫長篇小說：讀作品的設定庫/關係/伏筆/大綱回答一致性問題、把新章節抽成設定候選（含別名合併判斷）、帶著全部設定討論劇情與反轉、批量匯入舊稿。當使用者提到自己的小說/作品設定、問「某角色目前設定是什麼」「哪些伏筆還沒回收」「這段跟前面有沒有矛盾」、丟一章要抽設定、或要把散在別處的設定大綱匯進來時使用。預設只產生提案，不直接改資料。
---

# mycelium：小說設定的終端機介面

mycelium 是一個網頁版的長篇小說設定工具（設定庫、人物關係圖、大綱、伏筆追蹤）。
作品資料的主本在**瀏覽器的 IndexedDB**，使用者按「同步到 GitHub」把它備份到一個
自己的 private repo 的 `data/*.json`。**那份 repo 就是你（agent）唯一的接點。**

你的工作分兩層：

- **機械的部分交給腳本**：抓資料、解析、組 prompt、驗證格式、寫提案、做快照。
- **你負責判斷**：一致性、矛盾、別名是不是同一個人、劇情發想。

所以每個指令的節奏都是：先跑腳本拿資料 → 你動腦 → 需要落地時再跑腳本寫出去。

## 寫入模式（最重要的一段，不要跳過）

**預設＝提案，不是寫入。**

| 情況 | 做法 |
|---|---|
| 一般狀況（沒特別交代） | `propose`：寫成 repo 的 `proposals/<timestamp>.json`，`data/*.json` 一個字都不動。使用者之後在網頁上逐項勾選才會真的進設定庫。 |
| 使用者**明講**「直接寫」「直接改資料」「幫我寫進去」 | `apply ... --yes`：腳本會**先自動快照**再寫，並印出快照位置。 |

為什麼這麼龜毛：主本在瀏覽器。如果你在他還有沒同步的修改時蓋掉 `data/*.json`，
他之後按一次「從 GitHub 匯入」就會把自己的稿子洗掉。這個 app 已經為了同一類
資料遺失修過好幾個 bug，不要再貢獻一個。

直接寫完之後，一定要告訴使用者兩件事：快照在哪、以及「瀏覽器裡若還有沒同步的
修改，請先在網頁同步一次再匯入」。

## 設定作品

一個 skill 服務多部作品，一部作品一個 repo。三種指定方式，任選：

```bash
node scripts/mycelium.mjs pull --repo yourname/your-novel-repo   # 直接指定
MYCELIUM_REPO=yourname/your-novel-repo node scripts/mycelium.mjs pull
node scripts/mycelium.mjs pull --work 落雨                        # 用設定檔的名字
```

設定檔 `~/.config/mycelium/works.json`：

```json
{
  "default": "落雨",
  "works": {
    "落雨": "yourname/your-novel-repo",
    "另一部": "yourname/another-novel"
  }
}
```

repo 存取一律走 `gh`（使用者本來就登入過），**不要跟使用者要 PAT**。
`node scripts/mycelium.mjs works` 可以看目前設定了哪些作品。

## 四種用法

以下所有指令的工作目錄都是這個 skill 目錄（`~/.claude/skills/mycelium`）。

### 1. 一致性檢查 / 問設定

```bash
node scripts/mycelium.mjs pull                 # 先抓最新（每個讀指令也會自動抓）
node scripts/mycelium.mjs context              # 跟網頁 AI 看到的一模一樣的設定區塊
node scripts/mycelium.mjs entity 林小雨         # 單一角色：別名、關係、相關伏筆、出現章節
node scripts/mycelium.mjs foreshadow --open    # 還沒回收的伏筆（含逾期標記）
node scripts/mycelium.mjs chapters             # 卷章結構與字數
```

拿到輸出之後由你回答。回答「這段跟前面矛盾嗎」時：先 `context`，再讀使用者給的
段落，逐條指出衝突的是哪一筆設定（引用名字與該筆的 notes），不要含糊說「好像有點怪」。
找不到根據就說找不到，不要腦補設定。

`--cached` 可以只用本機快取不連網（適合連續問很多題）。

### 2. 丟章節進來自動抽設定

```bash
node scripts/mycelium.mjs extract-prompt --text /path/to/第12章.txt          # 人看的
node scripts/mycelium.mjs extract-prompt --text /path/to/第12章.txt --json   # 餵 API 的 messages
```

這會印出**跟網頁 app 完全同一份**的 system prompt 與 user message（含既有角色名單）。
你可以直接照著它自己判斷，或把 `--json` 的 messages 丟給任何模型。

輸出必須是那份 prompt 指定的 JSON：

```json
{
  "entities": [
    {"name": "城主", "aliasOf": null, "type": "人物", "notes": "追殺主角的勢力領袖", "reason": "首次登場的新角色"},
    {"name": "黑袍人", "aliasOf": "城主", "type": null, "notes": null, "reason": "本章揭露城主就是黑袍人"}
  ],
  "relations": [
    {"source": "林小雨", "target": "城主", "type": "追殺", "reason": "城主軍全境追殺林小雨"}
  ],
  "foreshadow": [
    {"title": "林小雨的真實身份", "notes": "暗示她是城主早年的徒弟", "reason": "城主的台詞埋了伏筆"}
  ]
}
```

**別名合併是這個工具存在的理由**：身分反轉（某角色其實就是另一個角色）不可以被
記成兩個人。判斷是既有角色的新稱號時，`aliasOf` 填**既有名單裡完全相符的 name**；
真的是新角色才填 `null`。每一筆的 `reason` 都要寫，那是使用者勾選時唯一的依據。

存成 `candidates.json` 之後：

```bash
node scripts/mycelium.mjs validate candidates.json                       # 先驗格式
node scripts/mycelium.mjs propose candidates.json --source "第12章"       # 產生提案
```

### 3. 劇情發想 / 反轉討論

```bash
node scripts/mycelium.mjs context
node scripts/mycelium.mjs foreshadow --open
```

帶著這兩份東西討論。發想時的原則：

- 反轉要**接得住既有伏筆**，優先回收 `--open` 列出來的那些，而不是憑空生新謎題。
- 提出的每個方向都要講「這會影響到哪些既有設定」。
- 討論階段**不要寫任何東西**。談定了、使用者說「這個記下來」，才把結論整理成候選
  JSON 走 `propose`。

### 4. 批量整理 / 匯入舊稿

把散在別處的設定、大綱、舊稿整理成候選 JSON，一樣走 `propose`（可以很大一包）。

章節本身（卷、章名、字數、摘要、內文）不在候選格式裡，因為 app 的抽取候選只有
角色/關係/伏筆三種。要一次匯入一整份章節清單，那是「直接寫」的範圍：

```bash
node scripts/mycelium.mjs apply candidates.json --chapters chapters.json --yes
```

`chapters.json` 是章節物件的陣列：`{"volume":1,"title":"雨夜","status":"未寫","wordCount":3200,"summary":"…","content":"…"}`。
一樣會先自動快照。沒有使用者明講就不要用這條。

## 其他指令

```bash
node scripts/mycelium.mjs snapshot     # 手動存一份快照（動手之前想保險就跑）
node scripts/mycelium.mjs proposals    # 列出 repo 裡現有的提案檔
node scripts/mycelium.mjs known        # 既有角色名單
node scripts/mycelium.mjs --help
```

`propose --dry-run` 只在本機快取寫一份，不推 GitHub，適合先給使用者看內容。

## 產出的格式契約

- 提案檔 `proposals/<timestamp>.json` ＝ 抽取候選的三個陣列放在最上層，外加
  `version` / `generatedAt` / `source` / `note` / `agent`。讀的人拿
  `result.entities`、`result.relations`、`result.foreshadow`，跟 app 處理 AI 回傳
  的物件完全一樣。
- prompt 與候選格式的單一事實來源是 repo 根目錄的 `extract-prompt.js`，腳本直接
  import 它，**不存在第二套契約**。
- 直接寫入前後都會用 app 匯入器的同一組規則驗證（`backup.js` 的
  `isValidProjectData` / `isPlainRecord`），確保 skill 產出的檔案不會讓 app 噎到。
- 快照：`snapshots/<timestamp>/*.json` 在 repo 裡，同一份也存在本機
  `~/.cache/mycelium-skill/<owner>__<repo>/snapshots/<timestamp>/`。還原就是把它們
  覆蓋回 `data/`。

## 安裝

```bash
git clone https://github.com/yazelin/mycelium ~/mycelium     # 已經有就跳過
ln -s ~/mycelium/skills/mycelium ~/.claude/skills/mycelium
```

不綁 Claude：其他 agent（Codex / Gemini）讀這份 SKILL.md 照著跑腳本即可。
需求：`node` 18+、`gh` 且已 `gh auth login`。零 npm 依賴。

自我測試（不需要瀏覽器）：

```bash
cd ~/mycelium && npm run test:skill
```

## 界線

- 沒有使用者明講就**不要**動 `data/*.json`。
- 不要幫使用者決定設定的內容；提案的 `reason` 要誠實寫「文中哪裡看到的」。
- 找不到資料就說找不到。不要憑印象講某角色的設定。

MIT © 林亞澤
