import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8919',
    locale: 'zh-TW',
  },
  webServer: {
    command: 'python3 -m http.server 8919 --bind 127.0.0.1',
    // 探測一個真的存在的檔案，不要探 `/`：網頁 app 收掉之後（#34）根目錄
    // 已經沒有 index.html，`/` 只會是目錄列表或 404，不能拿來判斷起來了沒。
    url: 'http://127.0.0.1:8919/effects/demo.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{
    name: 'desktop',
    use: {
      ...devices['Desktop Chrome'],
      // loop 模式的 <audio> 元素播放受 Chrome 的媒體自動播放政策管控——
      // 該政策只認 click/touchend/keydown 之類的「離散」手勢，滑輪捲動
      // 不算數（跟 Web Audio API 的 sticky activation 判定不同）。放寬這
      // 個 flag 讓測試環境的 page.mouse.wheel() 手勢也能觸發 <audio>.play()。
      launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    },
  }],
});
