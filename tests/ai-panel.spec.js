import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    const body = route.request().postDataJSON();
    const userMsg = body.messages[body.messages.length - 1].content;
    await route.fulfill({
      json: { choices: [{ message: { role: 'assistant', content: `[mock reply to] ${userMsg}` } }] },
    });
  });

  await page.goto('/');
  page.once('dialog', (d) => d.accept('AI 助理測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  // configure the default task so chat() has somewhere to send requests
  // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const fieldset = page.locator('fieldset[data-task="default"]');
  await fieldset.locator('.ai-provider').selectOption('custom');
  await fieldset.locator('.ai-base').fill('https://example.invalid/v1');
  await fieldset.locator('.ai-model').fill('test-model');
  await page.locator('#ai-save').click();

  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
});

test('sending a free-form question shows the mocked reply and persists after reload', async ({ page }) => {
  await page.locator('#ai-input').fill('林小雨現在幾歲？');
  await page.locator('#ai-send').click();

  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to] 林小雨現在幾歲？');

  await page.reload();
  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
  await expect(page.locator('.ai-msg.user')).toContainText('林小雨現在幾歲？');
  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to]');
});

test('consistency check uses a default prompt when input is left blank', async ({ page }) => {
  await page.locator('#ai-task').selectOption('consistency');
  await page.locator('#ai-send').click();
  await expect(page.locator('.ai-msg.user')).toContainText('矛盾');
});
