'use strict';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';

export async function renderGraphTab(projectId, container) {
  const [entities, relations] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
  ]);

  container.innerHTML = `
    <section class="relation-form">
      <h2>新增關係</h2>
      <select id="r-source">${entities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
      <select id="r-target">${entities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
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
