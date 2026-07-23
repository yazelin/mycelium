---
name: mycelium
description: 在終端機幫忙寫長篇小說：讀作品的設定庫/關係/伏筆/大綱回答一致性問題、直接改設定（角色、章節狀態、伏筆、關係都能改/加/刪）、把新章節抽成設定候選（含別名合併判斷）、帶著全部設定討論劇情與反轉、批量匯入舊稿、把人物關係匯出成可離線開的關係圖 HTML。當使用者提到自己的小說/作品設定、問「某角色目前設定是什麼」「哪些伏筆還沒回收」「這段跟前面有沒有矛盾」、說「幫我把某角色改成…」「這章寫完了」「這個伏筆回收了」、丟一章要抽設定、說「關係我理不清」「畫張關係圖」、或要把散在別處的設定大綱匯進來時使用。改東西一律先自動快照，隨時可還原。
---

# mycelium：小說設定的終端機介面

mycelium 是長篇小說的設定管理工具（設定庫、人物關係、大綱、伏筆追蹤）。
一部作品的資料就是**使用者自己的 private repo 裡的 `data/*.json`**——沒有伺服器、
沒有資料庫、沒有第二份主本。那份 repo 就是你（agent）唯一的接點。

你的工作分兩層：

- **機械的部分交給腳本**：抓資料、解析、組 prompt、驗證格式、寫提案、做快照。
- **你負責判斷**：一致性、矛盾、別名是不是同一個人、劇情發想。

所以每個指令的節奏都是：先跑腳本拿資料 → 你動腦 → 需要落地時再跑腳本寫出去。

## 分工

| 介面 | 負責 |
|---|---|
| **這個 skill（對話）** | 全部：問設定、發想、抽取、**修改** |
| **`mycelium graph`** | 唯一的視覺面：把人物關係匯成一個可離線開的 HTML |
| **使用者的編輯器** | 寫正文。mycelium 不搶這件事 |

改設定不用叫使用者開任何網頁。他在對話裡說「把城主的設定補成這樣」，
那句話本身就是確認，直接改下去。

這裡曾經有一個網頁 app，2026-07 收掉了（#34）：實際使用下來，設定瀏覽、編輯、
備份、提案審核，在對話裡全部更快；只有「誰跟誰糾纏」的空間佈局講不清楚，
那一件事留成了 `graph` 指令。

## 寫入模式

| 情況 | 做法 |
|---|---|
| 使用者說「改成…」「這章寫完了」「這個伏筆回收了」「加一個角色」「把這筆刪掉」 | `edit` / `add` / `rm`：**直接寫**。寫入前自動快照，輸出會告訴你快照在哪、怎麼還原。 |
| 使用者說「我想先看看再決定」 | 同樣的指令加 `--dry-run`，只算給他看，什麼都不寫。 |
| 一整批抽取結果（一章抽出十幾個候選） | `propose`：寫成 `proposals/<timestamp>.json`，逐項唸給使用者確認，他點頭再 `apply`。 |
| 批量匯入舊稿 | `apply ... --yes`。 |

直接寫之所以安全，是因為**每一次寫入前都會先快照**（本機 + repo 各一份），
而且 `snapshots` / `diff` / `restore` 讓反悔只要一行指令。所以每次寫完，
一定要把「快照時間戳」跟「怎麼還原」講給使用者聽。

不確定使用者是不是真的要改（例如他只是在發想、在問「如果改成這樣會怎樣」），
就先問一句，別動手。討論階段不要寫任何東西。

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

## 用法

以下所有指令的工作目錄都是這個 skill 目錄（`~/.claude/skills/mycelium`）。

### 1. 一致性檢查 / 問設定

```bash
node scripts/mycelium.mjs pull                 # 先抓最新（每個讀指令也會自動抓）
node scripts/mycelium.mjs context              # 整部作品壓成一段的設定區塊
node scripts/mycelium.mjs entity 林小雨         # 單一角色：別名、關係、相關伏筆、出現章節
node scripts/mycelium.mjs foreshadow --open    # 還沒回收的伏筆（含逾期標記）
node scripts/mycelium.mjs chapters             # 卷章結構與字數
```

