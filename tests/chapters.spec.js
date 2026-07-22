import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('大綱測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  await page.locator('.tab-btn', { hasText: '大綱' }).click();
});

test('adding a chapter shows it in the list with progress stats', async ({ page }) => {
  await page.locator('#c-volume').fill('1');
  await page.locator('#c-title').fill('入城與初次交手');
  await page.locator('#c-status').selectOption('完稿');
  await page.locator('#c-wordcount').fill('3200');
  await page.locator('#c-summary').fill('林小雨入城，發現城主的秘密。');
  await page.locator('#c-add').click();

  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.chapter-list li')).toContainText('入城與初次交手');
  await expect(page.locator('.chapter-stats')).toContainText('完稿 1');
});

test('deleting a chapter removes it', async ({ page }) => {
  await page.locator('#c-title').fill('待刪章節');
  await page.locator('#c-add').click();
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(0);
});

test('changing a chapter status via the inline select updates progress stats and preserves its id (a foreshadow pointing at it keeps resolving)', async ({ page }) => {
  await page.locator('#c-volume').fill('1');
  await page.locator('#c-title').fill('測試章');
  await page.locator('#c-status').selectOption('未寫');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.chapter-stats')).toContainText('未寫 1');
  await expect(page.locator('.chapter-stats')).toContainText('完稿 0');

  // A foreshadow pointing at this chapter, added before the status edit —
  // if the edit ever became delete+recreate (changing the chapter's id),
  // this would silently regress to 未設定.
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('依附伏筆');
  await page.locator('#f-plant').selectOption({ label: '第1卷・測試章' });
  await page.locator('#f-add').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);
  await expect(page.locator('.foreshadow-list li')).toContainText('埋設：測試章');

  // Move the chapter 未寫 → 完稿 via the inline status control (not delete+recreate).
  await page.locator('.tab-btn', { hasText: '大綱' }).click();
  await page.locator('.chapter-list li .c-status-select').selectOption('完稿');
  await expect(page.locator('.chapter-stats')).toContainText('完稿 1');
  await expect(page.locator('.chapter-stats')).toContainText('未寫 0');
  // still exactly one chapter row — proves this was an update, not a delete+recreate
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li')).toContainText('埋設：測試章');
  await expect(page.locator('.foreshadow-list li')).not.toContainText('未設定');
});
