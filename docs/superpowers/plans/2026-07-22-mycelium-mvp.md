# mycelium MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working `mycelium` web app — a purely front-end, GitHub-Pages-hosted, multi-project novel/IP creation assistant with worldbuilding entities, a draggable relationship graph, chapter outlines, foreshadow tracking, and multi-provider AI assistance.

**Architecture:** Vanilla JS ES modules, no build step. Each feature (entities/graph/chapters/foreshadow/AI/settings) is its own module exporting a `render(projectId, container)` function; `app.js` wires up a project switcher (backed by a small IndexedDB metadata store) and a tab bar that calls the active tab's `render`. Every module re-reads from IndexedDB on render — no duplicated in-memory state to keep in sync.

**Tech Stack:** Vanilla JS (ES modules), IndexedDB (native, no wrapper library), Cytoscape.js (vendored, for the relationship graph), Playwright (tests), `python3 -m http.server` (local dev), GitHub Pages (hosting), GitHub Contents API (per-project data sync), OpenAI-compatible `/chat/completions` endpoints (AI providers: llmshare/Groq/OpenAI/Gemini/OpenRouter/Ollama/custom).

## Global Constraints

- No build step — every file must run directly via `<script type="module">` / plain `<script>`, servable as static files from GitHub Pages.
- No new npm runtime dependencies. Playwright is the only devDependency. Cytoscape is vendored as a plain `<script>` (attaches `window.cytoscape`), not npm-installed.
- All credentials (AI provider keys, GitHub PAT) are entered manually by the user and stored only in `localStorage` — never hardcoded, never committed.
- `entities` records always carry an `aliases: string[]` field (see spec §資料模型) — this is how identity-reveal plot twists avoid creating duplicate entities.
- AI task configuration (`localStorage['mycelium-ai'].tasks`) is a plain open-ended object keyed by task id, not a fixed enum in the data layer — new task types (future comic/anime/film AI tasks) must be addable by adding a UI entry only, no schema change.
- AI calls never write to the database directly. Every AI output that would create/modify data (the 抽取圖資料 flow) requires an explicit user confirmation (checkbox + apply button) before any `putRecord` call.
- GitHub sync is always manually triggered (a button click) — never automatic/background.
- Traditional Chinese (zh-TW) for all UI copy.
- Spec: `docs/superpowers/specs/2026-07-22-mycelium-design.md`

---

## Task 1: Repo scaffold + project switcher

**Files:**
- Create: `package.json`
- Create: `playwright.config.js`
- Create: `.gitignore`
- Create: `index.html`
- Create: `style.css`
- Create: `db.js`
- Create: `app.js`
- Create: `README.md`
- Test: `tests/project-switcher.spec.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `db.js`: `listProjects(): Promise<{id,name,repo,createdAt}[]>`, `createProject(name: string): Promise<Project>`, `updateProjectMeta(id: string, patch: object): Promise<Project>`, `deleteProjectMeta(id: string): Promise<void>`, `PROJECT_STORES: string[]` (`['entities','relations','chapters','foreshadow','chatlogs']`), `getAllRecords(projectId: string, store: string): Promise<object[]>`, `putRecord(projectId: string, store: string, record: object): Promise<object>` (assigns `id` if missing), `deleteRecord(projectId: string, store: string, id: string): Promise<void>`
  - `app.js`: internal `TABS` registry object — later tasks modify this file to add `import` + `TABS[id] = { label, render }` entries. No exports needed from `app.js` itself.

- [ ] **Step 1: Initialize project and Playwright**

```bash
cd ~/mycelium
```

Write `package.json`:

```json
{
  "name": "mycelium",
  "private": true,
  "type": "module",
  "description": "多作品小說/IP 創作輔助工具（世界觀設定、人物關係圖、大綱、伏筆追蹤、AI 輔助）",
  "scripts": {
    "test": "playwright test",
    "serve": "python3 -m http.server 8919"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.1"
  }
}
```

Write `playwright.config.js`:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8919',
    locale: 'zh-TW',
  },
  webServer: {
    command: 'python3 -m http.server 8919 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8919',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
```

Write `.gitignore`:

```
node_modules/
test-results/
playwright-report/
```

Run:

```bash
npm install
npx playwright install chromium
```

- [ ] **Step 2: Write the failing test**

`tests/project-switcher.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('creating a project adds it to the switcher and selects it', async ({ page }) => {
  page.once('dialog', (d) => d.accept('我的小說'));
  await page.locator('#project-new').click();
  await expect(page.locator('#project-select option', { hasText: '我的小說' })).toHaveCount(1);
  await expect(page.locator('#project-select')).not.toHaveValue('');
});

test('two projects stay separate and survive a reload', async ({ page }) => {
  page.once('dialog', (d) => d.accept('作品A'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  page.once('dialog', (d) => d.accept('作品B'));
  await page.locator('#project-new').click();

  await expect(page.locator('#project-select option')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('#project-select option')).toHaveCount(2);
});

test('deleting the current project removes it from the switcher', async ({ page }) => {
  page.once('dialog', (d) => d.accept('要刪除的'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  page.once('dialog', (d) => d.accept());
  await page.locator('#project-delete').click();
  await expect(page.locator('#project-select option')).toHaveCount(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx playwright test tests/project-switcher.spec.js`
Expected: FAIL — `index.html` / `#project-new` doesn't exist yet (connection refused or element not found).

- [ ] **Step 4: Write minimal implementation**

`db.js`:

```js
'use strict';

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const META_DB = 'mycelium-meta';
const META_STORE = 'projects';
let metaDBPromise = null;
function metaDB() {
  if (!metaDBPromise) {
    metaDBPromise = openDB(META_DB, 1, (db) => {
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
    });
  }
  return metaDBPromise;
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function listProjects() {
  const db = await metaDB();
  return reqToPromise(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll());
}

export async function createProject(name) {
  const db = await metaDB();
  const project = { id: newId('p'), name, repo: null, createdAt: Date.now() };
  await reqToPromise(db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).add(project));
  return project;
}

export async function updateProjectMeta(id, patch) {
  const db = await metaDB();
  const store = db.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  const existing = await reqToPromise(store.get(id));
  const updated = Object.assign({}, existing, patch);
  await reqToPromise(store.put(updated));
  return updated;
}

export async function deleteProjectMeta(id) {
  const db = await metaDB();
  await reqToPromise(db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).delete(id));
  indexedDB.deleteDatabase('mycelium-project-' + id);
}

export const PROJECT_STORES = ['entities', 'relations', 'chapters', 'foreshadow', 'chatlogs'];
const projectDBCache = {};
function projectDB(projectId) {
  if (!projectDBCache[projectId]) {
    projectDBCache[projectId] = openDB('mycelium-project-' + projectId, 1, (db) => {
      for (const store of PROJECT_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    });
  }
  return projectDBCache[projectId];
}

export async function getAllRecords(projectId, store) {
  const db = await projectDB(projectId);
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function putRecord(projectId, store, record) {
  const db = await projectDB(projectId);
  if (!record.id) record.id = newId(store[0]);
  await reqToPromise(db.transaction(store, 'readwrite').objectStore(store).put(record));
  return record;
}

export async function deleteRecord(projectId, store, id) {
  const db = await projectDB(projectId);
  await reqToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(id));
}
```

`index.html`:

```html
<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mycelium — 小說創作輔助</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header id="project-bar">
  <select id="project-select"></select>
  <button id="project-new" type="button">新作品</button>
  <button id="project-delete" type="button">刪除目前作品</button>
</header>
<nav id="tabs"></nav>
<main id="tab-content"></main>
<script type="module" src="app.js"></script>
</body>
</html>
```

`style.css`:

