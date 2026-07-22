'use strict';
import { PROVIDERS, loadAiConfig, saveAiConfig } from './ai-providers.js';
import { updateProjectMeta, listProjects } from './db.js';
import { syncToGithub, importFromGithub } from './github-sync.js';

// Task 10 adds a backup <section> here, extending renderSettingsTab's
// innerHTML + event wiring, not a new file.
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
  const projects = await listProjects();
  const project = projects.find((p) => p.id === projectId) || { repo: null };

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
}
