import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('AI 設定測試'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('AI 設定測試');
  // exact match: substring hasText would also match the pre-existing "設定庫" (entities) tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
});

test('saving a task AI config persists across reload', async ({ page }) => {
  const fieldset = page.locator('fieldset[data-task="consistency"]');
  await fieldset.locator('.ai-provider').selectOption('groq');
  await fieldset.locator('.ai-model').fill('openai/gpt-oss-120b');
  await fieldset.locator('.ai-key').fill('test-key-123');
  await page.locator('#ai-save').click();

  await page.reload();
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const fieldset2 = page.locator('fieldset[data-task="consistency"]');
  await expect(fieldset2.locator('.ai-provider')).toHaveValue('groq');
  await expect(fieldset2.locator('.ai-model')).toHaveValue('openai/gpt-oss-120b');
  await expect(fieldset2.locator('.ai-key')).toHaveValue('test-key-123');
});

test('choosing a provider preset fills base URL and model', async ({ page }) => {
  const fieldset = page.locator('fieldset[data-task="plot"]');
  await fieldset.locator('.ai-provider').selectOption('gemini');
  await expect(fieldset.locator('.ai-base')).toHaveValue(/generativelanguage\.googleapis\.com/);
});
