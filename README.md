# mycelium

多作品小說 / IP 創作輔助工具。純前端、無 build 步驟，發布在 GitHub Pages。

管理世界觀設定（含別名，應對身份反轉劇情）、人物關係圖、章節大綱、伏筆追蹤，並整合多個 AI provider（llmshare/Groq/OpenAI/Gemini/OpenRouter/Ollama/自訂）做一致性檢查、劇情發想、抽取圖資料、自由問答。

每部作品可各自綁定一個你自己的 private GitHub repo 做雲端備份（見「設定」分頁）。

設計文件：`docs/superpowers/specs/2026-07-22-mycelium-design.md`

## 本地開發

```bash
npm install
npx playwright install chromium
npm run serve      # 另開一個 terminal，http://127.0.0.1:8919
npm test           # 跑 Playwright 測試
```
