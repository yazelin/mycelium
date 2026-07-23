# 效果庫擴充：場景背景與環境配樂 設計文件

**日期**：2026-07-24
**狀態**：設計定案，待實作

## 一句話

把序章閱讀頁裡驗證過的兩套技術——捲動迫升的場景背景、即時合成的環境配樂——從單檔抽出來，收成 `effects/` 底下兩個可重用、宣告式（`data-fx`）、純技術不含劇情的選用模組。

## 背景與動機

現有效果庫（`effects/mycelium-fx.js`）是六個小巧的文字／捲動效果（drag、freeze、afterimage、eyelid、scramble、stutter），共通型是：宣告式 `data-fx` 屬性、漸進增強、`prefers-reduced-motion` 全關、DOM 永遠保留原文。

序章閱讀頁另外做出兩套更大的東西，目前只活在那個單檔 HTML 裡：

1. **場景背景**：一張自帶天空的插畫，用捲動從畫面底部迫升，配上塵粒、落葉、雲影等環境層。
2. **環境配樂**：不放音檔，用 Web Audio 即時合成一段循環不重複的音樂，右上角一顆開關，並可把即時波形畫成一條折線。

這兩套是別的作品（甚至別人）也用得到的通用能力，但它們不是文字效果，而是「環境」，所以不能硬塞進原本的小效果骨架，需要各自成模組。

## 硬性隔離：技術進庫、劇情不進庫

`mycelium` 是**公開** repo（GitHub Pages）。這一輪只搬技術：

- demo、預設、README 一律用**中性示範素材**。
- **不放**序章任何文字。
- **不放**序章那張特定背景圖；場景模組吃的是「任一張圖」，圖由各作品自己生。圖的生成只在 README 寫食譜（codex-imagegen 提示詞），不進 code。
- 配樂內附一個中性預設「soft-f」（F 大調，音樂參數而非任何作品專屬旋律）。從參考曲抽參數的做法只寫進 README，不進 code。

## 打包方式（已與作者確認）

沿用現有的宣告式 `data-fx` API，但音訊與 canvas 較重，拆成**選用檔**，要用才載入：

| 檔案 | 內容 | 變動 |
|---|---|---|
| `effects/mycelium-fx.js` | 既有六個文字效果 | 不動 |
| `effects/mycelium-fx.css` | 既有樣式 | 追加場景層與開關樣式 |
| `effects/mycelium-scenery.js` | 場景背景 | **新增** |
| `effects/mycelium-audio.js` | 環境配樂＋波形 | **新增** |
| `effects/demo.html` | 示範頁 | 追加兩段 |
| `README.md` | 說明 | 追加兩條用法＋兩則生成食譜 |
| `tests/effects.spec.js` | Playwright | 追加場景與配樂的測試 |

每個新檔各自是一個 IIFE，載入即自動掃描對應的 `data-fx`，跟現有檔一致。三個 JS 檔彼此獨立，可各自單獨載入。

## 模組一：`scenery`（場景背景）

### 用法

```html
<div data-fx="scenery"
     data-fx-src="assets/scene.webp"   一張圖：自帶天空、上緣淡出到近白
     data-fx-anchor=".situp"           這個元素進入視野時，背景開始迫升
     data-fx-rise="44"                 最終露出高度（vh），預設 44
     data-fx-motes="90"                塵粒數，0 = 關，預設 0
     data-fx-leaves="10"               落葉數，0 = 關，預設 0
     data-fx-shade="1"></div>          雲影 0/1，預設 0
```

### 行為

- 建立固定全視窗的背景層（`position: fixed; inset: 0`），把 `data-fx-src` 的圖以 `cover` 貼在底部。
- 用一道由下往上的 CSS 遮罩（`mask-image` linear-gradient）控制露出高度；遮罩的露出百分比由 `--rev` 這個 CSS 變數驅動。
- 監看 `data-fx-anchor` 指的元素：它從視窗底部往上捲的過程，把 `--rev` 從 0% 補到 `rise`%。錨點不存在時，背景直接維持在 `rise`%（靜態）。
- 選用的環境子層：
  - **motes**（塵粒）：canvas，緩慢上飄、微閃、大顆帶柔光暈，集中在畫面下方。
  - **leaves**（落葉）：與 motes 共用同一個 canvas，數片各自隨機大小／速度／旋轉，飄落後回收。
  - **shade**（雲影）：一道極慢橫越的柔和暗帶，`mix-blend-mode: multiply`，上緣遮罩淡出。
- 圖的上緣本身也用遮罩淡出，好接頁面上方的天空或底色。

### reduced-motion

`prefers-reduced-motion: reduce` 時：背景直接完全露出（`--rev: 100%` 對應 rise），不做迫升動畫，不生任何 canvas 粒子，雲影不動。內容照樣可讀。

### 不做

- 不內建生圖。圖是外部素材。
- 不管天空——天空由頁面自己出（漸層或另一層）。場景圖的天空只是為了「上緣有東西可以淡出接合」。
- 不做視差多層。單張圖 + 環境粒子就夠；要多層另議。

## 模組二：`ambient`（環境配樂＋波形）

### 用法

```html
<div data-fx="ambient"
     data-fx-preset="soft-f"    內附預設，預設值 soft-f
     data-fx-eq="#eq"           選用：把即時波形畫到這個 canvas
     data-fx-autostart="1"></div>   選用：使用者上次開過就自動接續（仍需先互動），預設 1
```

