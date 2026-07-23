import { test, expect } from '@playwright/test';

const MOCK_EXTRACTION = {
  entities: [
    { name: '城主', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
    { name: '黑袍人', aliasOf: '城主', type: null, notes: null, reason: '本章揭露城主其實就是黑袍人' },
  ],
  relations: [
    { source: '林小雨', target: '城主', type: '追殺', reason: '城主軍全境追殺林小雨' },
  ],
  foreshadow: [
    { title: '林小雨的真實身份', notes: '暗示林小雨其實是城主早年的徒弟', reason: '城主的台詞埋了伏筆' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(MOCK_EXTRACTION) } }] } });
  });

  await page.goto('/');
  page.once('dialog', (d) => d.accept('抽取測試'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('抽取測試');

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
  await expect(page.locator('#ex-entities li').nth(1)).toContainText('合併為「城主」的別名');

  // #ex-apply's handler fires alert() only after all its putRecord() writes
  // have landed — register the wait before clicking (not after, which would
  // race the synchronous dialog dispatch) and use it as the completion signal
  // instead of a fixed timeout. The real proof still comes from the DOM
  // assertions below (Playwright's expect auto-retries).
  const applyDialog = page.waitForEvent('dialog');
  await page.locator('#ex-apply').click();
  await (await applyDialog).accept();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const villain = page.locator('.entity-list li', { hasText: '城主' });
  await expect(villain).toContainText('黑袍人'); // merged as alias, not a separate entity
  await expect(page.locator('.entity-list li')).toHaveCount(2); // 林小雨 + 城主 only, no duplicate

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option', { hasText: '城主' })).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li', { hasText: '林小雨的真實身份' })).toHaveCount(1);
});

test('running an extraction records the exchange to chatlogs, visible afterwards', async ({ page }) => {
  await page.locator('#ex-text').fill('（章節全文……）');
  await page.locator('#ex-run').click();
  await expect(page.locator('#ex-entities li')).toHaveCount(2);

  // extract.js's chatlogs writes land in IndexedDB right away, but #ai-log
  // was already rendered before the run — leave the AI 助理 tab and come
  // back (forcing renderAiTab to refetch) the way a reload would.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();

  await expect(page.locator('.ai-msg.user')).toContainText('（章節全文……）');
  await expect(page.locator('.ai-msg.assistant').first()).toContainText('entities');

  await page.reload();
  const aiTabBtn = page.locator('.tab-btn', { hasText: 'AI 助理' });
  if (!(await aiTabBtn.evaluate((el) => el.classList.contains('active')))) await aiTabBtn.click();
  await expect(page.locator('.ai-msg.user')).toContainText('（章節全文……）');
});

test('alias candidate listed before its new-entity target still merges without creating a duplicate', async ({ page }) => {
  // Reverse of MOCK_EXTRACTION's entity order: the alias candidate comes
  // first, its aliasOf target ("城主") is only created afterwards. This is
  // exactly the ordering the AI has no instruction to avoid, and the bug
  // this test guards against is a silently-created orphan second entity.
  const REORDERED_EXTRACTION = {
    ...MOCK_EXTRACTION,
    entities: [
      { name: '黑袍人', aliasOf: '城主', type: null, notes: null, reason: '本章揭露城主其實就是黑袍人' },
      { name: '城主', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
    ],
  };
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(REORDERED_EXTRACTION) } }] } });
  });

  await page.locator('#ex-text').fill('（章節全文……）');
  await page.locator('#ex-run').click();

  await expect(page.locator('#ex-entities li')).toHaveCount(2);
  await expect(page.locator('#ex-entities li').nth(0)).toContainText('合併為「城主」的別名');

  const applyDialog = page.waitForEvent('dialog');
  await page.locator('#ex-apply').click();
  await (await applyDialog).accept();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const villain = page.locator('.entity-list li', { hasText: '城主' });
  await expect(villain).toContainText('黑袍人'); // merged as alias, not a separate entity
  await expect(page.locator('.entity-list li')).toHaveCount(2); // 林小雨 + 城主 only, no duplicate/orphan
});
