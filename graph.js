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
// cose is an async force-directed layout: it keeps scheduling animation-frame
// callbacks that write positions back into the Cytoscape instance. Keep a reference
// to the running layout so destroyCy() can stop it — and stop cy's own animation
// queue too — before the instance goes away.
let cyLayout = null;

function destroyCy() {
  const layout = cyLayout;
  const inst = cyInstance;
  cyLayout = null;
  cyInstance = null;
  if (layout) layout.stop();
  if (!inst || inst.destroyed()) return;
  inst.stop();
  // layout.stop() sets a flag but cose's already-scheduled animation-frame callback
  // still runs once more to commit its last computed positions — that commit is
  // what throws (`Cannot read properties of null (reading 'notify')`) if cy.destroy()
  // already ran by the time it fires. Give that pending frame a chance to land
  // (it's a no-op if nothing was pending) before actually destroying the instance.
  requestAnimationFrame(() => {
    if (!inst.destroyed()) inst.destroy();
  });
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
      <textarea id="r-notes" placeholder="關係描述（選填）"></textarea>
      <button id="r-add" type="button">新增</button>
    </section>
    <div id="cy" style="width:100%;height:500px;border:1px solid #ccc;"></div>
    <ul class="relation-list">
      ${relations.map((r) => `
        <li data-id="${r.id}">
          <span>${esc((entityById[r.sourceId] || {}).name || '（已刪除）')} —${esc(r.type)}→ ${esc((entityById[r.targetId] || {}).name || '（已刪除）')}</span>
          <p class="relation-notes">${esc(r.notes || '')}</p>
          <button class="r-toggle-notes" type="button">編輯描述</button>
          <button class="r-delete" type="button">刪除</button>
          <div class="relation-notes-editor" hidden>
            <textarea class="r-notes-edit" placeholder="關係描述（選填）">${esc(r.notes)}</textarea>
            <button class="r-notes-save" type="button">儲存描述</button>
          </div>
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
  });
  cyEl._cyInstance = cy; // test hook — inspected directly in tests/graph.spec.js
  cyInstance = cy;
  // Run cose manually (instead of passing it as the constructor's `layout` option)
  // so the layout instance itself is reachable — otherwise there'd be nothing for
  // destroyCy() to call .stop() on before cy.destroy() runs.
  cyLayout = cy.layout({ name: 'cose' });
  cyLayout.run();

  cy.on('tap', 'node', (evt) => {
    const entity = entities.find((e) => e.id === evt.target.id());
    if (entity) alert(`${entity.name}\n類型：${entity.type || '（無）'}\n${entity.notes || ''}`);
  });

  container.querySelector('#r-add').addEventListener('click', async () => {
    const sourceId = container.querySelector('#r-source').value;
    const targetId = container.querySelector('#r-target').value;
    const type = container.querySelector('#r-type').value.trim();
    const notes = container.querySelector('#r-notes').value.trim();
    if (!sourceId || !targetId || !type) return;
    await putRecord(projectId, 'relations', { sourceId, targetId, type, notes });
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

  // extract.js has always written a `notes` field onto AI-proposed relations
  // (the model's reasoning for why the relation exists), and a hand-added
  // relation has no way to record why it exists either — but until now no UI
  // ever showed or collected it, so that text was silently invisible. Toggle
  // pattern matches chapters.js's 正文 editor: collapsed by default, revealed
  // on demand, saved back onto the EXISTING record via putRecord so the
  // relation's id/sourceId/targetId survive the edit.
  container.querySelectorAll('.r-toggle-notes').forEach((btn) => {
    btn.addEventListener('click', () => {
      const editor = btn.closest('li').querySelector('.relation-notes-editor');
      const opening = editor.hidden;
      editor.hidden = !opening;
      btn.textContent = opening ? '收合描述' : '編輯描述';
    });
  });

  container.querySelectorAll('.r-notes-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const relation = relations.find((r) => r.id === id);
      if (!relation) return;
      const notes = li.querySelector('.r-notes-edit').value.trim();
      await putRecord(projectId, 'relations', { ...relation, notes });
      renderGraphTab(projectId, container);
    });
  });
}
