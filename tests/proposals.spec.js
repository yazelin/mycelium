import { test, expect } from '@playwright/test';

// Mocks the GitHub Contents API surface proposals.js talks to
// (repos/yazelin/test-novel/contents/proposals[...]), stateful enough to
// support list -> read -> PUT(applied/<name>) -> DELETE(<name>) round trips.
// Mirrors the approach in tests/github-sync.spec.js.
function installProposalsRoute(page, state) {
  return page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    const req = route.request();
    const path = decodeURIComponent(req.url().split('/contents/')[1]);
    const method = req.method();
    state.requests.push({ method, path });

    if (method === 'GET') {
      if (path === 'proposals') {
        if (!state.dirExists) { await route.fulfill({ status: 404, json: { message: 'Not Found' } }); return; }
        const entries = [];
        for (const [p, f] of state.files) {
          if (!p.startsWith('proposals/')) continue;
          const rest = p.slice('proposals/'.length);
          if (rest.includes('/')) continue; // nested path (e.g. applied/x.json) isn't a top-level entry
          entries.push({ type: 'file', name: rest, path: p, sha: f.sha });
        }
        // A real GitHub listing would include the applied/ subfolder as a
        // `type: 'dir'` entry once anything lives there — assert that
        // listProposals's `type === 'file'` filter keeps it out of results.
        if ([...state.files.keys()].some((p) => p.startsWith('proposals/applied/'))) {
          entries.push({ type: 'dir', name: 'applied', path: 'proposals/applied' });
        }
        await route.fulfill({ json: entries });
        return;
      }
      const file = state.files.get(path);
      if (!file) { await route.fulfill({ status: 404, json: { message: 'Not Found' } }); return; }
      await route.fulfill({ json: { content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64', sha: file.sha } });
      return;
    }

    if (method === 'PUT') {
      const body = req.postDataJSON();
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      const sha = 'sha-' + Math.random().toString(36).slice(2, 8);
      state.files.set(path, { content, sha });
      await route.fulfill({ json: { content: { sha } } });
      return;
    }

    if (method === 'DELETE') {
      state.files.delete(path);
      await route.fulfill({ json: {} });
      return;
    }

    await route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });
}

function makeProposal(overrides = {}) {
  return JSON.stringify({
    version: 1,
    generatedAt: '2026-02-01T09:00:00.000Z',
    source: '第5章',
    note: '測試提案',
    agent: 'mycelium skill',
    entities: [],
    relations: [],
    foreshadow: [],
    ...overrides,
  }, null, 2);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.on('dialog', (d) => d.accept('提案測試'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select')).toContainText('提案測試');

  // entities ("設定庫") is already the active tab right after project creation.
  const entitiesTabBtn = page.locator('.tab-btn', { hasText: '設定庫' });
  if (!(await entitiesTabBtn.evaluate((el) => el.classList.contains('active')))) {
    await entitiesTabBtn.click();
  }
  await page.locator('#e-name').fill('林小雨');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  // exact match: substring hasText would also match the pre-existing "設定庫" tab
  await page.locator('.tab-btn', { hasText: /^設定$/ }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');
  await page.locator('#gh-save').click();
});

test('lists proposals newest first with generatedAt/source/note/agent metadata', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  state.files.set('proposals/20260101-090000.json', {
    sha: 'sha-a',
    content: makeProposal({ generatedAt: '2026-01-01T09:00:00.000Z', source: '第1章', note: '舊提案', agent: 'mycelium skill' }),
  });
  state.files.set('proposals/20260201-090000.json', {
    sha: 'sha-b',
    content: makeProposal({ generatedAt: '2026-02-01T09:00:00.000Z', source: '第5章', note: '新提案', agent: 'mycelium skill' }),
  });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-status')).toContainText('找到 2 份提案');

  const items = page.locator('#pr-list li');
  await expect(items).toHaveCount(2);
  // newest first
  await expect(items.nth(0)).toContainText('20260201-090000.json');
  await expect(items.nth(0)).toContainText('第5章');
  await expect(items.nth(0)).toContainText('新提案');
  await expect(items.nth(0)).toContainText('mycelium skill');
  await expect(items.nth(1)).toContainText('20260101-090000.json');
  await expect(items.nth(1)).toContainText('第1章');
});

test('applying writes exactly the ticked items, unticked ones are skipped', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  state.files.set('proposals/20260201-090000.json', {
    sha: 'sha-orig',
    content: makeProposal({
      entities: [
        { name: '城主', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
        { name: '黑袍人', aliasOf: null, type: '人物', notes: '神秘人物', reason: '本章登場但身份未明' },
      ],
      relations: [
        { source: '林小雨', target: '城主', type: '追殺', reason: '城主軍全境追殺林小雨' },
      ],
      foreshadow: [
        { title: '林小雨的真實身份', notes: '暗示她是城主早年的徒弟', reason: '城主的台詞埋了伏筆' },
      ],
    }),
  });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await page.locator('.pr-open').click();
  await expect(page.locator('#pr-entities li')).toHaveCount(2);

  // Untick the second entity candidate and the foreshadow candidate; leave
  // the first entity and the relation ticked.
  await page.locator('#pr-entities li').nth(1).locator('input').uncheck();
  await page.locator('#pr-foreshadow li').nth(0).locator('input').uncheck();

  // beforeEach already registered a persistent page.on('dialog', accept) —
  // #pr-apply's own success/failure alert lands there, so just click and let
  // the DOM assertions below (Playwright's expect auto-retries) be the proof.
  await page.locator('#pr-apply').click();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(2); // 林小雨 + 城主 only, 黑袍人 skipped

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('.relation-list li')).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(0);
});

test('an alias candidate merges into the existing entity instead of creating a duplicate', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  state.files.set('proposals/20260201-090000.json', {
    sha: 'sha-orig',
    content: makeProposal({
      entities: [
        { name: '白衣客', aliasOf: '林小雨', type: null, notes: null, reason: '本章林小雨換裝後的稱號' },
      ],
    }),
  });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await page.locator('.pr-open').click();
  await expect(page.locator('#pr-entities li')).toHaveCount(1);
  await expect(page.locator('#pr-entities li').nth(0)).toContainText('合併為「林小雨」的別名');

  // beforeEach already registered a persistent page.on('dialog', accept) —
  // #pr-apply's own success/failure alert lands there, so just click and let
  // the DOM assertions below (Playwright's expect auto-retries) be the proof.
  await page.locator('#pr-apply').click();

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(1); // still just 林小雨 — no duplicate created
  await expect(page.locator('.entity-list li')).toContainText('白衣客');
});

