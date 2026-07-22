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
            <select class="f-status-select">${STATUSES.map((s) => `<option${s === item.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
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

  // Same one-field-write pattern as chapters.js's status select: moving a
  // foreshadow between 埋設中/已回收/棄用 (esp. marking one 已回收) is a daily
  // action that previously required delete + re-create. Write status back
  // onto the EXISTING record so isOverdue and the status-grouped lists above
  // pick up the change on re-render.
  container.querySelectorAll('.f-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.closest('li').dataset.id;
      const item = items.find((i) => i.id === id);
      if (!item) return;
      await putRecord(projectId, 'foreshadow', { ...item, status: sel.value });
      renderForeshadowTab(projectId, container);
    });
  });
}
