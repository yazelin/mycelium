import { test, expect } from '@playwright/test';

async function makeProject(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
}

async function addEntity(page, name) {
  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('#e-name').fill(name);
  await page.locator('#e-add').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await makeProject(page, '關係圖測試');
  await addEntity(page, '陸修');
  await addEntity(page, '魔王');
});

test('adding a relation renders a node graph with an edge', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await page.locator('#r-source').selectOption({ label: '陸修' });
  await page.locator('#r-target').selectOption({ label: '魔王' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();

  await page.waitForTimeout(300); // cytoscape layout settle
  const counts = await page.evaluate(() => {
    const cy = document.querySelector('#cy')._cyInstance;
    return { nodes: cy.nodes().length, edges: cy.edges().length };
  });
  expect(counts.nodes).toBe(2);
  expect(counts.edges).toBe(1);
});
