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
