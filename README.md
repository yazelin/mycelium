# mycelium

長篇小說 / IP 創作輔助工具。純前端、無 build 步驟，可直接發布在 GitHub Pages。

菌絲網路連結整片森林裡的樹；mycelium 連結你多部作品各自的設定資料網。

## 功能

- **設定庫**：人物 / 地點 / 勢力 / 概念，每筆都帶「別名」欄位——身分反轉的劇情（某角色其實就是另一個角色）不會被記成兩個人
- **關係圖**：可拖拉的人物關係節點圖（Cytoscape），關係可新增可刪除
- **大綱**：卷 / 章結構、狀態與字數，進度一眼看完
- **伏筆追蹤**：記錄埋設章節與預計回收章節，回收章都寫完了還沒回收會標示逾期
- **AI 助理**：一致性檢查、劇情發想、從貼上的章節全文抽取設定候選、自由問答
- **多作品**：每部作品各自獨立資料庫，可各自綁定一個你自己的 private GitHub repo 做雲端備份，也可匯出 / 匯入 JSON

AI 每個任務可以各自挑不同的 provider 與模型（llmshare / Groq / OpenAI / Gemini / OpenRouter / Ollama / 自訂 OpenAI 相容端點）。之後要加新任務（分鏡、劇本…）只要多一個下拉選項，資料結構不用動。

AI 抽取出來的設定不會直接寫進資料庫——一律列成候選清單，你勾選確認後才寫入。

## 資料放哪裡

- 作品資料存在瀏覽器的 IndexedDB，留在你自己的裝置上
- API key 與 GitHub PAT 只存在 localStorage，不會進原始碼、不會進 git、不會送到設定的 provider 端點以外的任何地方
- 雲端備份是你自己的 private repo，同步一律手動按鈕觸發，不會在背景偷跑

## 本地開發

```bash
npm install
npx playwright install chromium
npm run serve      # 另開一個 terminal，http://127.0.0.1:8919
npm test           # 跑 Playwright 測試（39 個）
```

沒有 build 步驟，改完存檔重整就看得到。

設計文件：`docs/superpowers/specs/2026-07-22-mycelium-design.md`

## 作者

[yazelin](https://yazelin.github.io/) — [GitHub](https://github.com/yazelin) | [Facebook](https://www.facebook.com/yaze.lin.gm) | [Buy me a coffee](https://buymeacoffee.com/yazelin)

## 授權

MIT，見 LICENSE。
