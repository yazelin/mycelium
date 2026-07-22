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
          <div class="entity-view">
            <strong>${esc(e.name)}</strong>
            ${e.aliases && e.aliases.length ? `<span class="aliases">（別名：${e.aliases.map(esc).join('、')}）</span>` : ''}
            <span class="type">${esc(e.type)}</span>
            ${e.tags && e.tags.length ? `<span class="tags">標籤：${e.tags.map(esc).join('、')}</span>` : ''}
            <p>${esc(e.notes)}</p>
            <button class="e-edit-toggle" type="button">編輯</button>
            <button class="e-delete" type="button">刪除</button>
          </div>
          <div class="entity-edit" hidden>
            <input class="e-edit-name" value="${esc(e.name)}" placeholder="名稱">
            <input class="e-edit-aliases" value="${esc((e.aliases || []).join(', '))}" placeholder="別名（逗號分隔）">
            <input class="e-edit-type" value="${esc(e.type)}" placeholder="類型（人物/地點/勢力/概念…）">
            <input class="e-edit-tags" value="${esc((e.tags || []).join(', '))}" placeholder="標籤（逗號分隔）">
            <textarea class="e-edit-notes" placeholder="備註/設定內容">${esc(e.notes)}</textarea>
            <button class="e-save" type="button">儲存</button>
            <button class="e-cancel" type="button">取消</button>
          </div>
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
      // Root cause of the 關係圖-brick bug: a relation whose source/target
      // entity no longer exists makes Cytoscape throw and abort renderGraphTab
      // partway through (see graph.js). Cascade-delete those relations here so
      // one never gets left behind in the first place, and tell the user
      // up front — this makes the delete silently take relations with it
      // otherwise.
      const relations = await getAllRecords(projectId, 'relations');
      const affected = relations.filter((r) => r.sourceId === id || r.targetId === id);
      if (affected.length && !confirm(`這個設定牽涉 ${affected.length} 筆關係，刪除後這些關係也會一併刪除，確定刪除？`)) return;
      await deleteRecord(projectId, 'entities', id);
      for (const r of affected) await deleteRecord(projectId, 'relations', r.id);
      renderEntitiesTab(projectId, container);
    });
  });

  // Edit-in-place is the whole point of #3: renaming/correcting an entity used
  // to mean delete + re-create, which mints a new id and cascade-deletes every
  // relation attached to it (see graph.js's cascade-delete comment above) — so
  // "fix a typo in a name" silently destroyed the character's relationship
  // graph. Toggle to a per-row form and write back onto the EXISTING record
  // via putRecord (preserving id) instead.
  container.querySelectorAll('.e-edit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('li');
      li.querySelector('.entity-view').hidden = true;
      li.querySelector('.entity-edit').hidden = false;
    });
  });

  // Cancel resets the form back to the record's current values (rather than
  // leaving unsaved edits sitting in the inputs for next time) and returns to
  // the read-only view without writing anything.
  container.querySelectorAll('.e-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const entity = entities.find((e) => e.id === id);
      if (entity) {
        li.querySelector('.e-edit-name').value = entity.name;
        li.querySelector('.e-edit-aliases').value = (entity.aliases || []).join(', ');
        li.querySelector('.e-edit-type').value = entity.type;
        li.querySelector('.e-edit-tags').value = (entity.tags || []).join(', ');
        li.querySelector('.e-edit-notes').value = entity.notes;
      }
      li.querySelector('.entity-edit').hidden = true;
      li.querySelector('.entity-view').hidden = false;
    });
  });

  container.querySelectorAll('.e-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const entity = entities.find((e) => e.id === id);
      if (!entity) return;
      const name = li.querySelector('.e-edit-name').value.trim();
      if (!name) return;
      await putRecord(projectId, 'entities', {
        ...entity,
        name,
        aliases: splitList(li.querySelector('.e-edit-aliases').value),
        type: li.querySelector('.e-edit-type').value.trim(),
        tags: splitList(li.querySelector('.e-edit-tags').value),
        notes: li.querySelector('.e-edit-notes').value.trim(),
      });
      renderEntitiesTab(projectId, container);
    });
  });
}
