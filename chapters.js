'use strict';
import { getAllRecords, putRecord, deleteRecord } from './db.js';
import { esc } from './util.js';

export const CHAPTER_STATUSES = ['未寫', '草稿', '完稿'];

export async function renderChaptersTab(projectId, container) {
  const chapters = await getAllRecords(projectId, 'chapters');
  chapters.sort((a, b) => (a.volume - b.volume) || (a.order - b.order));
  const counts = CHAPTER_STATUSES.reduce((acc, s) => ({ ...acc, [s]: chapters.filter((c) => c.status === s).length }), {});

  container.innerHTML = `
    <section class="chapter-form">
      <h2>新增章節</h2>
      <input id="c-volume" type="number" placeholder="卷數" value="1">
      <input id="c-title" placeholder="章節標題">
      <select id="c-status">${CHAPTER_STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
      <input id="c-wordcount" type="number" placeholder="字數" value="0">
      <textarea id="c-summary" placeholder="大綱摘要"></textarea>
      <textarea id="c-content" placeholder="正文（選填）"></textarea>
      <button id="c-add" type="button">新增</button>
    </section>
    <p class="chapter-stats">進度：${CHAPTER_STATUSES.map((s) => `${s} ${counts[s]}`).join('・')}</p>
    <ul class="chapter-list">
      ${chapters.map((c) => `
        <li data-id="${c.id}">
          <strong>第${c.volume}卷・${esc(c.title)}</strong>
          <span class="status">${esc(c.status)}</span>
          <span class="wordcount">${c.wordCount || 0} 字</span>
          <p>${esc(c.summary)}</p>
          <button class="c-delete" type="button">刪除</button>
        </li>`).join('')}
    </ul>
  `;

  container.querySelector('#c-add').addEventListener('click', async () => {
    const title = container.querySelector('#c-title').value.trim();
    if (!title) return;
    await putRecord(projectId, 'chapters', {
      volume: +container.querySelector('#c-volume').value || 1,
      order: chapters.length,
      title,
      status: container.querySelector('#c-status').value,
      wordCount: +container.querySelector('#c-wordcount').value || 0,
      summary: container.querySelector('#c-summary').value.trim(),
      content: container.querySelector('#c-content').value.trim(),
    });
    renderChaptersTab(projectId, container);
  });

  container.querySelectorAll('.c-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      await deleteRecord(projectId, 'chapters', id);
      renderChaptersTab(projectId, container);
    });
  });
}
