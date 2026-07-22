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
