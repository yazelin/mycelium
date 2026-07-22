import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('creating a project adds it to the switcher and selects it', async ({ page }) => {
  page.once('dialog', (d) => d.accept('我的小說'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select option', { hasText: '我的小說' })).toHaveCount(1);
  await expect(page.locator('#project-select')).not.toHaveValue('');
});

test('two projects stay separate and survive a reload', async ({ page }) => {
  page.once('dialog', (d) => d.accept('作品A'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('作品A');
  page.once('dialog', (d) => d.accept('作品B'));
  await page.locator('#project-new').click();

  await expect(page.locator('#project-select option')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('#project-select option')).toHaveCount(2);
});

test('deleting the current project removes it from the switcher', async ({ page }) => {
  page.once('dialog', (d) => d.accept('要刪除的'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('要刪除的');
  page.once('dialog', (d) => d.accept());
  await page.locator('#project-delete').click();
  await expect(page.locator('#project-select option')).toHaveCount(0);
});
