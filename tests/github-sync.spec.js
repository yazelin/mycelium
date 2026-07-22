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
  await page.locator('#e-name').fill('林小雨');
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
  expect(decoded[0].name).toBe('林小雨');
});

test('sync without a repo binding shows an error instead of throwing', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-save').click();
  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('尚未綁定');
});

test('sync surfaces a clear auth error when the pre-flight GET is a 401, instead of falling through to create', async ({ page }) => {
  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
      return;
    }
    // If the bug regresses, the code will fall through and attempt a PUT here.
    await route.fulfill({ status: 200, json: { content: { sha: 'abc123' } } });
  });

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');
  await page.locator('#gh-save').click();

  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('同步失敗', { timeout: 10_000 });
  await expect(page.locator('#gh-status')).toContainText('401');
  await expect(page.locator('#gh-status')).toContainText('PAT');
});

test('import round-trips Chinese entity content through base64 decode', async ({ page }) => {
  const remoteEntities = [
    { id: 'e1', name: '林小雨', aliases: ['白衣客', '落雨劍客'], type: '人物', tags: [], notes: '主角，身世成謎。' },
  ];

  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('data/entities.json')) {
      const content = Buffer.from(JSON.stringify(remoteEntities), 'utf8').toString('base64');
      await route.fulfill({ json: { content, encoding: 'base64', sha: 'sha-entities' } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');

  // #gh-save's handler awaits an IndexedDB write before calling alert(), so
  // that alert can land at any point relative to #gh-import's confirm() —
  // a once('dialog') registered between the two clicks can end up catching
  // the stray alert instead of the confirm it was meant for. A single
  // persistent accept-everything handler sidesteps the ordering race
  // entirely: whichever dialog shows up (alert or confirm), it's accepted.
  page.on('dialog', (d) => d.accept());
  await page.locator('#gh-save').click();

  await page.locator('#gh-import').click();
  await expect(page.locator('#gh-status')).toContainText('匯入完成', { timeout: 10_000 });

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('林小雨');
  await expect(item).toContainText('白衣客');
  await expect(item).toContainText('落雨劍客');
  await expect(item).toContainText('主角，身世成謎。');
});

test('import refuses when every store 404s (nonexistent/typo repo, or not synced yet) instead of wiping the project', async ({ page }) => {
  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    await route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');

  // See the comment in the round-trip test above re: the alert/confirm race.
  page.on('dialog', (d) => d.accept());
  await page.locator('#gh-save').click();

  await page.locator('#gh-import').click();
  await expect(page.locator('#gh-status')).toContainText('找不到任何', { timeout: 10_000 });

  // Nothing must have changed locally — the 林小雨 entity from beforeEach must survive.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('林小雨');
});

test('import proceeds when only some stores 404 (partial data is a legitimate state)', async ({ page }) => {
  const remoteEntities = [
    { id: 'e1', name: '城主', aliases: [], type: '人物', tags: [], notes: '唯一遠端有資料的 store。' },
  ];

  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('data/entities.json')) {
      const content = Buffer.from(JSON.stringify(remoteEntities), 'utf8').toString('base64');
      await route.fulfill({ json: { content, encoding: 'base64', sha: 'sha-entities' } });
      return;
    }
    // relations/chapters/foreshadow/chatlogs all 404 — this is the "haven't
    // synced those yet" case, distinct from "nothing at all in the repo".
    await route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');

  page.on('dialog', (d) => d.accept());
  await page.locator('#gh-save').click();

  await page.locator('#gh-import').click();
  await expect(page.locator('#gh-status')).toContainText('匯入完成', { timeout: 10_000 });

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('城主'); // replaced the local 林小雨 with the remote (partial) data
});

test('dismissing the import confirm dialog leaves local data untouched', async ({ page }) => {
  await expect(page.locator('.entity-list li')).toHaveCount(1); // the 林小雨 entity added in beforeEach

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();

  page.once('dialog', (d) => d.dismiss());
  await page.locator('#gh-import').click();
  await expect(page.locator('#gh-status')).toHaveText('');

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('林小雨');
});
