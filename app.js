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