進階自訂預設（在載入 `mycelium-audio.js` 之後、頁面自己的 script 裡）：

```js
MyceliumFX.ambientPreset('mytune', {
  bpm: 100,
  chords: [ [349.23,440,523.25], ... ],   每小節一組頻率
  bass:   [174.61, ...],
  melody: [0,0,4,0,5,0,6,0, ...],          64 步，0 = 休止，其餘是音階索引
  scale:  [698.46,783.99,880, ...],        旋律音階（頻率）
  reverb: 2.8, master: 0.55
});
```

### 行為

- 全部即時合成，不載入任何音檔，所以循環不重複、沒有 loop 接點。
- 排程用兩時鐘 lookahead：`setInterval` 走步進計數器，音符一律排在 `ctx.currentTime` 之前 `LOOKAHEAD` 秒；所有增益變化用 context time（`setValueAtTime` / `linearRampToValueAtTime`），不用 `setTimeout`。（做法對齊 Roll Formosa 的 bgm.js。）
- 瀏覽器不允許未經互動自動出聲，所以掛在第一個使用者手勢（wheel / touchstart / keydown / click）上才 resume 並淡入。
- 自動生一顆開關按鈕（右上角，樣式在 CSS）。狀態記在 localStorage（`fx-bgm`）：上次關掉就尊重，不自己開。
- 分頁切走停排程，回來接上，不補排。
- 若 `data-fx-eq` 指到一個 canvas，就掛一個 `AnalyserNode`（fftSize 256、smoothing 0.5），把頻譜畫成一條中線上下跳的折線。

### 內附預設 `soft-f`

一段 F 大調、約 100 BPM、留白多的環境音：和聲 Fmaj7–Cadd9–Dsus4–Am 四小節循環，旋律 64 步稀疏、大量休止，偶爾一顆高八度泛光。這是純音樂參數，不是任何作品的專屬素材。

### reduced-motion / 無障礙

- `prefers-reduced-motion: reduce` 不影響「聲音」本身（聲音不是動態視覺），但波形折線停止繪製（避免持續動畫）。
- 開關按鈕是真的 `<button>`，可鍵盤操作、有 `aria`。
- 預設**不自動出聲**，一定要使用者主動（手勢後才 resume，且 localStorage 沒被關過）。

### 不做

- 不收「從音檔抽參數」的工具（ffmpeg + numpy）進 repo。那是作者端一次性的作曲前置，只寫進 README 當食譜。
- 不做多軌混音介面。就是一段環境床音 + 選用波形。

## 資料流與相依

三個 JS 檔彼此獨立：

```
mycelium-fx.js       ← 文字效果，可單獨用
mycelium-scenery.js  ← 場景，可單獨用（吃圖 + 錨點）
mycelium-audio.js    ← 配樂，可單獨用（Web Audio + 選用 canvas）
mycelium-fx.css      ← 三者共用樣式表（追加場景層、開關）
```

`MyceliumFX` 這個全域命名空間三個檔都可掛（`window.MyceliumFX = window.MyceliumFX || {}`），audio 檔在上面掛 `ambientPreset`。

## 測試（驗收）

新增 Playwright 測試，跟現有 16 個並存：

**scenery**
- demo 的 scenery 區塊載入、無 console 錯誤。
- 捲過錨點後 `--rev` 從 0 變到 rise（背景真的迫升）。
- `prefers-reduced-motion` 時直接 100% 露出、沒有 canvas 粒子節點。
- `data-fx-motes="0"` 時不建塵粒 canvas。

**ambient**
- demo 的 ambient 區塊載入、無 console 錯誤。
- 頁面載入且**未互動**時，沒有 AudioContext 出聲（master gain 為 0 或 context 未建）。
- 點開關後有聲（用 AnalyserNode 讀到波形在動，或 context state 為 running 且 master gain 上升）。
- 開關是可聚焦的 `<button>`。
- `data-fx-eq` 指的 canvas 在播放時有被畫（非全透明像素 > 0）。

**共通**
- demo 整頁載入無 console 錯誤（沿用現有那條，涵蓋三個檔）。
- 關掉 JS 仍可讀完整篇 demo（漸進增強）。

## 檔案結構總覽

```
effects/
  mycelium-fx.js        （不動）
  mycelium-scenery.js   （新增，~180 行）
  mycelium-audio.js     （新增，~220 行）
  mycelium-fx.css       （追加 scenery 層 + 開關樣式）
  demo.html             （追加 scenery、ambient 兩段）
tests/
  effects.spec.js       （追加 scenery、ambient 測試）
README.md               （追加兩條用法 + 兩則食譜）
docs/superpowers/
  specs/2026-07-24-scenery-audio-design.md   （本文件）
  plans/2026-07-24-scenery-audio.md          （下一步）
```

## 風險與取捨

- **音訊自動播放政策**：各瀏覽器都擋未經手勢的出聲。設計已把出聲綁在第一個手勢上，這是硬限制不是 bug；README 要講清楚。
- **`file://` 下的 AnalyserNode**：直接讀媒體檔會被當跨來源而拿到全零——但我們是即時合成、不載檔，`AnalyserNode` 讀的是自己合成的節點，不受此限。demo 走 http server，沒問題。
- **canvas 效能**：塵粒 + 落葉都用 requestAnimationFrame，分頁隱藏時要停。粒子數有上限、reduced-motion 全關。
- **命名空間衝突**：三個檔共掛 `MyceliumFX`，用 `= window.MyceliumFX || {}` 防覆蓋。
