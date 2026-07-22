import { test, expect } from '@playwright/test';

const MOCK_EXTRACTION = {
  entities: [
    { name: '魔王', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
    { name: '系統管理員陳先生', aliasOf: '魔王', type: null, notes: null, reason: '本章揭露魔王其實就是系統管理員陳先生' },
  ],
  relations: [
    { source: '陸修', target: '魔王', type: '追殺', reason: '魔王軍全境追殺陸修' },
  ],
  foreshadow: [
    { title: '陸修的真實身份', notes: '暗示陸修是上一代殘留的模型', reason: '魔王的台詞埋了伏筆' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(MOCK_EXTRACTION) } }] } });
  });

  await page.goto('/');
  page.once('dialog', (d) => d.accept('抽取測試'));
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
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const fieldset = page.locator('fieldset[data-task="extract"]');
  await fieldset.locator('.ai-provider').selectOption('custom');
  await fieldset.locator('.ai-base').fill('https://example.invalid/v1');
  await fieldset.locator('.ai-model').fill('test-model');
  await page.locator('#ai-save').click();

  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
  await page.locator('#ai-task').selectOption('extract');
});

test('extracting text produces candidates; applying merges aliases and links relations', async ({ page }) => {
  await page.locator('#ex-text').fill('（章節全文……）');
  await page.locator('#ex-run').click();

  await expect(page.locator('#ex-entities li')).toHaveCount(2);
  await expect(page.locator('#ex-entities li').nth(1)).toContainText('合併為「魔王」的別名');

  // #ex-apply's handler fires alert() only after all its putRecord() writes
  // have landed — register the wait before clicking (not after, which would
  // race the synchronous dialog dispatch) and use it as the completion signal
  // instead of a fixed timeout. The real proof still comes from the DOM
  // assertions below (Playwright's expect auto-retries).
  const applyDialog = page.waitForEvent('dialog');
  await page.locator('#ex-apply').click();
  await (await applyDialog).accept();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const villain = page.locator('.entity-list li', { hasText: '魔王' });
  await expect(villain).toContainText('系統管理員陳先生'); // merged as alias, not a separate entity
  await expect(page.locator('.entity-list li')).toHaveCount(2); // 陸修 + 魔王 only, no duplicate

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option', { hasText: '魔王' })).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li', { hasText: '陸修的真實身份' })).toHaveCount(1);
});