拿到輸出之後由你回答。回答「這段跟前面矛盾嗎」時：先 `context`，再讀使用者給的
段落，逐條指出衝突的是哪一筆設定（引用名字與該筆的 notes），不要含糊說「好像有點怪」。
找不到根據就說找不到，不要腦補設定。

`--cached` 可以只用本機快取不連網（適合連續問很多題）。

### 2. 改設定

`edit` 一律走「保留 id」的路徑（`{ ...既有紀錄, 欄位 }`）。**絕對不要**用
「刪掉再重建」來達成修改：換了 id 等於把指向它的伏筆變成孤兒、把它身上的關係
連帶刪光。

```bash
# 角色：補設定、改類型、加/退別名、標籤、自訂欄位、改名
node scripts/mycelium.mjs edit entity 城主 --notes "東境三大勢力之首" --type 勢力
node scripts/mycelium.mjs edit entity 城主 --add-alias 黑袍人 --field 據點=東境城
node scripts/mycelium.mjs edit entity 城主 --rename 東境城主 --rm-alias 黑袍人 --rm-field 據點

# 章節：狀態、標題、卷、字數、摘要、正文
node scripts/mycelium.mjs edit chapter 雨夜 --status 完稿 --wordcount 3200
node scripts/mycelium.mjs edit chapter 雨夜 --title 雨夜之後 --summary "林小雨初遇白衣客"
node scripts/mycelium.mjs edit chapter 雨夜 --content-file ~/novel/第1章.txt

# 伏筆：狀態、埋設/回收章、關聯角色與關係
node scripts/mycelium.mjs edit foreshadow 林小雨的真實身份 --status 已回收
node scripts/mycelium.mjs edit foreshadow 林小雨的真實身份 --plant 雨夜 --recover 追兵
node scripts/mycelium.mjs edit foreshadow 林小雨的真實身份 --link-entity 城主 --plant none

# 關係
node scripts/mycelium.mjs edit relation "落雨劍客>林小雨" --type 師徒 --notes "第一章拜師"
```

新增：

```bash
node scripts/mycelium.mjs add entity 白衣客 --type 人物 --notes "雨夜裡替林小雨擋刀的陌生人"
node scripts/mycelium.mjs add chapter --title 追兵 --volume 1 --status 草稿 --wordcount 2100
node scripts/mycelium.mjs add foreshadow --title 白衣客的傘 --plant 追兵 --link-entity 白衣客
node scripts/mycelium.mjs add relation --source 白衣客 --target 林小雨 --type 護衛
```

刪除（**會先把要刪的東西整份印出來**再動手）：

```bash
node scripts/mycelium.mjs rm entity 城主        # 連帶刪掉它身上所有關係
node scripts/mycelium.mjs rm chapter 追兵       # 正文一起消失，只能靠快照救
node scripts/mycelium.mjs rm foreshadow 白衣客的傘
node scripts/mycelium.mjs rm relation "白衣客>林小雨"
```

指名方式：角色可以用名字、**別名**或 id；章節、伏筆可以用標題或 id；關係用 id 或
`"來源>目標"`。名字對到多筆時腳本會列出來要你改用 id，不會自己猜。

重複的選項可以給很多次：`--add-alias 白衣客 --add-alias 落雨劍客`。
全部指令都吃 `--dry-run`（只算給人看，不寫）。

### 反悔

```bash
node scripts/mycelium.mjs snapshots              # 有哪些快照、各 store 幾筆
node scripts/mycelium.mjs diff                   # 現況 vs 最近一份快照
node scripts/mycelium.mjs diff 20260722-101530   # 跟指定那份比
node scripts/mycelium.mjs restore 20260722-101530  # 還原（還原前也會先存一份現況）
```

`restore` 本身也是一次寫入，所以它一樣先快照——還原錯了還可以再還原回來。

### 3. 丟章節進來自動抽設定

```bash
node scripts/mycelium.mjs extract-prompt --text /path/to/第12章.txt          # 人看的
node scripts/mycelium.mjs extract-prompt --text /path/to/第12章.txt --json   # 餵 API 的 messages
```

這會印出 system prompt 與 user message（含既有角色名單）。
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

### 4. 劇情發想 / 反轉討論

```bash
node scripts/mycelium.mjs context
node scripts/mycelium.mjs foreshadow --open
```

帶著這兩份東西討論。發想時的原則：

