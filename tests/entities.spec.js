import { test, expect } from '@playwright/test';

async function makeProject(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await makeProject(page, '測試作品');
});

test('adding an entity with aliases shows it in the list', async ({ page }) => {
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-aliases').fill('轉生者, 巨大模型檔案');
  await page.locator('#e-type').fill('人物');
  await page.locator('#e-notes').fill('主角，token 無限。');
  await page.locator('#e-add').click();

  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('陸修');
  await expect(item).toContainText('轉生者');
  await expect(item).toContainText('巨大模型檔案');
});

test('deleting an entity removes it from the list', async ({ page }) => {
  await page.locator('#e-name').fill('待刪除');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await page.locator('.e-delete').click();
  await expect(page.locator('.entity-list li')).toHaveCount(0);
});

test('two projects keep separate entity data (db-per-project isolation)', async ({ page }) => {
  await page.locator('#e-name').fill('專案A的角色');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await makeProject(page, '第二個作品');
  await expect(page.locator('.entity-list li')).toHaveCount(0); // fresh project, no leaked data
  await page.locator('#e-name').fill('專案B的角色');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
  await expect(page.locator('.entity-list li')).toContainText('專案B的角色');

  const sel = page.locator('#project-select');
  const aValue = await sel.locator('option', { hasText: '測試作品' }).getAttribute('value');
  await sel.selectOption(aValue);
  await expect(page.locator('.entity-list li')).toHaveCount(1);
  await expect(page.locator('.entity-list li')).toContainText('專案A的角色');
});
