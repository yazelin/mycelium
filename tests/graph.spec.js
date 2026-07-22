import { test, expect } from '@playwright/test';

async function makeProject(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('#project-new').click();
  // Wait for new project to appear in select (look for the project name text in options)
  await expect(page.locator('#project-select')).toContainText(name);
}

async function addEntity(page, name) {
  // Only click tab if not already active (avoid redundant re-render race)
  const tabBtn = page.locator('.tab-btn', { hasText: '設定庫' });
  if (!(await tabBtn.evaluate(el => el.classList.contains('active')))) {
    await tabBtn.click();
    // Wait for render to settle if we triggered a tab switch
    await expect(page.locator('.entity-list')).toBeVisible();
  }
  const prevCount = await page.locator('.entity-list li').count();
  await page.locator('#e-name').fill(name);
  await page.locator('#e-add').click();
  // Wait for entity to be persisted to DB
  await expect(page.locator('.entity-list li')).toHaveCount(prevCount + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await makeProject(page, '關係圖測試');
  await addEntity(page, '林小雨');
  await addEntity(page, '城主');
});

async function graphCounts(page) {
  return page.evaluate(() => {
    const cy = document.querySelector('#cy')._cyInstance;
    return { nodes: cy.nodes().length, edges: cy.edges().length };
  });
}

test('adding a relation renders a node graph with an edge', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  // Wait for options to populate (entities loaded from DB)
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await expect(page.locator('#r-target option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();

  // Poll for cytoscape to render both nodes and edge (layout settle)
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 2, edges: 1 });
});

test('deleting an entity that has a relation cascades the relation and leaves 關係圖 fully working', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 2, edges: 1 });

  // Delete 林小雨 from 設定庫 — it has a relation pointing at it, so a confirm should fire.
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(2);
  page.once('dialog', (d) => d.accept());
  const protagonistLi = page.locator('.entity-list li', { hasText: '林小雨' });
  await protagonistLi.locator('.e-delete').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  // 關係圖 tab must still render (not aborted by a dangling edge), the orphaned
  // relation must be gone, and #r-add must still be wired up (recovery check:
  // add a brand new relation using only the surviving entity as both ends —
  // Cytoscape allows a self-loop edge, this just proves the listener works).
  // Wait for #cy to actually exist before evaluating against it — otherwise a
  // page.evaluate() can land between the tab click and renderGraphTab's
  // innerHTML write and throw on a null container, independent of the bug
  // under test.
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#cy')).toBeVisible();
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 1, edges: 0 });
  await expect(page.locator('.relation-list li')).toHaveCount(0);

  await page.locator('#r-source').selectOption({ label: '城主' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('自省');
  await page.locator('#r-add').click();
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 1, edges: 1 });
});

test('dismissing the delete confirm on a relation leaves it in place', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();
  await expect(page.locator('.relation-list li')).toHaveCount(1);

  page.once('dialog', (d) => d.dismiss());
  await page.locator('.relation-list .r-delete').click();
  await expect(page.locator('.relation-list li')).toHaveCount(1);
});

test('accepting the delete confirm removes a relation directly from the graph', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 2, edges: 1 });
  await expect(page.locator('.relation-list li')).toHaveCount(1);

  page.once('dialog', (d) => d.accept());
  await page.locator('.relation-list .r-delete').click();
  await expect(page.locator('.relation-list li')).toHaveCount(0);
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 2, edges: 0 });
});

// Regression tests for #6: graph.js used to leak a Cytoscape instance (window
// listeners + animation loop) on every re-render and every tab switch, because
// container.innerHTML was discarded without ever calling cy.destroy(). Cytoscape
// exposes destroyed() on an instance after destroy() runs, so we assert on that
// directly instead of adding a separate test-only counter.

test('adding a relation (an internal re-render) destroys the previous Cytoscape instance', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '林小雨' });
  await page.locator('#r-target').selectOption({ label: '城主' });
  await page.locator('#r-type').fill('敵對');
  await page.evaluate(() => { window.__prevCy = document.querySelector('#cy')._cyInstance; });

  await page.locator('#r-add').click();
  await expect.poll(() => graphCounts(page), { timeout: 5000 }).toEqual({ nodes: 2, edges: 1 });

  const result = await page.evaluate(() => ({
    prevDestroyed: window.__prevCy.destroyed(),
    isNewInstance: document.querySelector('#cy')._cyInstance !== window.__prevCy,
  }));
  expect(result.prevDestroyed).toBe(true);
  expect(result.isNewInstance).toBe(true);
});

test('switching away from 關係圖 destroys its Cytoscape instance', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#cy')).toBeVisible();
  await page.evaluate(() => { window.__prevCy = document.querySelector('#cy')._cyInstance; });

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list')).toBeVisible();

  const prevDestroyed = await page.evaluate(() => window.__prevCy.destroyed());
  expect(prevDestroyed).toBe(true);
});

test('repeated visits to 關係圖 never leave more than one live Cytoscape instance', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#cy')).toBeVisible();

  const visits = 4;
  for (let i = 0; i < visits; i++) {
    await page.evaluate((idx) => {
      window.__instances = window.__instances || [];
      window.__instances[idx] = document.querySelector('#cy')._cyInstance;
    }, i);
    await page.locator('.tab-btn', { hasText: '設定庫' }).click();
    await expect(page.locator('.entity-list')).toBeVisible();
    await page.locator('.tab-btn', { hasText: '關係圖' }).click();
    await expect(page.locator('#cy')).toBeVisible();
  }

  // Every instance captured on a past visit must be destroyed by now — none of them
  // are still alive holding onto window listeners / animation loops.
  const allPastDestroyed = await page.evaluate(() => window.__instances.every((cy) => cy.destroyed()));
  expect(allPastDestroyed).toBe(true);
  // ...while the currently active tab still has exactly one working, live instance.
  const currentAlive = await page.evaluate(() => !document.querySelector('#cy')._cyInstance.destroyed());
  expect(currentAlive).toBe(true);
});