```css
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 0; background: #f4f6f4; color: #1a2420; }
#project-bar { display: flex; gap: .5rem; padding: .75rem 1rem; background: #2d4a3e; color: #fff; align-items: center; }
#project-bar select { flex: 1; max-width: 20rem; }
#tabs { display: flex; gap: .25rem; padding: .5rem 1rem 0; background: #fff; border-bottom: 1px solid #ddd; }
.tab-btn { border: none; background: transparent; padding: .5rem 1rem; cursor: pointer; border-bottom: 2px solid transparent; }
.tab-btn.active { border-bottom-color: #2d4a3e; font-weight: bold; }
#tab-content { padding: 1rem; max-width: 60rem; margin: 0 auto; }
.empty { color: #666; }
textarea { width: 100%; min-height: 4rem; }
input, select, textarea { font: inherit; }
li.overdue { background: #fde2e2; }
```

`app.js`:

```js
'use strict';
import { listProjects, createProject, deleteProjectMeta } from './db.js';

// Later tasks add one `import { renderXTab } from './x.js'` + one
// `TABS.x = { label: '...', render: renderXTab };` line each. Keep this
// object literal, don't refactor to a registration function — every
// caller already has direct access to this module at build time.
const TABS = {};

let currentProjectId = null;
let currentTab = null;

function $(sel) { return document.querySelector(sel); }

function renderTabsNav() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const id of Object.keys(TABS)) {
    const btn = document.createElement('button');
    btn.textContent = TABS[id].label;
    btn.className = 'tab-btn' + (id === currentTab ? ' active' : '');
    btn.addEventListener('click', () => selectTab(id));
    nav.appendChild(btn);
  }
}

function selectTab(id) {
  currentTab = id;
  renderTabsNav();
  renderCurrentTab();
}

function renderCurrentTab() {
  const container = $('#tab-content');
  if (!currentProjectId) { container.innerHTML = '<p class="empty">先建立一個作品專案。</p>'; return; }
  if (!currentTab) { container.innerHTML = '<p class="empty">尚無分頁。</p>'; return; }
  TABS[currentTab].render(currentProjectId, container);
}

function selectProject(id) {
  currentProjectId = id;
  localStorage.setItem('mycelium-last-project', id);
  if (!currentTab) currentTab = Object.keys(TABS)[0] || null;
  renderTabsNav();
  renderCurrentTab();
}

async function refreshProjectSelect(preferredId) {
  const projects = await listProjects();
  const sel = $('#project-select');
  sel.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (projects.length) {
    const keep = projects.some((p) => p.id === preferredId) ? preferredId
      : projects.some((p) => p.id === currentProjectId) ? currentProjectId
      : projects[0].id;
    sel.value = keep;
    selectProject(keep);
  } else {
    currentProjectId = null;
    renderCurrentTab();
  }
}

async function boot() {
  $('#project-new').addEventListener('click', async () => {
    const name = prompt('新作品名稱？');
    if (!name) return;
    const project = await createProject(name);
    await refreshProjectSelect(project.id); // switch straight to the new project, don't strand the user on the old one
  });
  $('#project-delete').addEventListener('click', async () => {
    if (!currentProjectId) return;
    if (!confirm('確定刪除這個作品？所有資料會一併刪除，無法復原。')) return;
    await deleteProjectMeta(currentProjectId);
    currentProjectId = null;
    await refreshProjectSelect();
  });
  $('#project-select').addEventListener('change', (e) => selectProject(e.target.value));
  // restore whichever project was open last time, so a reload doesn't strand the user on an arbitrary one
  await refreshProjectSelect(localStorage.getItem('mycelium-last-project') || undefined);
}

boot();
```

`README.md`:

```markdown
# mycelium

多作品小說 / IP 創作輔助工具。純前端、無 build 步驟，發布在 GitHub Pages。

管理世界觀設定（含別名，應對身份反轉劇情）、人物關係圖、章節大綱、伏筆追蹤，並整合多個 AI provider（llmshare/Groq/OpenAI/Gemini/OpenRouter/Ollama/自訂）做一致性檢查、劇情發想、抽取圖資料、自由問答。

每部作品可各自綁定一個你自己的 private GitHub repo 做雲端備份（見「設定」分頁）。

設計文件：`docs/superpowers/specs/2026-07-22-mycelium-design.md`

## 本地開發

```bash
npm install
npx playwright install chromium
npm run serve      # 另開一個 terminal，http://127.0.0.1:8919
npm test           # 跑 Playwright 測試
```
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/project-switcher.spec.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json playwright.config.js .gitignore index.html style.css db.js app.js README.md tests/project-switcher.spec.js package-lock.json
git commit -m "feat: scaffold app shell + project switcher over IndexedDB"
```

---

## Task 2: Entity CRUD (設定庫)

**Files:**
- Create: `util.js`
- Create: `entities.js`
- Modify: `app.js` (add import + `TABS.entities` entry)
- Test: `tests/entities.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord`, `deleteRecord` (Task 1)
- Produces:
  - `util.js`: `esc(s: any): string` — HTML-escapes a value for safe interpolation into `innerHTML`
  - `entities.js`: `renderEntitiesTab(projectId: string, container: HTMLElement): Promise<void>` — Entity record shape: `{ id, name, aliases: string[], type: string, tags: string[], notes: string }`

- [ ] **Step 1: Write the failing test**

`tests/entities.spec.js`:

```js
import { test, expect } from '@playwright/test';

async function makeProject(page, name) {
  page.once('dialog', (d) => d.accept(name));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await makeProject(page, '測試作品');
});

test('adding an entity with aliases shows it in the list', async ({ page }) => {
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-aliases').fill('轉生者, 巨大模型檔案');
  await page.locator('#e-type').fill('人物');
  await page.locator('#e-notes').fill('主角，token 無限。');
  await page.locator('#e-add').click();

  const item = page.locator('.entity-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('陸修');
  await expect(item).toContainText('轉生者');
  await expect(item).toContainText('巨大模型檔案');
});

test('deleting an entity removes it from the list', async ({ page }) => {
  await page.locator('#e-name').fill('待刪除');
  await page.locator('#e-add').click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);

  await page.locator('.e-delete').click();
  await expect(page.locator('.entity-list li')).toHaveCount(0);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/entities.spec.js`
Expected: FAIL — `#e-name` doesn't exist (entities tab not registered).

- [ ] **Step 3: Write minimal implementation**

`util.js`:

```js
'use strict';
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

`entities.js`:

```js
'use strict';
import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { esc } from './util.js';

function splitList(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function renderEntitiesTab(projectId, container) {
  const entities = await getAllRecords(projectId, 'entities');

  container.innerHTML = `
    <section class="entity-form">
      <h2>新增設定</h2>
      <input id="e-name" placeholder="名稱">
      <input id="e-aliases" placeholder="別名（逗號分隔）">
      <input id="e-type" placeholder="類型（人物/地點/勢力/概念…）">
      <input id="e-tags" placeholder="標籤（逗號分隔）">
      <textarea id="e-notes" placeholder="備註/設定內容"></textarea>
      <button id="e-add" type="button">新增</button>
    </section>
    <ul class="entity-list">
      ${entities.map((e) => `
        <li data-id="${e.id}">
          <strong>${esc(e.name)}</strong>
          ${e.aliases && e.aliases.length ? `<span class="aliases">（別名：${e.aliases.map(esc).join('、')}）</span>` : ''}
          <span class="type">${esc(e.type)}</span>
          <p>${esc(e.notes)}</p>
          <button class="e-delete" type="button">刪除</button>
        </li>`).join('')}
    </ul>
  `;

  container.querySelector('#e-add').addEventListener('click', async () => {
    const name = container.querySelector('#e-name').value.trim();
    if (!name) return;
    await putRecord(projectId, 'entities', {
      name,
      aliases: splitList(container.querySelector('#e-aliases').value),
      type: container.querySelector('#e-type').value.trim(),
      tags: splitList(container.querySelector('#e-tags').value),
      notes: container.querySelector('#e-notes').value.trim(),
    });
    renderEntitiesTab(projectId, container);
  });

  container.querySelectorAll('.e-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      await deleteRecord(projectId, 'entities', id);
      renderEntitiesTab(projectId, container);
    });
  });
}
```

Modify `app.js` — add near the top with the other import, and add one line inside `boot()` before `await refreshProjectSelect();` (or anywhere before first render, e.g. right after the `TABS` declaration):

```js
import { renderEntitiesTab } from './entities.js';
```

```js
TABS.entities = { label: '設定庫', render: renderEntitiesTab };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/entities.spec.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add util.js entities.js app.js tests/entities.spec.js
git commit -m "feat: entity CRUD with alias field (設定庫)"
```

---

## Task 3: Relation CRUD + Cytoscape 關係圖

**Files:**
- Create: `vendor/cytoscape.min.js` (vendored, not hand-written)
- Create: `graph.js`
- Modify: `index.html` (add `<script src="vendor/cytoscape.min.js"></script>` before the `app.js` module script)
- Modify: `app.js` (add import + `TABS.graph` entry)
- Test: `tests/graph.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord` (Task 1); `window.cytoscape` global (vendored library)
- Produces: `graph.js`: `renderGraphTab(projectId, container): Promise<void>` — Relation record shape: `{ id, sourceId, targetId, type, notes }`

- [ ] **Step 1: Vendor Cytoscape**

```bash
curl -sL https://unpkg.com/cytoscape@3.30.1/dist/cytoscape.min.js -o vendor/cytoscape.min.js
```

Verify it downloaded (should be several hundred KB, minified UMD build that sets `window.cytoscape`):

```bash
head -c 200 vendor/cytoscape.min.js
```

- [ ] **Step 2: Write the failing test**

`tests/graph.spec.js`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx playwright test tests/graph.spec.js`
Expected: FAIL — `#r-source` doesn't exist (graph tab not registered).

