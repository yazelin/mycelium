import { test, expect } from '@playwright/test';

async function makeProject(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText(name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await makeProject(page, '測試作品');
});

test('adding an entity with aliases shows it in the list', async ({ page }) => {
  await page.locator('#e-name').fill('林小雨');
  await page.locator('#e-aliases').fill('白衣客, 落雨劍客');
  await page.locator('#e-type').fill('人物');
  await page.locator('#e-notes').fill('主角，劍法通神。');
  await page.locator('#e-add').click();

  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('林小雨');
  await expect(item).toContainText('白衣客');
  await expect(item).toContainText('落雨劍客');
});

test('deleting an entity removes it from the list', async ({ page }) => {
  await page.locator('#e-name').fill('待刪除');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await page.locator('.e-delete').click();
  await expect(page.locator('.entity-list li')).toHaveCount(0);
});

test('editing an entity via the inline form updates its fields and persists across a reload', async ({ page }) => {
  await page.locator('#e-name').fill('城主');
  await page.locator('#e-aliases').fill('黑袍人');
  await page.locator('#e-type').fill('人物');
  await page.locator('#e-tags').fill('反派');
  await page.locator('#e-notes').fill('原設定。');
  await page.locator('#e-add').click();

  const li = page.locator('.entity-list li');
  await li.locator('.e-edit-toggle').click();
  await li.locator('.e-edit-name').fill('城主・厲天行');
  await li.locator('.e-edit-aliases').fill('黑袍人, 天行者');
  await li.locator('.e-edit-type').fill('反派人物');
  await li.locator('.e-edit-tags').fill('反派, 主要角色');
  await li.locator('.e-edit-notes').fill('修訂後的設定。');
  await li.locator('.e-save').click();

  await expect(li).toContainText('城主・厲天行');
  await expect(li).toContainText('天行者');
  await expect(li).toContainText('反派人物');
  await expect(li).toContainText('修訂後的設定。');
  // still exactly one row — proves this was an update, not a delete+recreate
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await page.reload();
  const tabBtn = page.locator('.tab-btn', { hasText: '設定庫' });
  if (!(await tabBtn.evaluate((el) => el.classList.contains('active')))) await tabBtn.click();
  const reloadedLi = page.locator('.entity-list li');
  await expect(reloadedLi).toContainText('城主・厲天行');
  await expect(reloadedLi).toContainText('修訂後的設定。');
});

test('cancelling an entity edit discards the changes without writing', async ({ page }) => {
  await page.locator('#e-name').fill('原名');
  await page.locator('#e-notes').fill('原備註。');
  await page.locator('#e-add').click();

  const li = page.locator('.entity-list li');
  await li.locator('.e-edit-toggle').click();
  await li.locator('.e-edit-name').fill('被取消的改名');
  await li.locator('.e-edit-notes').fill('被取消的備註。');
  await li.locator('.e-cancel').click();

  await expect(li).toContainText('原名');
  await expect(li).toContainText('原備註。');
  await expect(li).not.toContainText('被取消的改名');

  // Reopening the edit form must show the untouched record, not the discarded draft.
  await li.locator('.e-edit-toggle').click();
  await expect(li.locator('.e-edit-name')).toHaveValue('原名');
  await expect(li.locator('.e-edit-notes')).toHaveValue('原備註。');
});

test('editing an entity name preserves its id: an attached relation keeps resolving and the graph still renders it', async ({ page }) => {
  await page.locator('#e-name').fill('林小雨');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
  await page.locator('#e-name').fill('城主');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(2);

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();
  await expect(page.locator('.relation-list li')).toHaveCount(1);
  await expect(page.locator('.relation-list li')).toContainText('林小雨 —敵對→ 城主');

  // Rename 林小雨 in place — if this ever regressed to delete+recreate (a new id),
  // the relation above would show 已刪除 instead of the new name.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const li = page.locator('.entity-list li', { hasText: '林小雨' });
  await li.locator('.e-edit-toggle').click();
  await li.locator('.e-edit-name').fill('林小雨・落雨劍客');
  await li.locator('.e-save').click();
  await expect(page.locator('.entity-list li')).toHaveCount(2);

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('.relation-list li')).toContainText('林小雨・落雨劍客 —敵對→ 城主');
  await expect(page.locator('.relation-list li')).not.toContainText('已刪除');
  await expect.poll(() => page.evaluate(() => {
    const cy = document.querySelector('#cy')._cyInstance;
    return { nodes: cy.nodes().length, edges: cy.edges().length };
  }), { timeout: 5000 }).toEqual({ nodes: 2, edges: 1 });
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
