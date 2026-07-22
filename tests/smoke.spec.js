import { test, expect } from '@playwright/test';

// Regression coverage for #18: PR #13 added cy.destroy() to graph.js to stop a
// Cytoscape instance leak, but cose (the force-directed layout) schedules its own
// animation-frame callbacks — one of those firing after destroy() throws against a
// dead instance. That failure never shows up in the UI (rendering is fine, every
// assertion-based test in the suite still passes) — the only way to catch it is to
// listen for console errors / uncaught page errors directly, which no test in this
// suite did until now. Listeners are registered before page.goto() so nothing
// early (module load, first render) can slip past uninstrumented.
test('clicking through every tab with seeded data produces zero console errors and zero page errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  // Multiple dialogs fire across this test (project name prompt now, possibly more
  // later) — a persistent handler instead of page.once() so none of them hang the run.
  page.on('dialog', (d) => d.accept('冒煙測試'));

  await page.goto('/');

  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('冒煙測試');

  // Seed one entity (設定庫 is already the active tab on a fresh project — no tab
  // click needed here, matching the addEntity() helper convention in graph.spec.js).
  await page.locator('#e-name').fill('主角');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  // Seed one relation (self-loop — same pattern used in tests/graph.spec.js — since
  // this test only needs one entity to exist, not a second one).
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(1);
  await page.locator('#r-source').selectOption({ label: '主角' });
  await page.locator('#r-target').selectOption({ label: '主角' });
  await page.locator('#r-type').fill('自省');
  await page.locator('#r-add').click();
  await expect(page.locator('.relation-list li')).toHaveCount(1);

  // Seed one chapter.
  await page.locator('.tab-btn', { hasText: '大綱' }).click();
  await page.locator('#c-title').fill('第一章');
  await page.locator('#c-add').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(1);

  // Seed one foreshadow entry.
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('伏筆一');
  await page.locator('#f-add').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(1);

  // Now click through every tab in order, including back onto 關係圖 — that's the
  // switch-away-from-graph transition the bug in #18 lives in. Guard each click on
  // the tab not already being active (existing convention across the suite), and
  // wait for each tab's own content to actually render before moving on, so a slow
  // render can't get cut off by the next tab switch.
  const tabs = [
    { name: '設定庫', match: '設定庫', ready: '.entity-list' },
    { name: '關係圖', match: '關係圖', ready: '#cy' },
    { name: '大綱', match: '大綱', ready: '.chapter-list' },
    { name: '伏筆追蹤', match: '伏筆追蹤', ready: '.foreshadow-list' },
    { name: 'AI 助理', match: 'AI 助理', ready: '#ai-input' },
    // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
    { name: '設定', match: /^設定$/, ready: '#ai-save' },
  ];
  for (const tab of tabs) {
    const btn = page.locator('.tab-btn', { hasText: tab.match });
    if (!(await btn.evaluate((el) => el.classList.contains('active')))) await btn.click();
    await expect(page.locator(tab.ready).first()).toBeVisible();
  }

  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