- [ ] **Step 4: Write minimal implementation**

`graph.js`:

```js
'use strict';
import { getAllRecords, putRecord } from './db.js';

export async function renderGraphTab(projectId, container) {
  const [entities, relations] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
  ]);

  container.innerHTML = `
    <section class="relation-form">
      <h2>新增關係</h2>
      <select id="r-source">${entities.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
      <select id="r-target">${entities.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
      <input id="r-type" placeholder="關係類型（敵對/從屬/師徒…）">
      <button id="r-add" type="button">新增</button>
    </section>
    <div id="cy" style="width:100%;height:500px;border:1px solid #ccc;"></div>
  `;

  const cyEl = container.querySelector('#cy');
  const cy = window.cytoscape({
    container: cyEl,
    elements: [
      ...entities.map((e) => ({ data: { id: e.id, label: e.name } })),
      ...relations.map((r) => ({ data: { id: r.id, source: r.sourceId, target: r.targetId, label: r.type } })),
    ],
    style: [
      { selector: 'node', style: { label: 'data(label)', 'background-color': '#2d4a3e', color: '#fff', 'text-valign': 'center', 'font-size': 12 } },
      { selector: 'edge', style: { label: 'data(label)', width: 2, 'line-color': '#999', 'target-arrow-color': '#999', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 10 } },
    ],
    layout: { name: 'cose' },
  });
  cyEl._cyInstance = cy; // test hook — inspected directly in tests/graph.spec.js

  cy.on('tap', 'node', (evt) => {
    const entity = entities.find((e) => e.id === evt.target.id());
    if (entity) alert(`${entity.name}\n類型：${entity.type || '（無）'}\n${entity.notes || ''}`);
  });

  container.querySelector('#r-add').addEventListener('click', async () => {
    const sourceId = container.querySelector('#r-source').value;
    const targetId = container.querySelector('#r-target').value;
    const type = container.querySelector('#r-type').value.trim();
    if (!sourceId || !targetId || !type) return;
    await putRecord(projectId, 'relations', { sourceId, targetId, type });
    renderGraphTab(projectId, container);
  });
}
```

Modify `index.html` — add before the `app.js` module script tag:

```html
<script src="vendor/cytoscape.min.js"></script>
<script type="module" src="app.js"></script>
```

Modify `app.js` — add import and registry line (same pattern as Task 2):

```js
import { renderGraphTab } from './graph.js';
```

```js
TABS.graph = { label: '關係圖', render: renderGraphTab };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/graph.spec.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add vendor/cytoscape.min.js graph.js index.html app.js tests/graph.spec.js
git commit -m "feat: relation CRUD + Cytoscape relationship graph"
```

Note: node positions are not persisted — the graph re-runs the `cose` force-directed layout on every render. Dragging is interactive within a session but resets on reload. Add position persistence later only if this proves annoying in practice.

---

## Task 4: Chapter 大綱

**Files:**
- Create: `chapters.js`
- Modify: `app.js` (add import + `TABS.chapters` entry)
- Test: `tests/chapters.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord`, `deleteRecord`; `util.js` → `esc`
- Produces: `chapters.js`: `renderChaptersTab(projectId, container): Promise<void>` — Chapter record shape: `{ id, volume: number, order: number, title, status: '未寫'|'草稿'|'完稿', wordCount: number, summary, content }`

- [ ] **Step 1: Write the failing test**

`tests/chapters.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('大綱測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  await page.locator('.tab-btn', { hasText: '大綱' }).click();
});

test('adding a chapter shows it in the list with progress stats', async ({ page }) => {
  await page.locator('#c-volume').fill('1');
  await page.locator('#c-title').fill('轉生與初次詠唱');
  await page.locator('#c-status').selectOption('完稿');
  await page.locator('#c-wordcount').fill('3200');
  await page.locator('#c-summary').fill('陸修轉生，發現 Token 無限。');
  await page.locator('#c-add').click();

  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.chapter-list li')).toContainText('轉生與初次詠唱');
  await expect(page.locator('.chapter-stats')).toContainText('完稿 1');
});

test('deleting a chapter removes it', async ({ page }) => {
  await page.locator('#c-title').fill('待刪章節');
  await page.locator('#c-add').click();
  await page.locator('.c-delete').click();
  await expect(page.locator('.chapter-list li')).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/chapters.spec.js`
Expected: FAIL — `#c-volume` doesn't exist (chapters tab not registered).

- [ ] **Step 3: Write minimal implementation**

`chapters.js`:

```js
'use strict';
import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { esc } from './util.js';

export const CHAPTER_STATUSES = ['未寫', '草稿', '完稿'];

export async function renderChaptersTab(projectId, container) {
  const chapters = await getAllRecords(projectId, 'chapters');
  chapters.sort((a, b) => (a.volume - b.volume) || (a.order - b.order));
  const counts = CHAPTER_STATUSES.reduce((acc, s) => ({ ...acc, [s]: chapters.filter((c) => c.status === s).length }), {});

  container.innerHTML = `
    <section class="chapter-form">
      <h2>新增章節</h2>
      <input id="c-volume" type="number" placeholder="卷數" value="1">
      <input id="c-title" placeholder="章節標題">
      <select id="c-status">${CHAPTER_STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
      <input id="c-wordcount" type="number" placeholder="字數" value="0">
      <textarea id="c-summary" placeholder="大綱摘要"></textarea>
      <textarea id="c-content" placeholder="正文（選填）"></textarea>
      <button id="c-add" type="button">新增</button>
    </section>
    <p class="chapter-stats">進度：${CHAPTER_STATUSES.map((s) => `${s} ${counts[s]}`).join('・')}</p>
    <ul class="chapter-list">
      ${chapters.map((c) => `
        <li data-id="${c.id}">
          <strong>第${c.volume}卷・${esc(c.title)}</strong>
          <span class="status">${esc(c.status)}</span>
          <span class="wordcount">${c.wordCount || 0} 字</span>
          <p>${esc(c.summary)}</p>
          <button class="c-delete" type="button">刪除</button>
        </li>`).join('')}
    </ul>
  `;

  container.querySelector('#c-add').addEventListener('click', async () => {
    const title = container.querySelector('#c-title').value.trim();
    if (!title) return;
    await putRecord(projectId, 'chapters', {
      volume: +container.querySelector('#c-volume').value || 1,
      order: chapters.length,
      title,
      status: container.querySelector('#c-status').value,
      wordCount: +container.querySelector('#c-wordcount').value || 0,
      summary: container.querySelector('#c-summary').value.trim(),
      content: container.querySelector('#c-content').value.trim(),
    });
    renderChaptersTab(projectId, container);
  });

  container.querySelectorAll('.c-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      await deleteRecord(projectId, 'chapters', id);
      renderChaptersTab(projectId, container);
    });
  });
}
```

Modify `app.js`:

```js
import { renderChaptersTab } from './chapters.js';
```

```js
TABS.chapters = { label: '大綱', render: renderChaptersTab };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/chapters.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add chapters.js app.js tests/chapters.spec.js
git commit -m "feat: chapter outline with progress stats (大綱)"
```

---

## Task 5: Foreshadow 追蹤（伏筆）

**Files:**
- Create: `foreshadow.js`
- Modify: `app.js` (add import + `TABS.foreshadow` entry)
- Test: `tests/foreshadow.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord`, `deleteRecord`; `util.js` → `esc`; `chapters.js` → `CHAPTER_STATUSES` (for reference, not imported directly — foreshadow just reads chapter records)
- Produces: `foreshadow.js`: `renderForeshadowTab(projectId, container): Promise<void>` — Foreshadow record shape: `{ id, title, plantChapterId, recoverChapterId, status: '埋設中'|'已回收'|'棄用', relatedEntityIds: string[], relatedRelationIds: string[], notes }`

- [ ] **Step 1: Write the failing test**

`tests/foreshadow.spec.js`:

```js
import { test, expect } from '@playwright/test';

async function addChapter(page, volume, title, status) {
  await page.locator('.tab-btn', { hasText: '大綱' }).click();
  await page.locator('#c-volume').fill(String(volume));
  await page.locator('#c-title').fill(title);
  await page.locator('#c-status').selectOption(status);
  await page.locator('#c-add').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('伏筆測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  await addChapter(page, 1, '埋設章', '完稿');
  await addChapter(page, 2, '回收章', '完稿'); // already written, but foreshadow will stay 埋設中 → overdue
});

test('foreshadow whose recovery chapter is already 完稿 but status stays 埋設中 is flagged overdue', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('陸修的無限 Token 真相');
  await page.locator('#f-plant').selectOption({ label: '第1卷・埋設章' });
  await page.locator('#f-recover').selectOption({ label: '第2卷・回收章' });
  await page.locator('#f-status').selectOption('埋設中');
  await page.locator('#f-add').click();

  const item = page.locator('.foreshadow-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveClass(/overdue/);
  await expect(item).toContainText('逾期未回收');
});

test('deleting a foreshadow entry removes it', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await page.locator('#f-title').fill('待刪伏筆');
  await page.locator('#f-add').click();
  await page.locator('.f-delete').click();
  await expect(page.locator('.foreshadow-list li')).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/foreshadow.spec.js`
Expected: FAIL — `#f-title` doesn't exist (foreshadow tab not registered).

- [ ] **Step 3: Write minimal implementation**

`foreshadow.js`:

```js
'use strict';
import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { esc } from './util.js';

const STATUSES = ['埋設中', '已回收', '棄用'];

function isOverdue(item, chapterById) {
  if (item.status !== '埋設中' || !item.recoverChapterId) return false;
  const recoverChapter = chapterById[item.recoverChapterId];
  return !!recoverChapter && recoverChapter.status === '完稿';
}

export async function renderForeshadowTab(projectId, container) {
  const [items, chapters] = await Promise.all([
    getAllRecords(projectId, 'foreshadow'),
    getAllRecords(projectId, 'chapters'),
  ]);
  const chapterById = Object.fromEntries(chapters.map((c) => [c.id, c]));
  const chapterOptions = chapters.map((c) => `<option value="${c.id}">第${c.volume}卷・${esc(c.title)}</option>`).join('');

  container.innerHTML = `
    <section class="foreshadow-form">
      <h2>新增伏筆</h2>
      <input id="f-title" placeholder="伏筆名稱">
      <label>埋設章節 <select id="f-plant">${chapterOptions}</select></label>
      <label>預計回收章節 <select id="f-recover">${chapterOptions}</select></label>
      <select id="f-status">${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
      <textarea id="f-notes" placeholder="備註"></textarea>
      <button id="f-add" type="button">新增</button>
    </section>
    ${STATUSES.map((status) => `
      <h3>${status}</h3>
      <ul class="foreshadow-list" data-status="${status}">
        ${items.filter((i) => i.status === status).map((item) => `
          <li data-id="${item.id}" class="${isOverdue(item, chapterById) ? 'overdue' : ''}">
            <strong>${esc(item.title)}</strong>
            <span class="plant">埋設：${esc((chapterById[item.plantChapterId] || {}).title || '（未設定）')}</span>
            <span class="recover">預計回收：${esc((chapterById[item.recoverChapterId] || {}).title || '（未設定）')}</span>
            ${isOverdue(item, chapterById) ? '<span class="overdue-flag">逾期未回收</span>' : ''}
            <p>${esc(item.notes)}</p>
            <button class="f-delete" type="button">刪除</button>
          </li>`).join('')}
      </ul>`).join('')}
  `;

  container.querySelector('#f-add').addEventListener('click', async () => {
    const title = container.querySelector('#f-title').value.trim();
    if (!title) return;
    await putRecord(projectId, 'foreshadow', {
      title,
      plantChapterId: container.querySelector('#f-plant').value || null,
      recoverChapterId: container.querySelector('#f-recover').value || null,
      status: container.querySelector('#f-status').value,
      relatedEntityIds: [],
      relatedRelationIds: [],
      notes: container.querySelector('#f-notes').value.trim(),
    });
    renderForeshadowTab(projectId, container);
  });

  container.querySelectorAll('.f-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      await deleteRecord(projectId, 'foreshadow', id);
      renderForeshadowTab(projectId, container);
    });
  });
}
```

Modify `app.js`:

```js
import { renderForeshadowTab } from './foreshadow.js';
```

```js
TABS.foreshadow = { label: '伏筆追蹤', render: renderForeshadowTab };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/foreshadow.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add foreshadow.js app.js tests/foreshadow.spec.js
git commit -m "feat: foreshadow tracking with overdue detection (伏筆追蹤)"
```

---

## Task 6: AI provider 設定（多任務下拉）

**Files:**
- Create: `ai-providers.js`
- Create: `settings.js` (AI section only — GitHub/backup sections land in Tasks 9–10)
- Modify: `app.js` (add import + `TABS.settings` entry)
- Test: `tests/ai-settings.spec.js`

**Interfaces:**
- Consumes: nothing new (pure localStorage)
- Produces:
  - `ai-providers.js`: `PROVIDERS: Record<string, {label, base, model, keyless?}>`, `loadAiConfig(): {tasks: Record<string, {provider,base,model,key}>}`, `saveAiConfig(cfg): void`, `taskConfig(task: string): {provider,base,model,key}|null` (falls back to `tasks.default`), `setTaskConfig(task, providerCfg): void`, `chat(task: string, messages: {role,content}[]): Promise<string>` (throws if task unconfigured or HTTP fails)
  - `settings.js`: `renderSettingsTab(projectId, container): Promise<void>` — Tasks 9 and 10 will extend this same function's rendered HTML/handlers, not create a second settings module.

- [ ] **Step 1: Write the failing test**

`tests/ai-settings.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('AI 設定測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);
  await page.locator('.tab-btn', { hasText: '設定' }).click();
});

test('saving a task AI config persists across reload', async ({ page }) => {
  const fieldset = page.locator('fieldset[data-task="consistency"]');
  await fieldset.locator('.ai-provider').selectOption('groq');
  await fieldset.locator('.ai-model').fill('openai/gpt-oss-120b');
  await fieldset.locator('.ai-key').fill('test-key-123');
  await page.locator('#ai-save').click();

  await page.reload();
  await page.locator('.tab-btn', { hasText: '設定' }).click();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/ai-settings.spec.js`
Expected: FAIL — settings tab / `fieldset[data-task="consistency"]` doesn't exist.

- [ ] **Step 3: Write minimal implementation**

`ai-providers.js`:

```js
'use strict';

export const PROVIDERS = {
  llmshare: { label: 'llmshare（多奇團購閘道）', base: 'https://llm-share.duotify.com/v1', model: 'glm-5.2' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  ollama: { label: 'Ollama（本機）', base: 'http://localhost:11434/v1', model: 'llama3.2', keyless: true },
  custom: { label: '自訂（OpenAI 相容）', base: '', model: '' },
};

const AI_KEY = 'mycelium-ai';

export function loadAiConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_KEY));
    return raw && raw.tasks ? raw : { tasks: {} };
  } catch (e) {
    return { tasks: {} };
  }
}

export function saveAiConfig(cfg) {
  localStorage.setItem(AI_KEY, JSON.stringify(cfg));
}

export function taskConfig(task) {
  const cfg = loadAiConfig();
  return cfg.tasks[task] || cfg.tasks.default || null;
}

export function setTaskConfig(task, providerCfg) {
  const cfg = loadAiConfig();
  cfg.tasks[task] = providerCfg;
  saveAiConfig(cfg);
}

export async function chat(task, messages) {
  const c = taskConfig(task);
  if (!c || !c.base || !c.model) throw new Error(`請先在「設定」分頁設定 ${task} 任務要用的 AI。`);
  const url = c.base.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
    body: JSON.stringify({ model: c.model, messages }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e0 = Array.isArray(d) ? d[0] || {} : d;
    throw new Error((e0.error && e0.error.message) || `HTTP ${res.status}`);
  }
  const m = d.choices && d.choices[0] && d.choices[0].message;
  if (!m || typeof m.content !== 'string') throw new Error('模型沒有回傳文字內容。');
  return m.content;
}
```

`settings.js`:

```js
'use strict';
import { PROVIDERS, loadAiConfig, saveAiConfig } from './ai-providers.js';

// Task 9 adds a GitHub-sync <section> here; Task 10 adds a backup <section> here.
// Both extend renderSettingsTab's innerHTML + event wiring, not new files.
const AI_TASKS = [
  { id: 'default', label: '預設（其他任務沒個別設定時使用）' },
  { id: 'consistency', label: '一致性檢查' },
  { id: 'plot', label: '劇情/反轉發想' },
  { id: 'extract', label: '自動抽取圖資料' },
  { id: 'chat', label: '自由問答' },
];

function providerOptions(selected) {
  return Object.keys(PROVIDERS).map((id) => `<option value="${id}"${id === selected ? ' selected' : ''}>${PROVIDERS[id].label}</option>`).join('');
}

export async function renderSettingsTab(projectId, container) {
  const aiCfg = loadAiConfig();

  container.innerHTML = `
    <section class="ai-settings">
      <h2>AI 任務設定</h2>
      ${AI_TASKS.map((t) => {
        const c = aiCfg.tasks[t.id] || {};
        return `
        <fieldset data-task="${t.id}">
          <legend>${t.label}</legend>
          <label>Provider <select class="ai-provider">${providerOptions(c.provider)}</select></label>
          <label>Base URL <input class="ai-base" value="${c.base || ''}"></label>
          <label>Model <input class="ai-model" value="${c.model || ''}"></label>
          <label>API Key <input class="ai-key" type="password" value="${c.key || ''}"></label>
        </fieldset>`;
      }).join('')}
      <button id="ai-save" type="button">儲存 AI 設定</button>
    </section>
  `;

  container.querySelectorAll('fieldset[data-task] .ai-provider').forEach((sel) => {
    sel.addEventListener('change', () => {
      const fs = sel.closest('fieldset');
      const preset = PROVIDERS[sel.value];
      fs.querySelector('.ai-base').value = preset.base;
      fs.querySelector('.ai-model').value = preset.model;
    });
  });

  container.querySelector('#ai-save').addEventListener('click', () => {
    const cfg = loadAiConfig();
    container.querySelectorAll('fieldset[data-task]').forEach((fs) => {
      cfg.tasks[fs.dataset.task] = {
        provider: fs.querySelector('.ai-provider').value,
        base: fs.querySelector('.ai-base').value.trim(),
        model: fs.querySelector('.ai-model').value.trim(),
        key: fs.querySelector('.ai-key').value.trim(),
      };
    });
    saveAiConfig(cfg);
    alert('AI 設定已儲存。');
  });
}
```

Modify `app.js`:

```js
import { renderSettingsTab } from './settings.js';
```

```js
TABS.settings = { label: '設定', render: renderSettingsTab };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/ai-settings.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ai-providers.js settings.js app.js tests/ai-settings.spec.js
git commit -m "feat: per-task AI provider settings (多 provider 下拉)"
```

---

## Task 7: AI 助理——自由問答／一致性檢查／反轉發想

**Files:**
- Create: `ai-context.js`
- Create: `ai-panel.js`
- Modify: `app.js` (add import + `TABS.ai` entry)
- Test: `tests/ai-panel.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord`; `ai-providers.js` → `chat`
- Produces:
  - `ai-context.js`: `buildContext(projectId): Promise<string>` — plain-text dump of entities/relations/foreshadow/recent chapters, used as the AI system-prompt context for all four AI tasks (Task 8's extract flow builds its own narrower context, see Task 8)
  - `ai-panel.js`: `renderAiTab(projectId, container): Promise<void>` — ChatLog record shape: `{ id, task: 'chat'|'consistency'|'plot'|'extract', role: 'user'|'assistant', content: string, createdAt: number }`. Renders a `#ai-controls` sub-container that Task 8 will branch on (`task === 'extract'`) to delegate to `extract.js`.

- [ ] **Step 1: Write the failing test**

`tests/ai-panel.spec.js`:

```js
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
  await page.locator('.tab-btn', { hasText: '設定' }).click();
  const fieldset = page.locator('fieldset[data-task="default"]');
  await fieldset.locator('.ai-provider').selectOption('custom');
  await fieldset.locator('.ai-base').fill('https://example.invalid/v1');
  await fieldset.locator('.ai-model').fill('test-model');
  await page.locator('#ai-save').click();

  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
});

test('sending a free-form question shows the mocked reply and persists after reload', async ({ page }) => {
  await page.locator('#ai-input').fill('陸修現在幾歲？');
  await page.locator('#ai-send').click();

  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to] 陸修現在幾歲？');

  await page.reload();
  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
  await expect(page.locator('.ai-msg.user')).toContainText('陸修現在幾歲？');
  await expect(page.locator('.ai-msg.assistant')).toContainText('[mock reply to]');
});

test('consistency check uses a default prompt when input is left blank', async ({ page }) => {
  await page.locator('#ai-task').selectOption('consistency');
  await page.locator('#ai-send').click();
  await expect(page.locator('.ai-msg.user')).toContainText('矛盾');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/ai-panel.spec.js`
Expected: FAIL — `#ai-input` doesn't exist (AI tab not registered).

- [ ] **Step 3: Write minimal implementation**

`ai-context.js`:

```js
'use strict';
import { getAllRecords } from './db.js';

export async function buildContext(projectId) {
  const [entities, relations, foreshadow, chapters] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
    getAllRecords(projectId, 'foreshadow'),
    getAllRecords(projectId, 'chapters'),
  ]);
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const recentChapters = chapters
    .sort((a, b) => (a.volume - b.volume) || (a.order - b.order))
    .slice(-10);

  return [
    '【設定庫】',
    ...entities.map((e) => `- ${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}［${e.type || '未分類'}］：${e.notes || ''}`),
    '【人物關係】',
    ...relations.map((r) => `- ${(entityById[r.sourceId] || {}).name || '?'} —${r.type}→ ${(entityById[r.targetId] || {}).name || '?'}`),
    '【伏筆】',
    ...foreshadow.map((f) => `- ${f.title}［${f.status}］：${f.notes || ''}`),
    '【最近章節摘要】',
    ...recentChapters.map((c) => `- 第${c.volume}卷・${c.title}：${c.summary || ''}`),
  ].join('\n');
}
```

`ai-panel.js`:

```js
'use strict';
import { chat } from './ai-providers.js';
import { buildContext } from './ai-context.js';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';

const SYSTEM_BASE = '你是小說創作助理，以下是這部作品目前的設定資料，回答時要以此為準，發現前後矛盾要明確指出：\n\n';

const DEFAULT_PROMPTS = {
  consistency: '請檢查目前的設定資料有沒有前後矛盾的地方，逐項列出。',
  plot: '請根據目前的設定，發想接下來的劇情或反轉走向。',
};

async function runChatTask(projectId, task, userPrompt, logEl) {
  logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg user">${esc(userPrompt)}</div>`);
  await putRecord(projectId, 'chatlogs', { task, role: 'user', content: userPrompt, createdAt: Date.now() });
  logEl.insertAdjacentHTML('beforeend', '<div class="ai-msg pending">思考中…</div>');
  const pendingEl = logEl.lastElementChild;
  try {
    const context = await buildContext(projectId);
    const reply = await chat(task, [
      { role: 'system', content: SYSTEM_BASE + context },
      { role: 'user', content: userPrompt },
    ]);
    pendingEl.remove();
    logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg assistant">${esc(reply)}</div>`);
    await putRecord(projectId, 'chatlogs', { task, role: 'assistant', content: reply, createdAt: Date.now() });
  } catch (e) {
    pendingEl.remove();
    logEl.insertAdjacentHTML('beforeend', `<div class="ai-msg error">錯誤：${esc(e.message)}</div>`);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function renderChatControls(projectId, container, logEl) {
  container.innerHTML = `<textarea id="ai-input" placeholder="輸入問題…（一致性檢查/反轉發想留空會用預設問句）"></textarea><button id="ai-send" type="button">送出</button>`;
  container.querySelector('#ai-send').addEventListener('click', async () => {
    const task = document.querySelector('#ai-task').value;
    const input = container.querySelector('#ai-input');
    const prompt = input.value.trim() || DEFAULT_PROMPTS[task] || '';
    if (!prompt) return;
    input.value = '';
    await runChatTask(projectId, task, prompt, logEl);
  });
}

export async function renderAiTab(projectId, container) {
  const logs = await getAllRecords(projectId, 'chatlogs');
  container.innerHTML = `
    <div class="ai-log" id="ai-log">
      ${logs.sort((a, b) => a.createdAt - b.createdAt).map((l) => `<div class="ai-msg ${l.role}">${esc(l.content)}</div>`).join('')}
    </div>
    <div class="ai-task-select">
      <select id="ai-task">
        <option value="chat">自由問答</option>
        <option value="consistency">一致性檢查</option>
        <option value="plot">劇情/反轉發想</option>
      </select>
    </div>
    <div id="ai-controls"></div>
  `;
  const logEl = container.querySelector('#ai-log');
  const controls = container.querySelector('#ai-controls');
  renderChatControls(projectId, controls, logEl);
  container.querySelector('#ai-task').addEventListener('change', () => renderChatControls(projectId, controls, logEl));
}
```

Modify `app.js`:

```js
import { renderAiTab } from './ai-panel.js';
```

```js
TABS.ai = { label: 'AI 助理', render: renderAiTab };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/ai-panel.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ai-context.js ai-panel.js app.js tests/ai-panel.spec.js
git commit -m "feat: AI assistant panel — free chat, consistency check, plot ideation"
```

---

## Task 8: AI 抽取圖資料（含別名合併）

**Files:**
- Create: `extract.js`
- Modify: `ai-panel.js` (add `extract` option to `#ai-task`, branch `renderChatControls` → delegate to `extract.js` when task is `extract`)
- Test: `tests/extract.spec.js`

**Interfaces:**
- Consumes: `db.js` → `getAllRecords`, `putRecord`; `ai-providers.js` → `chat`; `util.js` → `esc`
- Produces: `extract.js`: `renderExtractPanel(projectId: string, container: HTMLElement): Promise<void>` — renders into the same `#ai-controls` container `ai-panel.js` owns (not a new tab)

- [ ] **Step 1: Write the failing test**

`tests/extract.spec.js`:

```js
import { test, expect } from '@playwright/test';

const MOCK_EXTRACTION = {
  entities: [
    { name: '魔王', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
    { name: '系統管理員陳先生', aliasOf: '魔王', type: null, notes: null, reason: '本章揭露魔王其實就是系統管理員陳先生' },
  ],
  relations: [
    { source: '陸修', target: '魔王', type: '追殺', reason: '魔王軍全境追殺陸修' },
  ],
  foreshadow: [
    { title: '陸修的真實身份', notes: '暗示陸修是上一代殘留的模型', reason: '魔王的台詞埋了伏筆' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(MOCK_EXTRACTION) } }] } });
  });

  await page.goto('/');
  page.once('dialog', (d) => d.accept('抽取測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-add').click();

  await page.locator('.tab-btn', { hasText: '設定' }).click();
  const fieldset = page.locator('fieldset[data-task="extract"]');
  await fieldset.locator('.ai-provider').selectOption('custom');
  await fieldset.locator('.ai-base').fill('https://example.invalid/v1');
  await fieldset.locator('.ai-model').fill('test-model');
  await page.locator('#ai-save').click();

  await page.locator('.tab-btn', { hasText: 'AI 助理' }).click();
  await page.locator('#ai-task').selectOption('extract');
});

test('extracting text produces candidates; applying merges aliases and links relations', async ({ page }) => {
  await page.locator('#ex-text').fill('（章節全文……）');
  await page.locator('#ex-run').click();

  await expect(page.locator('#ex-entities li')).toHaveCount(2);
  await expect(page.locator('#ex-entities li').nth(1)).toContainText('合併為「魔王」的別名');

  await page.locator('#ex-apply').click();
  await page.waitForTimeout(300);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  const villain = page.locator('.entity-list li', { hasText: '魔王' });
  await expect(villain).toContainText('系統管理員陳先生'); // merged as alias, not a separate entity
  await expect(page.locator('.entity-list li')).toHaveCount(2); // 陸修 + 魔王 only, no duplicate

  await page.locator('.tab-btn', { hasText: '關係圖' }).click();
  await expect(page.locator('#r-source option', { hasText: '魔王' })).toHaveCount(1);

  await page.locator('.tab-btn', { hasText: '伏筆追蹤' }).click();
  await expect(page.locator('.foreshadow-list li', { hasText: '陸修的真實身份' })).toHaveCount(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/extract.spec.js`
Expected: FAIL — `#ex-text` doesn't exist (extract task not wired up yet).

- [ ] **Step 3: Write minimal implementation**

`extract.js`:

```js
'use strict';
import { chat } from './ai-providers.js';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';

const EXTRACT_SYSTEM = `你是小說設定抽取助手。輸入是既有角色名單（含別名）與一段章節全文。
請找出文中的新角色/地點/勢力、新的人物關係、新的伏筆，並判斷每個名字是「全新角色」還是「既有角色的別名/新稱號」。
只回傳 JSON，格式：
{"entities":[{"name":"...","aliasOf":null,"type":"...","notes":"...","reason":"..."}],"relations":[{"source":"...","target":"...","type":"...","reason":"..."}],"foreshadow":[{"title":"...","notes":"...","reason":"..."}]}
entities 陣列裡，如果判斷是既有角色的別名，aliasOf 填該既有角色的名稱（必須完全符合既有名單裡的 name）；全新角色 aliasOf 填 null。
只回傳 JSON，不要其他文字。`;

function parseExtractionJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 沒有回傳可解析的 JSON。');
  return JSON.parse(match[0]);
}

export async function renderExtractPanel(projectId, container) {
  container.innerHTML = `
    <section class="extract-form">
      <textarea id="ex-text" placeholder="貼上章節全文…" rows="10"></textarea>
      <button id="ex-run" type="button">分析</button>
      <p id="ex-status"></p>
    </section>
    <div id="ex-results"></div>
  `;

  container.querySelector('#ex-run').addEventListener('click', async () => {
    const text = container.querySelector('#ex-text').value.trim();
    if (!text) return;
    const status = container.querySelector('#ex-status');
    status.textContent = '分析中…';
    try {
      const entities = await getAllRecords(projectId, 'entities');
      const known = entities
        .map((e) => `${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}`)
        .join('\n');
      const raw = await chat('extract', [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `既有角色名單：\n${known || '（尚無）'}\n\n章節全文：\n${text}` },
      ]);
      const result = parseExtractionJson(raw);
      renderCandidates(projectId, container, entities, result);
      status.textContent = '分析完成，請勾選要寫入的項目。';
    } catch (e) {
      status.textContent = '分析失敗：' + e.message;
    }
  });
}

function renderCandidates(projectId, container, existingEntities, result) {
  const box = container.querySelector('#ex-results');
  const entityCandidates = result.entities || [];
  const relationCandidates = result.relations || [];
  const foreshadowCandidates = result.foreshadow || [];

  box.innerHTML = `
    <h3>新設定候選</h3>
    <ul class="candidate-list" id="ex-entities">
      ${entityCandidates.map((c) => `
        <li>
          <label><input type="checkbox" checked> ${esc(c.name)}
            ${c.aliasOf ? `→ 合併為「${esc(c.aliasOf)}」的別名` : `（新角色，類型：${esc(c.type || '未分類')}）`}
          </label>
          <p class="reason">${esc(c.reason || '')}</p>
        </li>`).join('')}
    </ul>
    <h3>新關係候選</h3>
    <ul class="candidate-list" id="ex-relations">
      ${relationCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.source)} —${esc(c.type)}→ ${esc(c.target)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
    <h3>新伏筆候選</h3>
    <ul class="candidate-list" id="ex-foreshadow">
      ${foreshadowCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.title)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
    <button id="ex-apply" type="button">寫入勾選的項目</button>
  `;

  box.querySelector('#ex-apply').addEventListener('click', async () => {
    const nameToEntity = Object.fromEntries(existingEntities.map((e) => [e.name, e]));

    const entityLis = [...box.querySelectorAll('#ex-entities li')];
    for (let i = 0; i < entityLis.length; i++) {
      if (!entityLis[i].querySelector('input').checked) continue;
      const c = entityCandidates[i];
      if (c.aliasOf && nameToEntity[c.aliasOf]) {
        const target = nameToEntity[c.aliasOf];
        const aliases = Array.from(new Set([...(target.aliases || []), c.name]));
        await putRecord(projectId, 'entities', { ...target, aliases });
      } else {
        await putRecord(projectId, 'entities', { name: c.name, aliases: [], type: c.type || '', tags: [], notes: c.notes || '' });
      }
    }

    const entitiesAfter = await getAllRecords(projectId, 'entities');
    const findEntity = (name) => entitiesAfter.find((e) => e.name === name || (e.aliases || []).includes(name));

    const relationLis = [...box.querySelectorAll('#ex-relations li')];
    for (let i = 0; i < relationLis.length; i++) {
      if (!relationLis[i].querySelector('input').checked) continue;
      const c = relationCandidates[i];
      const source = findEntity(c.source);
      const target = findEntity(c.target);
      if (!source || !target) continue;
      await putRecord(projectId, 'relations', { sourceId: source.id, targetId: target.id, type: c.type, notes: c.reason || '' });
    }

    const foreshadowLis = [...box.querySelectorAll('#ex-foreshadow li')];
    for (let i = 0; i < foreshadowLis.length; i++) {
      if (!foreshadowLis[i].querySelector('input').checked) continue;
      const c = foreshadowCandidates[i];
      await putRecord(projectId, 'foreshadow', { title: c.title, plantChapterId: null, recoverChapterId: null, status: '埋設中', relatedEntityIds: [], relatedRelationIds: [], notes: c.notes || '' });
    }

    alert('已寫入勾選的項目，切換到對應分頁查看。');
  });
}
```

Modify `ai-panel.js`:

1. Add the import at the top:

```js
import { renderExtractPanel } from './extract.js';
```

2. Add an `<option value="extract">抽取圖資料</option>` to the `#ai-task` select in `renderAiTab`'s template (right after the `plot` option).

3. Replace the `renderChatControls` call sites so `renderAiTab` and the task-change handler branch on the selected task:

```js
function renderControls(projectId, controls, logEl) {
  const task = document.querySelector('#ai-task').value;
  if (task === 'extract') {
    renderExtractPanel(projectId, controls);
  } else {
    renderChatControls(projectId, controls, logEl);
  }
}
```

Then in `renderAiTab`, replace the two `renderChatControls(projectId, controls, logEl)` / listener call with:

```js
renderControls(projectId, controls, logEl);
container.querySelector('#ai-task').addEventListener('change', () => renderControls(projectId, controls, logEl));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/extract.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extract.js ai-panel.js tests/extract.spec.js
git commit -m "feat: extract-to-graph-data flow with alias-merge confirmation"
```

---

## Task 9: GitHub 同步

**Files:**
- Create: `github-sync.js`
- Create: `backup.js` (shared data-collection helper — also used by Task 10)
- Modify: `settings.js` (add GitHub-sync `<section>`)
- Test: `tests/github-sync.spec.js`

**Interfaces:**
- Consumes: `db.js` → `PROJECT_STORES`, `getAllRecords`, `putRecord`, `deleteRecord`, `listProjects`, `updateProjectMeta`
- Produces:
  - `backup.js`: `collectProjectData(projectId): Promise<Record<string, object[]>>` (keyed by store name), `replaceProjectData(projectId, data): Promise<void>` (wipes each store then writes `data[store]`)
  - `github-sync.js`: `syncToGithub(projectId): Promise<void>`, `importFromGithub(projectId): Promise<void>` (both throw a user-readable `Error` if the PAT or repo binding is missing, or on a non-2xx GitHub response)

- [ ] **Step 1: Write the failing test**

`tests/github-sync.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('同步測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-add').click();
});

test('sync PUTs each data store as base64 JSON to the Contents API', async ({ page }) => {
  const puts = [];
  await page.route('https://api.github.com/repos/yazelin/test-novel/contents/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ status: 404, json: { message: 'Not Found' } }); return; }
    puts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { content: { sha: 'abc123' } } });
  });

  await page.locator('.tab-btn', { hasText: '設定' }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-owner').fill('yazelin');
  await page.locator('#gh-name').fill('test-novel');
  await page.locator('#gh-save').click();

  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('同步完成', { timeout: 10_000 });

  expect(puts.length).toBe(5); // one per PROJECT_STORES entry
  const entitiesPut = puts.find((p) => p.url.endsWith('data/entities.json'));
  const decoded = JSON.parse(Buffer.from(entitiesPut.body.content, 'base64').toString('utf8'));
  expect(decoded[0].name).toBe('陸修');
});

test('sync without a repo binding shows an error instead of throwing', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '設定' }).click();
  await page.locator('#gh-pat').fill('ghp_test');
  await page.locator('#gh-save').click();
  await page.locator('#gh-sync').click();
  await expect(page.locator('#gh-status')).toContainText('尚未綁定');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/github-sync.spec.js`
Expected: FAIL — `#gh-pat` doesn't exist (GitHub section not in settings yet).

- [ ] **Step 3: Write minimal implementation**

`backup.js`:

```js
'use strict';
import { PROJECT_STORES, getAllRecords, putRecord, deleteRecord } from './db.js';

export async function collectProjectData(projectId) {
  const data = {};
  for (const store of PROJECT_STORES) data[store] = await getAllRecords(projectId, store);
  return data;
}

export async function replaceProjectData(projectId, data) {
  for (const store of PROJECT_STORES) {
    const existing = await getAllRecords(projectId, store);
    for (const rec of existing) await deleteRecord(projectId, store, rec.id);
    for (const rec of (data[store] || [])) await putRecord(projectId, store, rec);
  }
}
```

`github-sync.js`:

```js
'use strict';
import { collectProjectData, replaceProjectData } from './backup.js';
import { listProjects, PROJECT_STORES } from './db.js';

function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64DecodeUtf8(str) { return decodeURIComponent(escape(atob(str))); }

async function ghFetch(url, options = {}) {
  const pat = localStorage.getItem('mycelium-github-pat');
  if (!pat) throw new Error('請先在設定填 GitHub PAT。');
  return fetch(url, {
    ...options,
    headers: { authorization: 'Bearer ' + pat, accept: 'application/vnd.github+json', ...(options.headers || {}) },
  });
}

async function projectRepo(projectId) {
  const projects = await listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project || !project.repo || !project.repo.owner || !project.repo.name) throw new Error('這個作品尚未綁定 GitHub repo。');
  return project.repo;
}

export async function syncToGithub(projectId) {
  const repo = await projectRepo(projectId);
  const data = await collectProjectData(projectId);
  for (const store of PROJECT_STORES) {
    const path = `data/${store}.json`;
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
    let sha;
    const getRes = await ghFetch(url);
    if (getRes.ok) sha = (await getRes.json()).sha;
    const content = b64EncodeUtf8(JSON.stringify(data[store], null, 2));
    const putRes = await ghFetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: `sync ${store}`, content, ...(sha ? { sha } : {}) }),
    });
    if (!putRes.ok) {
      const d = await putRes.json().catch(() => ({}));
      throw new Error(d.message || `同步 ${store} 失敗（HTTP ${putRes.status}）`);
    }
  }
}

export async function importFromGithub(projectId) {
  const repo = await projectRepo(projectId);
  const data = {};
  for (const store of PROJECT_STORES) {
    const path = `data/${store}.json`;
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
    const res = await ghFetch(url);
    if (res.status === 404) { data[store] = []; continue; }
    if (!res.ok) throw new Error(`讀取 ${store} 失敗（HTTP ${res.status}）`);
    const d = await res.json();
    data[store] = JSON.parse(b64DecodeUtf8(d.content));
  }
  await replaceProjectData(projectId, data);
}
```

Modify `settings.js`:

1. Add imports at the top:

```js
import { updateProjectMeta, listProjects } from './db.js';
import { syncToGithub, importFromGithub } from './github-sync.js';
```

2. Change `renderSettingsTab`'s signature usage to look up the current project record (needed to prefill the repo fields):

```js
export async function renderSettingsTab(projectId, container) {
  const aiCfg = loadAiConfig();
  const projects = await listProjects();
  const project = projects.find((p) => p.id === projectId) || { repo: null };
  // ...
```

3. Append a new `<section class="github-settings">` right after the closing `</section>` of `ai-settings` inside the template literal:

```html
<section class="github-settings">
  <h2>GitHub 同步</h2>
  <label>Personal Access Token <input id="gh-pat" type="password" value="${localStorage.getItem('mycelium-github-pat') || ''}"></label>
  <label>Repo owner <input id="gh-owner" value="${(project.repo && project.repo.owner) || ''}"></label>
  <label>Repo name <input id="gh-name" value="${(project.repo && project.repo.name) || ''}"></label>
  <button id="gh-save" type="button">儲存 repo 綁定</button>
  <button id="gh-sync" type="button">同步到 GitHub</button>
  <button id="gh-import" type="button">從 GitHub 匯入</button>
  <p id="gh-status"></p>
</section>
```

4. Add event wiring after the existing `#ai-save` listener:

```js
container.querySelector('#gh-save').addEventListener('click', async () => {
  localStorage.setItem('mycelium-github-pat', container.querySelector('#gh-pat').value.trim());
  await updateProjectMeta(projectId, {
    repo: { owner: container.querySelector('#gh-owner').value.trim(), name: container.querySelector('#gh-name').value.trim() },
  });
  alert('repo 綁定已儲存。');
});

container.querySelector('#gh-sync').addEventListener('click', async () => {
  const status = container.querySelector('#gh-status');
  status.textContent = '同步中…';
  try { await syncToGithub(projectId); status.textContent = '同步完成。'; }
  catch (e) { status.textContent = '同步失敗：' + e.message; }
});

container.querySelector('#gh-import').addEventListener('click', async () => {
  const status = container.querySelector('#gh-status');
  if (!confirm('從 GitHub 匯入會覆蓋目前本機資料，確定？')) return;
  status.textContent = '匯入中…';
  try { await importFromGithub(projectId); status.textContent = '匯入完成，請切換分頁查看。'; }
  catch (e) { status.textContent = '匯入失敗：' + e.message; }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/github-sync.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backup.js github-sync.js settings.js tests/github-sync.spec.js
git commit -m "feat: manual GitHub Contents API sync per project"
```

---

## Task 10: 本機 JSON 匯出/匯入

**Files:**
- Modify: `backup.js` (add `exportProjectJson`, `importProjectJson`)
- Modify: `settings.js` (add local-backup `<section>`)
- Test: `tests/backup.spec.js`

**Interfaces:**
- Consumes: `backup.js` → `collectProjectData`, `replaceProjectData` (Task 9)
- Produces: `backup.js`: `exportProjectJson(projectId, projectName): Promise<void>` (triggers a browser download), `importProjectJson(projectId, data): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/backup.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => d.accept('備份測試'));
  await page.locator('#project-new').click();
  await page.waitForTimeout(100);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await page.locator('#e-name').fill('陸修');
  await page.locator('#e-add').click();
});

test('export downloads a JSON file containing current entities', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '設定' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-json').click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const content = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(content.entities[0].name).toBe('陸修');
});

test('import overwrites current project data', async ({ page }) => {
  await page.locator('.tab-btn', { hasText: '設定' }).click();
  const payload = JSON.stringify({ entities: [{ id: 'e1', name: '匯入的角色', aliases: [], type: '', tags: [], notes: '' }], relations: [], chapters: [], foreshadow: [], chatlogs: [] });

  page.once('dialog', (d) => d.accept());
  await page.locator('#import-json').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(payload) });
  await page.waitForTimeout(300);

  await page.locator('.tab-btn', { hasText: '設定庫' }).click();
  await expect(page.locator('.entity-list li')).toHaveCount(1);
  await expect(page.locator('.entity-list li')).toContainText('匯入的角色');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/backup.spec.js`
Expected: FAIL — `#export-json` doesn't exist (backup section not in settings yet).

- [ ] **Step 3: Write minimal implementation**

Modify `backup.js` — append at the end of the file:

```js
export async function exportProjectJson(projectId, projectName) {
  const data = await collectProjectData(projectId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mycelium-${(projectName || projectId).replace(/[^\w-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importProjectJson(projectId, data) {
  await replaceProjectData(projectId, data);
}
```

Modify `settings.js`:

1. Add import at the top:

```js
import { exportProjectJson, importProjectJson } from './backup.js';
```

2. Append a new `<section class="backup-settings">` right after the `github-settings` section in the template literal:

```html
<section class="backup-settings">
  <h2>本機備份</h2>
  <button id="export-json" type="button">匯出 JSON</button>
  <label>匯入 JSON <input id="import-json" type="file" accept="application/json"></label>
</section>
```

3. Add event wiring after the `#gh-import` listener:

```js
container.querySelector('#export-json').addEventListener('click', () => exportProjectJson(projectId, project.name));
container.querySelector('#import-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('匯入會覆蓋目前作品的資料，確定？')) return;
  await importProjectJson(projectId, JSON.parse(await file.text()));
  alert('匯入完成，請切換分頁查看。');
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/backup.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backup.js settings.js tests/backup.spec.js
git commit -m "feat: local JSON export/import backup"
```

---

## Final check

- [ ] Run the full suite once all 10 tasks are done: `npx playwright test`
Expected: all specs pass.
- [ ] Open `http://127.0.0.1:8919` in a real browser (`npm run serve` in one terminal), click through every tab once by hand, confirm nothing throws in the console.
