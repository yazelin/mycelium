import { test, expect } from '@playwright/test';

async function addChapter(page, volume, title, status) {
  const btn = page.locator('.tab-btn', { hasText: '大綱' });
  if (!(await btn.evaluate((el) => el.classList.contains('active')))) await btn.click();
  const prevCount = await page.locator('.chapter-list li').count();
  await page.locator('#c-volume').fill(String(volume));
  await page.locator('#c-title').fill(title);
  await page.locator('#c-status').selectOption(status);
  await page.locator('#c-add').click();
  // Wait for the chapter to actually persist and render before returning — otherwise a
  // following tab switch can read chapters from IndexedDB before this write lands, and
  // foreshadow.js's one-shot render never gets a chance to pick up the missing option.
  await expect(page.locator('.chapter-list li')).toHaveCount(prevCount + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('伏筆測試'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('伏筆測試');
  await addChapter(page, 1, '埋設章', '完稿');
  await addChapter(page, 2, '回收章', '完稿'); // already written, but foreshadow will stay 埋設中 → overdue
});

test('foreshadow whose recovery chapter is already 完稿 but status stays 埋設中 is flagged overdue', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('林小雨的驚人身世');
  await page.locator('#f-plant').selectOption({ label: '第1卷・埋設章' });
  await page.locator('#f-recover').selectOption({ label: '第2卷・回收章' });
  await page.locator('#f-status').selectOption('埋設中');
  await page.locator('#f-add').click();

  const item = page.locator('.foreshadow-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveClass(/overdue/);
  await expect(item).toContainText('逾期未回收');
});

test('dismissing the delete confirm on a foreshadow entry leaves it in place', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('待刪伏筆');
  await page.locator('#f-add').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);

  page.once('dialog', (d) => d.dismiss());
  await page.locator('.f-delete').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);
});

test('accepting the delete confirm removes a foreshadow entry', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('待刪伏筆');
  await page.locator('#f-add').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);

  page.once('dialog', (d) => d.accept());
  await page.locator('.f-delete').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(0);
});

test('editing a foreshadow via the inline form updates its fields and persists across a reload', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('原伏筆名');
  await page.locator('#f-plant').selectOption({ label: '第1卷・埋設章' });
  await page.locator('#f-notes').fill('原備註。');
  await page.locator('#f-add').click();

  const li = page.locator('.foreshadow-list li');
  await li.locator('.f-edit-toggle').click();
  await li.locator('.f-edit-title').fill('修訂後伏筆名');
  await li.locator('.f-edit-plant').selectOption({ label: '第2卷・回收章' });
  await li.locator('.f-edit-recover').selectOption({ label: '第1卷・埋設章' });
  await li.locator('.f-edit-notes').fill('修訂後備註。');
  await li.locator('.f-edit-save').click();

  await expect(li).toContainText('修訂後伏筆名');
  await expect(li).toContainText('埋設：回收章');
  await expect(li).toContainText('預計回收：埋設章');
  await expect(li).toContainText('修訂後備註。');
  // still exactly one row — proves this was an update, not a delete+recreate
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);

  await page.reload();
  const tabBtn = page.locator('.tab-btn', { hasText: '伏筆追蹤' });
  if (!(await tabBtn.evaluate((el) => el.classList.contains('active')))) await tabBtn.click();
  const reloadedLi = page.locator('.foreshadow-list li');
  await expect(reloadedLi).toContainText('修訂後伏筆名');
  await expect(reloadedLi).toContainText('修訂後備註。');
});

test('cancelling a foreshadow edit discards the changes without writing', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('原伏筆名');
  await page.locator('#f-notes').fill('原備註。');
  await page.locator('#f-add').click();

  const li = page.locator('.foreshadow-list li');
  await li.locator('.f-edit-toggle').click();
  await li.locator('.f-edit-title').fill('被取消的伏筆名');
  await li.locator('.f-edit-notes').fill('被取消的備註。');
  await li.locator('.f-edit-cancel').click();

  await expect(li).toContainText('原伏筆名');
  await expect(li).toContainText('原備註。');
  await expect(li).not.toContainText('被取消的伏筆名');

  // Reopening the edit form must show the untouched record, not the discarded draft.
  await li.locator('.f-edit-toggle').click();
  await expect(li.locator('.f-edit-title')).toHaveValue('原伏筆名');
  await expect(li.locator('.f-edit-notes')).toHaveValue('原備註。');
});

test('linking a foreshadow to an entity displays it, survives an entity rename (id preserved), and degrades gracefully when the entity is deleted', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('#e-name').fill('林小雨');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('林小雨的驚人身世');
  await page.locator('#f-entities').selectOption({ label: '林小雨' });
  await page.locator('#f-add').click();

  const item = page.locator('.foreshadow-list li', { hasText: '林小雨的驚人身世' });
  await expect(item.locator('.foreshadow-links')).toContainText('林小雨');

  // Rename the entity via the id-preserving inline edit — the foreshadow's
  // relatedEntityIds link must follow the id, not go stale.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const entityLi = page.locator('.entity-list li', { hasText: '林小雨' });
  await entityLi.locator('.e-edit-toggle').click();
  await entityLi.locator('.e-edit-name').fill('林小雨・落雨劍客');
  await entityLi.locator('.e-save').click();

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(item.locator('.foreshadow-links')).toContainText('林小雨・落雨劍客');

  // Delete the entity outright (no relations attached, so no confirm() fires)
  // — the foreshadow link must degrade to 「已刪除」, matching graph.js's
  // established pattern for a dangling relation, not break the tab.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const renamedLi = page.locator('.entity-list li', { hasText: '林小雨・落雨劍客' });
  await renamedLi.locator('.e-delete').click();
  await expect(page.locator('.entity-list li')).toHaveCount(0);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(item.locator('.foreshadow-links')).toContainText('（已刪除）');
});

test('changing a foreshadow status via the inline select moves it between status groups and clears the overdue flag', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('林小雨的驚人身世');
  await page.locator('#f-plant').selectOption({ label: '第1卷・埋設章' });
  await page.locator('#f-recover').selectOption({ label: '第2卷・回收章' });
  await page.locator('#f-status').selectOption('埋設中');
  await page.locator('#f-add').click();

  const plantedList = page.locator('.foreshadow-list[data-status="埋設中"]');
  const recoveredList = page.locator('.foreshadow-list[data-status="已回收"]');
  await expect(plantedList.locator('li')).toHaveCount(1);
  await expect(plantedList.locator('li')).toHaveClass(/overdue/);
  await expect(plantedList.locator('li')).toContainText('逾期未回收');

  // Move it to 已回收 via the inline status control (not delete+recreate) —
  // the recovery chapter is already 完稿, so this is the daily-loop action
  // of actually marking a foreshadow as paid off.
  await plantedList.locator('.f-status-select').selectOption('已回收');

  await expect(plantedList.locator('li')).toHaveCount(0);
  await expect(recoveredList.locator('li')).toHaveCount(1);
  await expect(recoveredList.locator('li')).not.toHaveClass(/overdue/);
  await expect(recoveredList.locator('li')).not.toContainText('逾期未回收');
});
