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
  await page.locator('#c-title').fill('轉生與初次詠唱');
  await page.locator('#c-status').selectOption('完稿');
  await page.locator('#c-wordcount').fill('3200');
  await page.locator('#c-summary').fill('陸修轉生，發現 Token 無限。');
  await page.locator('#c-add').click();

  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.chapter-list li')).toContainText('轉生與初次詠唱');
  await expect(page.locator('.chapter-stats')).toContainText('完稿 1');
});

test('deleting a chapter removes it', async ({ page }) => {
  await page.locator('#c-title').fill('待刪章節');
  await page.locator('#c-add').click();
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(0);
});
