'use strict';
import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { esc } from './util.js';

// The one live object this codebase's render*Tab(projectId, container) + innerHTML
// pattern doesn't account for: a Cytoscape instance keeps window listeners and an
// animation loop alive even after its container's innerHTML is discarded. Track it
// here so every entry point (a fresh render, a recursive re-render from #r-add /
// .r-delete, or app.js tearing the tab down on tab-switch) destroys the previous
// instance before the DOM node it's attached to is thrown away.
let cyInstance = null;

function destroyCy() {
  if (cyInstance && !cyInstance.destroyed()) cyInstance.destroy();
  cyInstance = null;
}

// Exported for app.js's optional tab-teardown hook — see TABS.graph in app.js.
export function destroyGraphTab() {
  destroyCy();
}

export async function renderGraphTab(projectId, container) {
  destroyCy(); // in case this is a re-render (add/delete relation) reusing the same container
  const [entities, relations] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
  ]);
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));

  // Defensive layer: entities.js cascade-deletes relations when their entity
  // goes away, but this filter is what actually keeps the tab from ever
  // bricking again — a relation whose source/target entity no longer exists
  // (from data written before that fix, a manual DB edit, a partial import,
  // etc.) makes Cytoscape throw synchronously and abort the whole render
  // below (including the #r-add listener), so it must never reach elements.
  const validRelations = relations.filter((r) => entityById[r.sourceId] && entityById[r.targetId]);

  container.innerHTML = `
    <section class="relation-form">
      <h2>新增關係</h2>
      <select id="r-source">${entities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
      <select id="r-target">${entities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
      <input id="r-type" placeholder="關係類型（敵對/從屬/師徒…）">
      <button id="r-add" type="button">新增</button>
    </section>
    <div id="cy" style="width:100%;height:500px;border:1px solid #ccc;"></div>
    <ul class="relation-list">
      ${relations.map((r) => `
        <li data-id="${r.id}">
          <span>${esc((entityById[r.sourceId] || {}).name || '（已刪除）')} —${esc(r.type)}→ ${esc((entityById[r.targetId] || {}).name || '（已刪除）')}</span>
          <button class="r-delete" type="button">刪除</button>
        </li>`).join('')}
    </ul>
  `;

  const cyEl = container.querySelector('#cy');
  const cy = window.cytoscape({
    container: cyEl,
    elements: [
      ...entities.map((e) => ({ data: { id: e.id, label: e.name } })),
      ...validRelations.map((r) => ({ data: { id: r.id, source: r.sourceId, target: r.targetId, label: r.type } })),
    ],
    style: [
      { selector: 'node', style: { label: 'data(label)', 'background-color': '#2d4a3e', color: '#fff', 'text-valign': 'center', 'font-size': 12 } },
      { selector: 'edge', style: { label: 'data(label)', width: 2, 'line-color': '#999', 'target-arrow-color': '#999', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': 10 } },
    ],
    layout: { name: 'cose' },
  });
  cyEl._cyInstance = cy; // test hook — inspected directly in tests/graph.spec.js
  cyInstance = cy;

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

  // Recovery layer: until now there was no way at all to remove a relation
  // (only entities/chapters/foreshadow had delete buttons) — so a stale or
  // unwanted relation, dangling or not, could never be cleared from inside
  // the app.
  container.querySelectorAll('.r-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      if (!confirm('確定要刪除這筆關係？')) return;
      await deleteRecord(projectId, 'relations', id);
      renderGraphTab(projectId, container);
    });
  });
}
