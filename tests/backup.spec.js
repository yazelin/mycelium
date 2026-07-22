import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('備份測試'));
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
  await page.locator('#e-aliases').fill('轉生者,巨大模型檔案');
  await page.locator('#e-notes').fill('主角，記憶來自另一個世界。');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
});

test('export downloads a JSON file containing current entities with Chinese content intact', async ({ page }) => {
  // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-json').click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const content = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(content.entities[0].name).toBe('陸修');
  expect(content.entities[0].aliases).toEqual(['轉生者', '巨大模型檔案']);
  expect(content.entities[0].notes).toBe('主角，記憶來自另一個世界。');
  // filename must be sane even though the project name ("備份測試") is entirely
  // non-ASCII — it should not break, truncate to nothing meaningful, or contain
  // path separators.
  expect(download.suggestedFilename()).toMatch(/^mycelium-.*\.json$/);
  expect(download.suggestedFilename()).not.toContain('/');
});

test('import overwrites current project data, preserving Chinese content, gated behind a confirm dialog', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const payload = JSON.stringify({
    entities: [{ id: 'e1', name: '匯入的角色', aliases: ['異名', '化名'], type: '人物', tags: [], notes: '從匯入檔案還原的角色備註，測試中文字元。' }],
    relations: [],
    chapters: [],
    foreshadow: [],
    chatlogs: [],
  });

  // The change handler calls confirm() first (synchronously blocking the page
  // until answered) and, only after the awaited replaceProjectData() write
  // lands, calls alert() to signal completion. A once('dialog') registered
  // between setInputFiles() and a later wait can end up bound too late (the
  // confirm dialog may already be in flight by the time setInputFiles()'s
  // promise settles) or catch the wrong dialog. A single persistent handler
  // that accepts every dialog sidesteps the ordering race entirely, and we
  // use the alert specifically (not a fixed timeout) as the signal that the
  // destructive import has actually finished.
  let importFinished;
  const importFinishedPromise = new Promise((resolve) => { importFinished = resolve; });
  page.on('dialog', async (d) => {
    if (d.type() === 'alert') importFinished();
    await d.accept();
  });

  await page.locator('#import-json').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(payload, 'utf8') });
  await importFinishedPromise;

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('匯入的角色');
  await expect(item).toContainText('異名');
  await expect(item).toContainText('化名');
  await expect(item).toContainText('從匯入檔案還原的角色備註，測試中文字元。');
});

test('dismissing the import confirm dialog leaves local data untouched', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const payload = JSON.stringify({ entities: [{ id: 'e1', name: '不應該出現', aliases: [], type: '', tags: [], notes: '' }], relations: [], chapters: [], foreshadow: [], chatlogs: [] });

  page.once('dialog', (d) => d.dismiss());
  await page.locator('#import-json').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(payload, 'utf8') });

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('陸修');
});

test('importing a wrong-shaped JSON file leaves existing data intact and reports an error, not success', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  // Syntactically valid JSON, but not shaped like a mycelium backup at all
  // (no PROJECT_STORES keys) — exactly the "picked the wrong file" case from
  // the finding. Must be rejected before any destructive write, not silently
  // treated as "every store is empty".
  const payload = JSON.stringify({ foo: 1 });

  // Same persistent-dialog-handler pattern as the successful-import test
  // above: confirm() fires first (accepted), then the import handler's own
  // alert (success or error) is the completion signal — no fixed timeout.
  let importFinished;
  const importFinishedPromise = new Promise((resolve) => { importFinished = resolve; });
  let alertMessage = null;
  page.on('dialog', async (d) => {
    if (d.type() === 'alert') { alertMessage = d.message(); importFinished(); }
    await d.accept();
  });

  await page.locator('#import-json').setInputFiles({ name: 'wrong-shape.json', mimeType: 'application/json', buffer: Buffer.from(payload, 'utf8') });
  await importFinishedPromise;

  expect(alertMessage).not.toContain('匯入完成');
  expect(alertMessage).toContain('不是 mycelium 的備份檔');

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('陸修');
});

test('importing malformed (unparseable) JSON shows a readable error and changes nothing', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const payload = '{ this is not valid json,,,';

  let importFinished;
  const importFinishedPromise = new Promise((resolve) => { importFinished = resolve; });
  let alertMessage = null;
  page.on('dialog', async (d) => {
    if (d.type() === 'alert') { alertMessage = d.message(); importFinished(); }
    await d.accept();
  });

  await page.locator('#import-json').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(payload, 'utf8') });
  await importFinishedPromise;

  expect(alertMessage).not.toContain('匯入完成');
  expect(alertMessage).toBeTruthy();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('陸修');
});

test('exporting projects with different Chinese names produces distinct filenames that retain the Chinese name', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const [download1] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-json').click(),
  ]);
  const filename1 = download1.suggestedFilename();
  expect(filename1).toContain('備份測試');

  // Create a second project with a different, all-Chinese name and export
  // it too — the old ASCII-only `\w` sanitizer collapsed every Chinese name
  // down to the same "mycelium-_.json", so two projects would silently
  // overwrite each other's export in the Downloads folder.
  page.once('dialog', (d) => d.accept('轉生token無限'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-json').click(),
  ]);
  const filename2 = download2.suggestedFilename();

  expect(filename2).toContain('轉生');
  expect(filename2).not.toBe(filename1);
});
