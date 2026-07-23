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

## 終端機 agent skill

`skills/mycelium/` 是給本機 agent（Claude Code / Codex / Gemini CLI…）用的 skill：
在終端機就能讀作品設定回答一致性問題、把新章節抽成設定候選（含別名合併判斷）、
帶著全部設定討論劇情、批量匯入舊稿。

agent 讀不到瀏覽器的 IndexedDB，接點是作品綁定的那個 private repo 的 `data/*.json`。

- **預設只產生提案**：寫成該 repo 的 `proposals/<timestamp>.json`（格式就是 app 的
  AI 抽取候選），由你在網頁上逐項勾選才會真的寫入設定庫
- **明講「直接寫」才會動 `data/*.json`**，而且一定先自動存快照到 `snapshots/<timestamp>/`

安裝（clone + symlink 兩行）：

```bash
git clone https://github.com/yazelin/mycelium ~/mycelium
ln -s ~/mycelium/skills/mycelium ~/.claude/skills/mycelium
```

需要 `node` 18+ 與已登入的 `gh`（不需要 PAT，也零 npm 依賴）。
作品設定寫在 `~/.config/mycelium/works.json`，一部作品一個 repo，可以有很多部。
用法見 `skills/mycelium/SKILL.md`。

## 本地開發

```bash
npm install
npx playwright install chromium
npm run serve      # 另開一個 terminal，http://127.0.0.1:8919
npm test           # 跑 Playwright 測試（65 個）
npm run test:skill # 跑 agent skill 的腳本測試（不需要瀏覽器）
```

沒有 build 步驟，改完存檔重整就看得到。

設計文件：`docs/superpowers/specs/2026-07-22-mycelium-design.md`

## 授權

MIT，見 LICENSE。
