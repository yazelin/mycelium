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

test('dangling relations (pointing to non-existent entities) do not appear in AI context', async ({ page }) => {
  let capturedSystemMessage = null;

  // Update the stub to capture the system message from the AI context
  await page.route('**/chat/completions', async (route) => {
    const body = route.request().postDataJSON();
    capturedSystemMessage = body.messages[0].content;
    const userMsg = body.messages[body.messages.length - 1].content;
    await route.fulfill({
      json: { choices: [{ message: { role: 'assistant', content: `[mock reply to] ${userMsg}` } }] },
    });
  });

  // Add an entity first
  const entitiesTabBtn = page.locator('.tab-btn', { hasText: '設定庫' });
  if (!(await entitiesTabBtn.evaluate((el) => el.classList.contains('active')))) {
    await entitiesTabBtn.click();
  }
  await page.locator('#e-name').fill('城主');
  await page.locator('#e-add').click();

  // Import a JSON payload with a valid relation AND a dangling relation
  // (pointing to a non-existent entity with id 'missing-entity')
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  const payload = JSON.stringify({
    entities: [{ id: 'e1', name: '城主', aliases: [], type: '人物', tags: [], notes: '' }],
    relations: [
      { id: 'r1', sourceId: 'e1', targetId: 'e1', type: '自我關係' },
      { id: 'r2', sourceId: 'e1', targetId: 'missing-entity', type: '敵對' },
      { id: 'r3', sourceId: 'missing-entity', targetId: 'e1', type: '從屬' },
    ],
    chapters: [],
    foreshadow: [],
    chatlogs: [],
  });

  let importFinished;
  const importFinishedPromise = new Promise((resolve) => { importFinished = resolve; });
  page.on('dialog', async (d) => {
    if (d.type() === 'alert') importFinished();
    await d.accept();
  });

  await page.locator('#import-json').setInputFiles({ name: 'backup-with-dangling.json', mimeType: 'application/json', buffer: Buffer.from(payload, 'utf8') });
  await importFinishedPromise;

  // Switch to AI panel and send a message
  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
  await page.locator('#ai-input').fill('測試');
  await page.locator('#ai-send').click();

  // Verify the system message contains the valid relation but NOT the dangling ones
  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to]');

  // The valid self-relation should be present
  expect(capturedSystemMessage).toContain('城主 —自我關係→ 城主');

  // The dangling relations should NOT be present (no '?' or 'missing-entity')
  expect(capturedSystemMessage).not.toContain('? —敵對→');
  expect(capturedSystemMessage).not.toContain('—從屬→ ?');
  expect(capturedSystemMessage).not.toContain('missing-entity');
});

test('#ai-send is disabled while a request is pending and re-enabled once it resolves', async ({ page }) => {
  let resolveChat;
  const chatGate = new Promise((resolve) => { resolveChat = resolve; });
  await page.route('**/chat/completions', async (route) => {
    await chatGate;
    const body = route.request().postDataJSON();
    const userMsg = body.messages[body.messages.length - 1].content;
    await route.fulfill({
      json: { choices: [{ message: { role: 'assistant', content: `[mock reply to] ${userMsg}` } }] },
    });
  });

  const sendBtn = page.locator('#ai-send');
  await page.locator('#ai-input').fill('林小雨現在幾歲？');
  await sendBtn.click();

  await expect(sendBtn).toBeDisabled();

  resolveChat();
  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to]');
  await expect(sendBtn).toBeEnabled();
});

test('#ai-send is re-enabled after a request that fails', async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({ status: 500, json: { error: { message: '模擬伺服器錯誤' } } });
  });

  const sendBtn = page.locator('#ai-send');
  await page.locator('#ai-input').fill('林小雨現在幾歲？');
  await sendBtn.click();

  await expect(page.locator('.ai-msg.error')).toContainText('模擬伺服器錯誤');
  await expect(sendBtn).toBeEnabled();
});
