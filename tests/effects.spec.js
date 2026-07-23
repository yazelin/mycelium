import { test, expect } from '@playwright/test';

// mycelium-fx（#32）的機器可驗行為。「感覺」的部分（阻力多重才對、凍結多久
// 才剛好在知覺門檻下）只能人去 effects/demo.html 拉滑桿判斷，這裡不測；
// 這裡測的是不管手感怎麼調都不可以壞掉的硬性契約。

const FIXTURE = '/tests/fx-fixture.html';

// 上膛需要「載入後緩衝期已過」而且「讀者真的動過一次」。
// config.armDelayMs 預設 800ms，這裡抓 1200ms 留餘裕。
async function settle(page) {
  await page.waitForTimeout(1200);
}

async function debug(page) {
  return page.evaluate(() => window.MyceliumFX._debug());
}

async function scrollTo(page, y) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(120); // 讓 scroll 事件與 rAF 跑完
}

async function elemTop(page, id) {
  return page.evaluate(
    (sel) => document.getElementById(sel).getBoundingClientRect().top + window.scrollY,
    id,
  );
}

test.describe('mycelium-fx 敘事效果庫', () => {
  test('freeze 是上膛→擊發：只進入視窗不會擊發，下一次捲動輸入才擊發', async ({ page }) => {
    await page.goto(FIXTURE);
    await settle(page);

    // 把凍結段落捲進視窗中央。這一步只上膛，不應該擊發。
    const y = await elemTop(page, 'freeze-a');
    await scrollTo(page, y - 300);

    expect(await page.locator('#freeze-a').getAttribute('data-fx-state')).toBe('armed');
    expect((await debug(page)).armed).toBe(1);
    expect((await debug(page)).frozen).toBe(false);

    // 讀者停在這裡讀了一段時間——遠超過 data-fx-ms 的 900ms。
    // 如果實作是「進視窗就計時」，效果早就無聲跑完了；上膛制不會。
    await page.waitForTimeout(1500);
    expect(await page.locator('#freeze-a').getAttribute('data-fx-state')).toBe('armed');
    expect((await debug(page)).frozen).toBe(false);

    // 下一次捲動輸入才擊發，而且這一次輸入本身要被吃掉（畫面不動）。
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
    expect((await debug(page)).frozen).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await page.locator('#freeze-a').getAttribute('data-fx-state')).toBe('frozen');

    // 凍結期間再捲也不動。
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    // 放開之後恢復正常，而且同一個段落不再擊發第二次。
    await page.waitForTimeout(1000);
    expect(await page.locator('#freeze-a').getAttribute('data-fx-state')).toBe('done');
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });

  test('freeze 不會在頁面剛載入時觸發', async ({ page }) => {
    await page.goto(FIXTURE);
    // 還沒過緩衝期就直接捲——不可以被吃掉。
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    expect((await debug(page)).frozen).toBe(false);
  });

  test('鍵盤捲動絕不被攔截：凍結已上膛時按鍵照樣前進', async ({ page }) => {
    await page.goto(FIXTURE);
    await settle(page);
    const y = await elemTop(page, 'freeze-a');
    await scrollTo(page, y - 300);
    expect((await debug(page)).armed).toBe(1);

    const before = await page.evaluate(() => window.scrollY);
    await page.locator('body').press('PageDown');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.scrollY);
    expect(after - before).toBeGreaterThan(200); // 整頁前進，沒有被吃掉也沒有被打折
    expect((await debug(page)).frozen).toBe(false);
  });

  test('drag 讓捲動變重，但鍵盤在同一個區域裡仍然全速', async ({ page }) => {
    await page.goto(FIXTURE);
    await settle(page);
    const y = await elemTop(page, 'drag-a');
    await scrollTo(page, y + 200); // 視窗中線落在阻力區域內
    expect((await debug(page)).drag).toBe(true);

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const moved = (await page.evaluate(() => window.scrollY)) - before;
    expect(moved).toBeGreaterThan(0);     // 還是會動：重，不是壞掉
    expect(moved).toBeLessThan(600 * 0.6); // factor=3 → 明顯打折

    const kbBefore = await page.evaluate(() => window.scrollY);
    await page.locator('body').press('PageDown');
    await page.waitForTimeout(400);
    expect((await page.evaluate(() => window.scrollY)) - kbBefore).toBeGreaterThan(200);
  });

  test('scramble 只改視覺：DOM 文字仍然是原文', async ({ page }) => {
    await page.goto(FIXTURE);
    const original = '城主說完那句話之後屋子裡沒有人接話落雨劍客把杯子放回桌上';
    await settle(page);
    await scrollTo(page, (await elemTop(page, 'scramble-a')) - 300);

    // 效果確實套用了（每個字被包成 span）
    await expect(page.locator('#scramble-a .mfx-ch').first()).toBeAttached();
    const shifted = await page.evaluate(() =>
      [...document.querySelectorAll('#scramble-a .mfx-ch')].filter((s) => s.style.transform).length);
    expect(shifted).toBeGreaterThan(0);

    // 但螢幕閱讀器 / 複製 / Ctrl+F 拿到的仍是原句
    expect(await page.locator('#scramble-a').evaluate((el) => el.textContent)).toBe(original);
  });

  test('stutter 的複本是 aria-hidden，不污染可存取文字', async ({ page }) => {
    await page.goto(FIXTURE);
    await settle(page);
    await scrollTo(page, (await elemTop(page, 'stutter-a')) - 300);
    await expect(page.locator('.mfx-echo')).toHaveCount(2); // times=3 → 本體 + 2 個回音
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('.mfx-echo')].every((e) => e.getAttribute('aria-hidden') === 'true'));
    expect(hidden).toBe(true);
  });

  test('全站關閉開關會停用所有效果，並記在 localStorage 跨頁存活', async ({ page }) => {
    await page.goto(FIXTURE);
    await settle(page);
    await scrollTo(page, (await elemTop(page, 'stutter-a')) - 300);
    await expect(page.locator('.mfx-echo')).toHaveCount(2);

    await page.locator('#toggle').click();
    expect(await page.evaluate(() => window.MyceliumFX.isEnabled())).toBe(false);
    await expect(page.locator('.mfx-echo')).toHaveCount(0);
    await expect(page.locator('.mfx-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('mycelium-fx:off'))).toBe('1');

    // 關掉之後捲動完全不打折、不被吃。
    const y = await elemTop(page, 'drag-a');
    await scrollTo(page, y + 200);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect((await page.evaluate(() => window.scrollY)) - before).toBeGreaterThan(300);

    // 重整之後仍然是關的。
    await page.reload();
    expect(await page.evaluate(() => window.MyceliumFX.isEnabled())).toBe(false);
    await expect(page.locator('#toggle')).toHaveText('特效：關');
  });

  test('prefers-reduced-motion: reduce 時全部效果關閉，內容完整可讀', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', locale: 'zh-TW' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8919' + FIXTURE);
    await page.waitForTimeout(1200);

    expect(await page.evaluate(() => window.MyceliumFX.isEnabled())).toBe(false);
    expect(await page.evaluate(() => window.MyceliumFX.reducedMotion())).toBe(true);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await expect(page.locator('.mfx-ghost')).toHaveCount(0);
    await expect(page.locator('.mfx-echo')).toHaveCount(0);
    await expect(page.locator('.mfx-eyelid')).toHaveCount(0);
    await expect(page.locator('.mfx-ch')).toHaveCount(0);

    // 沒有凍結、沒有阻力：捲動一路正常。
    await page.evaluate(() => window.scrollTo(0, 0));
    const y = await page.evaluate(
      () => document.getElementById('drag-a').getBoundingClientRect().top + window.scrollY);
    await page.evaluate((v) => window.scrollTo(0, v + 200), y);
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect((await page.evaluate(() => window.scrollY)) - before).toBeGreaterThan(300);

    await expect(page.locator('#scramble-a')).toBeVisible();
    await context.close();
  });

  test('關掉 JavaScript 也能讀完整篇（效果是漸進增強）', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: 'zh-TW' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8919/effects/demo.html');
    await expect(page.locator('#freeze-target')).toBeVisible();
    await expect(page.locator('#scramble-target')).toContainText('城主說完那句話之後');
    await expect(page.locator('#stutter-target')).toBeVisible();
    await expect(page.locator('.mfx-eyelid')).toHaveCount(0);
    await context.close();
  });

  test('示範頁可以載入且沒有 console 錯誤', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/effects/demo.html');
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    await page.locator('#r-scramble').click();
    await page.locator('#r-stutter').click();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});
