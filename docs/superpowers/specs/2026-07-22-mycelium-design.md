# mycelium 設計文件

日期：2026-07-22

## 背景

長篇小說（未來可能延伸漫畫/動畫/電影）創作過程中，世界觀設定、人物關係、章節大綱、伏筆/反轉往往分散在筆記、聊天記錄、腦中，愈寫愈長就愈難保持前後一致——尤其是「角色身份反轉」這類劇情（某個角色其實就是另一個已出場角色），若沒有工具輔助追蹤別名/曾用名，很容易被誤判成兩個不同角色而重複建立設定。因此需要一個純前端、GitHub Pages 託管的創作輔助工具，統一管理這些資料，並整合 AI 做一致性檢查與發想。創作者通常同時經營不止一部作品，工具需支援多專案。

命名 `mycelium`（菌絲網路）：地底菌絲連結一整片森林裡的多棵樹，呼應「一個工具支撐多部作品各自的設定資料網」的定位；與亞澤既有的 Mori 森林宇宙意象呼應，但是獨立品牌，不掛在 Mori 本體身份或 world-tree（既有的公開 RPG lore repo）之下。

## 目標

- 管理任一作品的世界觀設定（人物/地點/勢力/概念）
- 用可視化節點圖記錄人物關係與劇情關聯，避免創作時前後矛盾
- 追蹤章節大綱、進度，以及伏筆的埋設與回收
- 整合 AI（多 provider 可選）做一致性檢查、劇情/反轉發想、從文字自動抽取設定候選、自由問答
- 支援多部作品，各自可綁定一個亞澤自己的 private GitHub repo 做雲端備份
- 未來可擴充漫畫/動畫/電影所需的新 AI 任務類型，不需重構現有資料結構

## 非目標（此版不做）

- 不做多人協作/帳號系統
- 不做自動背景雲端同步（避免意外覆蓋，同步一律手動觸發）
- 不做圖像/影片生成（僅文字 AI 任務；未來若加圖像類任務，走既有的「task 可擴充」設計加新 key，不在此版實作）
- 不內建 AI 直接寫入資料庫的工具呼叫迴圈（抽取圖資料的建議由人工勾選後才寫入）

## 技術棧

- Vanilla JS ES modules，無 build 步驟，直接 `index.html` + 拆分的 `.js` 模組
- `vendor/cytoscape.js`：人物關係圖視覺化（節點可拖拉）
- 資料層直接寫在 `db.js`，用原生 IndexedDB API 包一層極簡 promise 封裝（取代 localStorage 的 5–10MB 容量上限，因為要存完整章節文字與聊天紀錄）；不額外 vendor idb-keyval 之類的函式庫，原生 API 幾十行就寫完，不需要多一個依賴
- Playwright 測關鍵流程；`python3 -m http.server` 本地預覽
- GitHub Pages 直接從 repo root 發布，無 CI build 步驟

此風格延續亞澤既有的 `line-sticker-studio` / `line-chat-maker` repo 慣例。

## 架構

### 專案（作品）模型

- 一個瀏覽器安裝 = 多個「作品」，每個作品是獨立的 IndexedDB database（db-per-project）
- 首頁是「作品切換器」：新增作品、選擇作品、可選擇連結一個既有的 private GitHub repo 當雲端備份
- 每個作品可各自綁定不同 repo；不綁定也能純本機使用

### 資料模型（每個作品內）

| 類型 | 說明 |
|---|---|
| Entity | 人物/地點/勢力/概念設定；統一 schema（id/name/aliases/type/tags/notes）+ 自訂欄位。`aliases` 記別名/稱號/曾用名（例如「城主」與「黑袍人」是同一人的不同稱呼），身份反轉類劇情靠這欄位避免同一角色被誤判成兩個 entity |
| Relation | entity↔entity 的邊；type（敵對/從屬/師徒…）+ 描述；餵給 Cytoscape 畫圖，也是 AI context 的一部分 |
| Chapter | 卷/章節大綱；狀態（未寫/草稿/完稿）、字數、摘要、可選存正文全文 |
| Foreshadow | 伏筆條目：埋設章節、預計回收章節、狀態（埋設中/已回收/棄用）、關聯的 entity/relation id |
| ChatLog | 與 AI 問答的紀錄（四種任務皆記錄，可回顧） |

