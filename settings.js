'use strict';
import { PROVIDERS, loadAiConfig, saveAiConfig } from './ai-providers.js';
import { updateProjectMeta, listProjects, getAllRecords } from './db.js';
import { syncToGithub, importFromGithub } from './github-sync.js';
import { exportProjectJson, importProjectJson } from './backup.js';
import { listProposals, fetchProposal, markProposalApplied } from './proposals.js';
import { candidateListHtml, applyCandidates } from './extract.js';
import { esc } from './util.js';

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
    <section class="proposals-settings">
      <h2>從 GitHub 讀取提案</h2>
      <p class="hint">本機 agent（見 skills/mycelium）分析章節後，會把候選寫成這個 repo 的 proposals/&lt;timestamp&gt;.json，不會直接改資料。在這裡選一份提案，逐項勾選確認後才會寫進設定庫。</p>
      <button id="pr-refresh" type="button">列出提案</button>
      <p id="pr-status"></p>
      <ul id="pr-list"></ul>
      <div id="pr-review"></div>
    </section>
    <section class="backup-settings">
      <h2>本機備份</h2>
      <button id="export-json" type="button">匯出 JSON</button>
      <label>匯入 JSON <input id="import-json" type="file" accept="application/json"></label>
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

  container.querySelector('#pr-refresh').addEventListener('click', () => refreshProposals(projectId, container));

  container.querySelector('#export-json').addEventListener('click', () => exportProjectJson(projectId, project.name));
  container.querySelector('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('匯入會覆蓋目前作品的資料，確定？')) return;
    // Parse and import are each wrapped so a bad file (unparseable JSON,
    // wrong shape, or a write failure partway through) surfaces a readable
    // Chinese error instead of an unhandled rejection or a false success
    // alert — importProjectJson itself validates shape before doing any
    // destructive write, so nothing is changed on failure.
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      alert('這個檔案不是有效的 JSON，未匯入任何資料。');
      e.target.value = '';
      return;
    }
    try {
      await importProjectJson(projectId, data);
      alert('匯入完成，請切換分頁查看。');
    } catch (err) {
      alert('匯入失敗：' + err.message);
    }
    e.target.value = '';
  });
}

// Lists proposal files from the bound repo. `result.exists === false` (the
// proposals/ directory itself 404s) and `result.exists === true` with an
// empty `items` array (directory exists — e.g. only an applied/ subfolder —
// but nothing to apply) are BOTH reported as "no proposals" in plain
// Traditional Chinese and change nothing; neither is ever treated as "an
// empty set to apply" (the issue #4 bug this app has already been bitten by
// once, for the sibling data/*.json import path).
async function refreshProposals(projectId, container) {
  const status = container.querySelector('#pr-status');
  const listEl = container.querySelector('#pr-list');
  const reviewEl = container.querySelector('#pr-review');
  listEl.innerHTML = '';
  reviewEl.innerHTML = '';
  status.textContent = '讀取中…';

  let result;
  try {
    result = await listProposals(projectId);
  } catch (e) {
    status.textContent = '讀取提案清單失敗：' + e.message;
    return;
  }
  if (!result.exists) {
    status.textContent = '這個 repo 還沒有 proposals/ 資料夾，目前沒有任何提案。';
    return;
  }
  if (!result.items.length) {
    status.textContent = 'proposals/ 資料夾裡目前沒有可套用的提案。';
    return;
  }

  status.textContent = `找到 ${result.items.length} 份提案（新到舊排序）：`;
  listEl.innerHTML = result.items.map((item, i) => {
    if (!item.valid) {
      return `<li><strong>${esc(item.name)}</strong> — <span class="pr-invalid">格式不正確，無法套用${item.error ? `（${esc(item.error)}）` : ''}</span></li>`;
    }
    const d = item.data;
    const counts = `角色候選 ${d.entities.length}、關係候選 ${d.relations.length}、伏筆候選 ${d.foreshadow.length}`;
    return `
      <li>
        <strong>${esc(item.name)}</strong>
        <p class="pr-meta">${esc(d.generatedAt || '（無時間戳記）')}${d.source ? ` ｜ 來源：${esc(d.source)}` : ''}${d.agent ? ` ｜ agent：${esc(d.agent)}` : ''}</p>
        ${d.note ? `<p class="pr-meta">備註：${esc(d.note)}</p>` : ''}
        <p class="pr-meta">${counts}</p>
        <button type="button" class="pr-open" data-idx="${i}">查看並套用</button>
      </li>`;
  }).join('');

  listEl.querySelectorAll('.pr-open').forEach((btn) => {
    btn.addEventListener('click', () => openProposal(projectId, container, result.items[Number(btn.dataset.idx)]));
  });
}

// Re-fetches and re-validates the chosen proposal right before it's used
// (listing already validated it, but the file could have changed since, or
// a caller could reach this some other way in future) — a malformed file
// throws here and nothing about the review UI or the database changes.
async function openProposal(projectId, container, item) {
  const status = container.querySelector('#pr-status');
  const reviewEl = container.querySelector('#pr-review');
  reviewEl.innerHTML = '';
  status.textContent = `讀取「${item.name}」中…`;

  let fetched;
  try {
    fetched = await fetchProposal(projectId, item.path);
  } catch (e) {
    status.textContent = '讀取提案失敗：' + e.message;
    return;
  }
  const result = fetched.data;
  const existingEntities = await getAllRecords(projectId, 'entities');
  status.textContent = `「${item.name}」讀取完成，請勾選要套用的項目。`;

  // Same candidate-review markup and two-pass apply logic as the AI
  // extraction flow (extract.js) — a proposal file's top level IS an
  // extraction result (entities/relations/foreshadow), by the format
  // contract in skills/mycelium/SKILL.md, so it goes through the exact same
  // reviewer instead of a second, hand-rolled one.
  reviewEl.innerHTML = `
    <h3>提案內容：${esc(item.name)}</h3>
    ${candidateListHtml(result, 'pr')}
    <button id="pr-apply" type="button">套用勾選的項目</button>
  `;

  reviewEl.querySelector('#pr-apply').addEventListener('click', async () => {
    const counts = await applyCandidates(projectId, existingEntities, result, reviewEl, 'pr');
    try {
      await markProposalApplied(projectId, item.path, fetched.rawContent);
      alert(`已套用勾選的項目（角色 ${counts.entities}、關係 ${counts.relations}、伏筆 ${counts.foreshadow}），提案已移到 proposals/applied/，不會重複出現。切換到對應分頁查看。`);
    } catch (e) {
      alert('已套用勾選的項目到設定庫，但標記提案為已處理時發生問題：' + e.message);
    }
    await refreshProposals(projectId, container);
  });
}