test('an applied proposal is moved to proposals/applied/ and does not reappear in the list', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  state.files.set('proposals/20260201-090000.json', {
    sha: 'sha-orig',
    content: makeProposal({
      entities: [{ name: '城主', aliasOf: null, type: '人物', notes: '', reason: '新角色' }],
    }),
  });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-list li')).toHaveCount(1);
  await page.locator('.pr-open').click();

  // beforeEach already registered a persistent page.on('dialog', accept) —
  // #pr-apply's own success/failure alert lands there, so just click and let
  // the DOM assertions below (Playwright's expect auto-retries) be the proof.
  await page.locator('#pr-apply').click();

  // #pr-apply's own handler already re-lists after marking the proposal applied.
  await expect(page.locator('#pr-status')).toContainText('沒有可套用的提案', { timeout: 10_000 });
  await expect(page.locator('#pr-list li')).toHaveCount(0);

  expect(state.files.has('proposals/20260201-090000.json')).toBe(false);
  expect(state.files.has('proposals/applied/20260201-090000.json')).toBe(true);

  // Explicit re-list, in case the state above was a fluke of not re-fetching.
  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-status')).toContainText('沒有可套用的提案');
  await expect(page.locator('#pr-list li')).toHaveCount(0);
});

test('a malformed proposal is refused with a clear error and changes nothing', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  state.files.set('proposals/20260201-090000.json', {
    sha: 'sha-bad',
    // entities must be an array — this is a broken/hand-edited proposal file.
    content: JSON.stringify({ version: 1, generatedAt: '2026-02-01T09:00:00.000Z', entities: 'oops', relations: [], foreshadow: [] }),
  });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-list li')).toHaveCount(1);
  await expect(page.locator('#pr-list li')).toContainText('格式不正確');
  await expect(page.locator('.pr-open')).toHaveCount(0); // no way to open/apply a malformed one

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(1); // only 林小雨 from beforeEach, untouched
});

test('a missing proposals/ directory shows a clear message and changes nothing (issue #4 regression)', async ({ page }) => {
  const state = { dirExists: false, files: new Map(), requests: [] };
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-status')).toContainText('還沒有 proposals');
  await expect(page.locator('#pr-list li')).toHaveCount(0);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
});

test('an empty proposals/ directory (only applied/ inside) shows a clear message and changes nothing', async ({ page }) => {
  const state = { dirExists: true, files: new Map(), requests: [] };
  // Only a file already living under applied/ — proposals/ itself resolves
  // as a directory but has no top-level proposal file to apply.
  state.files.set('proposals/applied/20260101-000000.json', { sha: 'sha-old', content: makeProposal() });
  await installProposalsRoute(page, state);

  await page.locator('#pr-refresh').click();
  await expect(page.locator('#pr-status')).toContainText('沒有可套用的提案');
  await expect(page.locator('#pr-list li')).toHaveCount(0);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
});