### UI 模組（分頁）

1. **設定庫**：Entity 清單 + 表單 CRUD
2. **關係圖**：Cytoscape 節點圖，可拖拉、新增/編輯 Relation、點節點看詳情
3. **大綱**：Chapter 清單（卷/章結構）+ 進度統計
4. **伏筆追蹤**：Foreshadow 清單，依狀態分組，逾期未回收標示
5. **AI 助理**：常駐面板，四個任務（自由問答/一致性檢查/反轉發想/抽取圖資料）各自可選不同 AI provider
6. **設定**：AI 任務-provider 對應表、GitHub PAT、目前作品的 repo 綁定、匯出/匯入 JSON

### AI 整合

沿用 `line-chat-maker/ai.js` 的 `PROVIDERS` 模式：

```js
const PROVIDERS = {
  llmshare: { label: 'llmshare（多奇團購閘道）', base: 'https://llm-share.duotify.com/v1', model: 'glm-5.2' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  ollama: { label: 'Ollama（本機）', base: 'http://localhost:11434/v1', model: 'llama3.2', keyless: true },
  custom: { label: '自訂（OpenAI 相容）', base: '', model: '' },
};
```

- 設定存成 `localStorage['mycelium-ai'] = { tasks: { consistency: {...}, plot: {...}, extract: {...}, chat: {...} } }`
- **`tasks` 是開放式物件，key 不是寫死的 enum**：未來要加漫畫分鏡、動畫腳本、電影劇本等新 AI 任務，只需加一個新 task key + 一個下拉選單，不需要改資料結構
- 任務沒個別設定時 fallback 用 `tasks.default`（若也沒設，UI 導去設定分頁）
- 呼叫方式：純 `fetch(base + '/chat/completions', {model, messages})`，不做 tool-calling 迴圈——AI 輸出是文字建議或 JSON 候選清單，由人工確認後才寫入資料庫，AI 不直接改資料（比 line-chat-maker 單純，因為 mycelium 不需要 AI 直接操控畫面狀態）

四個任務的 context 組裝：
- **一致性檢查 / 反轉發想 / 自由問答**：組裝目前作品的 entities + relations + foreshadow 清單 + 最近章節摘要 當 system context
- **抽取圖資料**：使用者貼上章節全文，AI 連同現有 entities 的 name+aliases 清單一起送出比對，回傳建議清單（新 entity / 疑似既有角色的別名（附判斷理由與比對到的既有 entity）/ 新 relation / 新 foreshadow），使用者逐條勾選「新增」或「合併為別名」後才寫入

### GitHub 同步

- 用 GitHub Contents API + PAT，把目前作品資料匯出成該作品綁定 repo 裡的 `data/*.json`（entities/relations/chapters/foreshadow）
- 手動觸發「同步到 GitHub」按鈕，不做自動背景同步
- 讀取時可從 repo 匯入還原（換電腦時用）

### 憑證與安全

- llmshare API key / 各 provider key / GitHub PAT 皆首次使用手動輸入，存瀏覽器 localStorage，不進原始碼、不進 git
- 網站公開發布於 GitHub Pages，但網址不公開分享（僅亞澤自己知道網址）

## 測試

- Playwright：
  - 新增 entity → 出現在關係圖節點
  - 新增 foreshadow，設定逾期回收章節 → 清單正確標示逾期
  - AI 呼叫 mock 回應 → 抽取候選清單正確渲染、勾選後正確寫入資料庫
  - GitHub 同步 mock → 匯出的 JSON 內容與目前資料庫一致
  - 作品切換器：新增/切換作品，資料互不污染（各自獨立 IndexedDB db）
