import { test, expect } from '@playwright/test';

async function addChapter(page, volume, title, status) {
  const btn = page.locator('.tab-btn', { hasText: '大綱' });
  if (!(await btn.evaluate((el) => el.classList.contains('active')))) await btn.click();
  const prevCount = await page.locator('.chapter-list li').count();
  await page.locator('#c-volume').fill(String(volume));
  await page.locator('#c-title').fill(title);
  await page.locator('#c-status').selectOption(status);
  await page.locator('#c-add').click();
  // Wait for the chapter to actually persist and render before returning — otherwise a
  // following tab switch can read chapters from IndexedDB before this write lands, and
  // foreshadow.js's one-shot render never gets a chance to pick up the missing option.
  await expect(page.locator('.chapter-list li')).toHaveCount(prevCount + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('伏筆測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  await addChapter(page, 1, '埋設章', '完稿');
  await addChapter(page, 2, '回收章', '完稿'); // already written, but foreshadow will stay 埋設中 → overdue
});

test('foreshadow whose recovery chapter is already 完稿 but status stays 埋設中 is flagged overdue', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('陸修的無限 Token 真相');
  await page.locator('#f-plant').selectOption({ label: '第1卷・埋設章' });
  await page.locator('#f-recover').selectOption({ label: '第2卷・回收章' });
  await page.locator('#f-status').selectOption('埋設中');
  await page.locator('#f-add').click();

  const item = page.locator('.foreshadow-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveClass(/overdue/);
  await expect(item).toContainText('逾期未回收');
});

test('deleting a foreshadow entry removes it', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('待刪伏筆');
  await page.locator('#f-add').click();
  await page.locator('.f-delete').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(0);
});
