import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('同步測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  // entities ("設定庫") is the first registered tab and is already active right
  // after project creation — clicking it again would trigger a redundant,
  // unawaited re-render that can race the .fill()/.click() below (the exact
  // flakiness that bit tasks 3 and 5). Only click if not already active.
  const entitiesTabBtn = page.locator('.tab-btn', { hasText: '設定庫' });
  if (!(await entitiesTabBtn.evaluate((el) => el.classList.contains('active')))) {
    await entitiesTabBtn.click();
  }
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-add').click();
});

test('sync PUTs each data store as base64 JSON to the Contents API', async ({ page }) => {
  const puts = [];
  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ status: 404, json: { message: 'Not Found' } }); return; }
    puts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { content: { sha: 'abc123' } } });
  });

  // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');
  await page.locator('#gh-save').click();

  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('同步完成', { timeout: 10_000 });

  expect(puts.length).toBe(5); // one per PROJECT_STORES entry
  const entitiesPut = puts.find((p) => p.url.endsWith('data/entities.json'));
  const decoded = JSON.parse(Buffer.from(entitiesPut.body.content, 'base64').toString('utf8'));
  expect(decoded[0].name).toBe('陸修');
});

test('sync without a repo binding shows an error instead of throwing', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-save').click();
  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('尚未綁定');
});
