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
  await addEntity(page, '陸修');
  await addEntity(page, '魔王');
});

test('adding a relation renders a node graph with an edge', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  // Wait for options to populate (entities loaded from DB)
  await expect(page.locator('#r-source option')).toHaveCount(2);
  await expect(page.locator('#r-target option')).toHaveCount(2);
  await page.locator('#r-source').selectOption({ label: '陸修' });
  await page.locator('#r-target').selectOption({ label: '魔王' });
  await page.locator('#r-type').fill('敵對');
  await page.locator('#r-add').click();

  // Poll for cytoscape to render both nodes and edge (layout settle)
  await expect.poll(
    async () => {
      const counts = await page.evaluate(() => {
        const cy = document.querySelector('#cy')._cyInstance;
        return { nodes: cy.nodes().length, edges: cy.edges().length };
      });
      return counts;
    },
    { timeout: 5000 }
  ).toEqual({ nodes: 2, edges: 1 });
});
