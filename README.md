# mycelium

一個 **agent skill** ＋ 一個 **敘事效果庫**。都是零依賴、沒有 build 步驟。

菌絲網路連結整片森林裡的樹；mycelium 連結你多部作品各自的設定資料網。

| | 是什麼 | 給誰 |
|---|---|---|
| [`skills/mycelium/`](skills/mycelium/SKILL.md) | 長篇小說的設定管理，全部在終端機對話裡完成 | 寫長篇的人 ＋ 他的 agent |
| [`effects/`](https://yazelin.github.io/mycelium/) | 捲動驅動的敘事效果庫（`mycelium-fx`） | 在網頁上連載小說的人 |

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
<script src="effects/mycelium-scenery.js" defer></script>   <!-- 場景背景 -->
<script src="effects/mycelium-audio.js" defer></script>     <!-- 環境配樂 -->
```

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
