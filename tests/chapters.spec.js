import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('大綱測試'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('大綱測試');
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

test('dismissing the delete confirm on a chapter with no content leaves it in place', async ({ page }) => {
  await page.locator('#c-title').fill('待刪章節');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  page.once('dialog', (d) => d.dismiss());
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);
});

test('accepting the delete confirm removes a chapter with no content, and the confirm message does not mention 正文', async ({ page }) => {
  await page.locator('#c-title').fill('待刪章節');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  let message = null;
  page.once('dialog', (d) => { message = d.message(); d.accept(); });
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(0);
  expect(message).not.toContain('正文');
});

test('deleting a chapter that has content warns that the 正文 will be deleted too, and accepting removes it', async ({ page }) => {
  await page.locator('#c-title').fill('有正文的章節');
  await page.locator('#c-content').fill('這是這一章的正文內容。');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  // Dismiss first — must leave the chapter (and its content) untouched.
  page.once('dialog', (d) => d.dismiss());
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  let message = null;
  page.once('dialog', (d) => { message = d.message(); d.accept(); });
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(0);
  expect(message).toContain('正文');
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

test('body text saved on chapter creation shows a content indicator and is viewable via the toggle', async ({ page }) => {
  await page.locator('#c-title').fill('有正文的章節');
  await page.locator('#c-content').fill('這是第一段正文，用來確認稿子沒有不見。');
  await page.locator('#c-add').click();

  const li = page.locator('.chapter-list li');
  await expect(li).toHaveCount(1);
  await expect(li.locator('.content-indicator')).toHaveClass(/has-content/);
  await expect(li.locator('.content-indicator')).toContainText('字');

  // Textarea exists in the DOM but stays hidden until the user asks to see it.
  await expect(li.locator('.c-content-edit')).toBeHidden();
  await li.locator('.c-toggle-content').click();
  await expect(li.locator('.c-content-edit')).toBeVisible();
  await expect(li.locator('.c-content-edit')).toHaveValue('這是第一段正文，用來確認稿子沒有不見。');
});

test('a chapter with no content shows a 尚無正文 indicator instead of a character count', async ({ page }) => {
  await page.locator('#c-title').fill('空章節');
  await page.locator('#c-add').click();

  const li = page.locator('.chapter-list li');
  await expect(li.locator('.content-indicator')).toHaveText('尚無正文');
  await expect(li.locator('.content-indicator')).not.toHaveClass(/has-content/);
});

test('editing 正文 via the inline editor persists across a reload', async ({ page }) => {
  await page.locator('#c-title').fill('可編輯章節');
  await page.locator('#c-content').fill('初版正文。');
  await page.locator('#c-add').click();

  const li = page.locator('.chapter-list li');
  await li.locator('.c-toggle-content').click();
  await li.locator('.c-content-edit').fill('修訂後的正文，字數不同。');
  await li.locator('.c-content-save').click();

  await expect(li.locator('.content-indicator')).toContainText(String('修訂後的正文，字數不同。'.length));

  await page.reload();
  const btn = page.locator('.tab-btn', { hasText: '大綱' });
  if (!(await btn.evaluate((el) => el.classList.contains('active')))) await btn.click();

  const reloadedLi = page.locator('.chapter-list li');
  await reloadedLi.locator('.c-toggle-content').click();
  await expect(reloadedLi.locator('.c-content-edit')).toHaveValue('修訂後的正文，字數不同。');
});

test('editing 正文 preserves the chapter id (a foreshadow pointing at it keeps resolving)', async ({ page }) => {
  await page.locator('#c-volume').fill('1');
  await page.locator('#c-title').fill('伏筆依附章');
  await page.locator('#c-content').fill('初版正文。');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('依附伏筆');
  await page.locator('#f-plant').selectOption({ label: '第1卷・伏筆依附章' });
  await page.locator('#f-add').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);
  await expect(page.locator('.foreshadow-list li')).toContainText('埋設：伏筆依附章');

  await page.locator('.tab-btn', { hasText: '大綱' }).click();
  const li = page.locator('.chapter-list li');
  await li.locator('.c-toggle-content').click();
  await li.locator('.c-content-edit').fill('編輯後的正文。');
  await li.locator('.c-content-save').click();
  // still exactly one chapter row — proves this was an update, not a delete+recreate
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li')).toContainText('埋設：伏筆依附章');
  await expect(page.locator('.foreshadow-list li')).not.toContainText('未設定');
});
