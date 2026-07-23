---
name: mycelium
description: 在終端機幫忙寫長篇小說：讀作品的設定庫/關係/伏筆/大綱回答一致性問題、直接改設定（角色、章節狀態、伏筆、關係都能改/加/刪）、把新章節抽成設定候選（含別名合併判斷）、帶著全部設定討論劇情與反轉、批量匯入舊稿。當使用者提到自己的小說/作品設定、問「某角色目前設定是什麼」「哪些伏筆還沒回收」「這段跟前面有沒有矛盾」、說「幫我把某角色改成…」「這章寫完了」「這個伏筆回收了」、丟一章要抽設定、或要把散在別處的設定大綱匯進來時使用。改東西一律先自動快照，隨時可還原。
---

# mycelium：小說設定的終端機介面

mycelium 是一個網頁版的長篇小說設定工具（設定庫、人物關係圖、大綱、伏筆追蹤）。
作品資料的主本在**瀏覽器的 IndexedDB**，使用者按「同步到 GitHub」把它備份到一個
自己的 private repo 的 `data/*.json`。**那份 repo 就是你（agent）唯一的接點。**

你的工作分兩層：

- **機械的部分交給腳本**：抓資料、解析、組 prompt、驗證格式、寫提案、做快照。
- **你負責判斷**：一致性、矛盾、別名是不是同一個人、劇情發想。

所以每個指令的節奏都是：先跑腳本拿資料 → 你動腦 → 需要落地時再跑腳本寫出去。

## 分工：對話是主要工作面，網頁是參考面

| 介面 | 負責 |
|---|---|
| **這個 skill（對話）** | 主要工作面：問設定、發想、抽取、**修改** |
| **網頁** | 參考面：關係圖、瀏覽設定、勾選提案 |
| **使用者的編輯器** | 寫正文。mycelium 不搶這件事 |

所以「改設定」不用叫使用者開瀏覽器。他在對話裡說「把城主的設定補成這樣」，
那句話本身就是確認，直接改下去。

## ⚠ 每次寫入之後：瀏覽器那一份就過期了

這是新分工下**最容易毀掉資料的一步**，每次寫入都要跟使用者講：

1. 下次開網頁，第一件事是按「**從 GitHub 匯入**」。
2. 匯入之前，**絕對不要**按「同步到 GitHub」——瀏覽器裡是舊資料，一按就把剛剛
   在對話裡改的東西整份蓋掉，而且蓋掉的是使用者自己剛剛要求的修改。
3. 如果瀏覽器裡還有**沒同步過**的修改（例如剛在網頁上打了一段正文還沒按同步），
   先停下來問使用者，用 `diff` 比對過再決定留哪一份，不要自己決定。

腳本每次寫入都會自己印這段警告；你在回話時**也要**用自己的話講一次，不要只讓它
淹沒在指令輸出裡。

## 寫入模式

| 情況 | 做法 |
|---|---|
| 使用者說「改成…」「這章寫完了」「這個伏筆回收了」「加一個角色」「把這筆刪掉」 | `edit` / `add` / `rm`：**直接寫**。寫入前自動快照，輸出會告訴你快照在哪、怎麼還原。 |
| 使用者說「我想先看看再決定」 | 同樣的指令加 `--dry-run`，只算給他看，什麼都不寫。 |
| 一整批抽取結果（一章抽出十幾個候選） | `propose`：寫成 `proposals/<timestamp>.json`，由使用者在網頁上逐項勾選。 |
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
node scripts/mycelium.mjs context              # 跟網頁 AI 看到的一模一樣的設定區塊
node scripts/mycelium.mjs entity 林小雨         # 單一角色：別名、關係、相關伏筆、出現章節
node scripts/mycelium.mjs foreshadow --open    # 還沒回收的伏筆（含逾期標記）
node scripts/mycelium.mjs chapters             # 卷章結構與字數
```

拿到輸出之後由你回答。回答「這段跟前面矛盾嗎」時：先 `context`，再讀使用者給的
段落，逐條指出衝突的是哪一筆設定（引用名字與該筆的 notes），不要含糊說「好像有點怪」。
找不到根據就說找不到，不要腦補設定。

`--cached` 可以只用本機快取不連網（適合連續問很多題）。

### 2. 改設定（不用開瀏覽器）

`edit` 一律走「保留 id」的路徑（`{ ...既有紀錄, 欄位 }`）。**絕對不要**用
「刪掉再重建」來達成修改：換了 id 等於把指向它的伏筆變成孤兒、把它身上的關係
連帶刪光。網頁那邊為了這件事修過一輪，這裡不可以走回頭路。

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
node scripts/mycelium.mjs rm entity 城主        # 連帶刪掉它身上所有關係（跟網頁同一條規則）
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

章節本身（卷、章名、字數、摘要、內文）不在候選格式裡，因為 app 的抽取候選只有
角色/關係/伏筆三種。要一次匯入一整份章節清單，那是「直接寫」的範圍：

```bash
node scripts/mycelium.mjs apply candidates.json --chapters chapters.json --yes
```

候選裡出現**已經存在的名字**（本名或別名）時，預設是「略過、不重複建立」——這個
工具存在的理由就是同一個角色不能被記成兩個。要拿候選去補既有角色的設定，加
`--update-existing`：走跟 `edit` 同一條保留 id 的路徑，關係與伏筆連結都不會斷。

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
  覆蓋回 `data/`（`restore` 就是做這件事）。
- 順序是固定的：**先驗證**（算不出來就整個中止，一個字都不寫，也不留垃圾快照）
  →**再快照**（所以快照裡永遠是「改動之前」的狀態）→**才寫入**。
- 章節排序、伏筆逾期判斷、刪 entity 的連帶範圍、狀態列舉，全部來自 repo 根目錄的
  `records.js`，網頁與 skill 共用同一份，沒有第二套規則。

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

- 使用者說要改才改。他在發想、在問「如果…會怎樣」的時候不要動資料。
- 每次寫完都要講：改了什麼、快照時間戳、以及上面那段「瀏覽器已過期」的提醒。
- 不要幫使用者決定設定的內容；提案的 `reason` 要誠實寫「文中哪裡看到的」。
- 找不到資料就說找不到。不要憑印象講某角色的設定。

MIT © 林亞澤