- 反轉要**接得住既有伏筆**，優先回收 `--open` 列出來的那些，而不是憑空生新謎題。
- 提出的每個方向都要講「這會影響到哪些既有設定」。
- 討論階段**不要寫任何東西**。談定了、使用者說「這個記下來」，才把結論整理成候選
  JSON 走 `propose`。

### 5. 批量整理 / 匯入舊稿

把散在別處的設定、大綱、舊稿整理成候選 JSON，一樣走 `propose`（可以很大一包）。

章節本身（卷、章名、字數、摘要、內文）不在候選格式裡：抽取候選只有角色/關係/
伏筆三種。要一次匯入一整份章節清單，那是「直接寫」的範圍：

```bash
node scripts/mycelium.mjs apply candidates.json --chapters chapters.json --yes
```

候選裡出現**已經存在的名字**（本名或別名）時，預設是「略過、不重複建立」——這個
工具存在的理由就是同一個角色不能被記成兩個。要拿候選去補既有角色的設定，加
`--update-existing`：走跟 `edit` 同一條保留 id 的路徑，關係與伏筆連結都不會斷。

`chapters.json` 是章節物件的陣列：`{"volume":1,"title":"雨夜","status":"未寫","wordCount":3200,"summary":"…","content":"…"}`。
一樣會先自動快照。沒有使用者明講就不要用這條。

### 6. 匯出人物關係圖

```bash
node scripts/mycelium.mjs graph                       # 寫到本機快取，印出路徑
node scripts/mycelium.mjs graph --out ~/桌面/關係.graph.html
```

產出是一個**自帶樣式與 cytoscape 的單一 HTML**：點兩下就開，不連網、不用伺服器。
節點大小＝牽連多寡、形狀與顏色＝類型，點一個角色會只留下他的糾纏並展開他的設定。

什麼時候該主動提議跑它：使用者問「這幾個人的關係我有點理不清」「誰跟誰有牽扯」，
或是剛一次加了好幾條關係。清單講三分鐘的東西，圖三秒就看完。

⚠ **這個檔案裡是整部作品的設定與伏筆。** 預設寫在本機快取（`~/.cache/mycelium-skill/`），
指令會拒絕寫進任何「有 remote 的 git 工作目錄」——推上去就是公開。
使用者堅持要寫進去才加 `--force`，而且要先確認那裡有被 `.gitignore` 蓋到。

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
  `entities`、`relations`、`foreshadow` 三個欄位就好。
- prompt 與候選格式的單一事實來源是 `scripts/extract-prompt.mjs`，**不存在第二套契約**。
- 直接寫入前後都會驗證整份資料（`scripts/schema.mjs` 的
  `isValidProjectData` / `isPlainRecord`）：五個 store 都在、每筆都是普通物件。
- 快照：`snapshots/<timestamp>/*.json` 在 repo 裡，同一份也存在本機
  `~/.cache/mycelium-skill/<owner>__<repo>/snapshots/<timestamp>/`。還原就是把它們
  覆蓋回 `data/`（`restore` 就是做這件事）。
- 順序是固定的：**先驗證**（算不出來就整個中止，一個字都不寫，也不留垃圾快照）
  →**再快照**（所以快照裡永遠是「改動之前」的狀態）→**才寫入**。
- 章節排序、伏筆逾期判斷、刪 entity 的連帶範圍、狀態列舉，全部來自
  `scripts/records.mjs`，沒有第二套規則。

## 安裝

```bash
git clone https://github.com/yazelin/mycelium ~/mycelium     # 已經有就跳過
ln -s ~/mycelium/skills/mycelium ~/.claude/skills/mycelium
```

不綁 Claude：其他 agent（Codex / Gemini）讀這份 SKILL.md 照著跑腳本即可。
需求：`node` 18+、`gh` 且已 `gh auth login`。零 npm 依賴。

自我測試：

```bash
cd ~/mycelium && npm run test:skill
```

## 界線

- 使用者說要改才改。他在發想、在問「如果…會怎樣」的時候不要動資料。
- 每次寫完都要講：改了什麼、快照時間戳、怎麼還原。
- 不要幫使用者決定設定的內容；提案的 `reason` 要誠實寫「文中哪裡看到的」。
- 找不到資料就說找不到。不要憑印象講某角色的設定。

MIT © 林亞澤
