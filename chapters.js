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
      ${chapters.map((c) => {
        const hasContent = !!(c.content && c.content.trim());
        return `
        <li data-id="${c.id}">
          <strong>第${c.volume}卷・${esc(c.title)}</strong>
          <select class="c-status-select">${CHAPTER_STATUSES.map((s) => `<option${s === c.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <span class="wordcount">${c.wordCount || 0} 字</span>
          <span class="content-indicator${hasContent ? ' has-content' : ''}">${hasContent ? `正文 ${c.content.length} 字` : '尚無正文'}</span>
          <button class="c-toggle-content" type="button">檢視正文</button>
          <button class="c-delete" type="button">刪除</button>
          <p>${esc(c.summary)}</p>
          <div class="chapter-content-editor" hidden>
            <textarea class="c-content-edit" placeholder="正文（選填）">${esc(c.content)}</textarea>
            <button class="c-content-save" type="button">儲存正文</button>
          </div>
        </li>`;
      }).join('')}
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
      // 正文是這個 app 裡最高價值的資料——刪章節連正文都會一起消失，且沒有
      // undo，所以確認訊息一定要點出這件事，但只在真的有正文時才提，避免
      // 對空章節也嚇唬使用者。
      const chapter = chapters.find((c) => c.id === id);
      const hasContent = !!(chapter && chapter.content && chapter.content.trim());
      const message = hasContent
        ? '確定要刪除這個章節？正文也會一併刪除，此動作無法復原。'
        : '確定要刪除這個章節？';
      if (!confirm(message)) return;
      await deleteRecord(projectId, 'chapters', id);
      renderChaptersTab(projectId, container);
    });
  });

  // Status is the sole input to the progress line above and to foreshadow.js's
  // overdue detection, yet until now it was write-once — moving a chapter
  // through 未寫→草稿→完稿 (the most frequent action in this tool) required
  // delete + re-create, which changes the chapter's id and orphans every
  // foreshadow pointing at it. Write the new status back onto the EXISTING
  // record via putRecord (preserving its id) instead.
  container.querySelectorAll('.c-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.closest('li').dataset.id;
      const chapter = chapters.find((c) => c.id === id);
      if (!chapter) return;
      await putRecord(projectId, 'chapters', { ...chapter, status: sel.value });
      renderChaptersTab(projectId, container);
    });
  });

  // The list is meant to stay scannable, so the 正文 textarea is collapsed by
  // default and only shown per-chapter on demand — this is purely a UI toggle,
  // no data read/write, so it doesn't need a re-render.
  container.querySelectorAll('.c-toggle-content').forEach((btn) => {
    btn.addEventListener('click', () => {
      const editor = btn.closest('li').querySelector('.chapter-content-editor');
      const opening = editor.hidden;
      editor.hidden = !opening;
      btn.textContent = opening ? '收合正文' : '檢視正文';
    });
  });

  // Same id-preserving update pattern as the status select above: write the
  // edited 正文 back onto the EXISTING record via putRecord instead of
  // delete+recreate, so any foreshadow pointing at this chapter keeps resolving.
  container.querySelectorAll('.c-content-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const chapter = chapters.find((c) => c.id === id);
      if (!chapter) return;
      const content = li.querySelector('.c-content-edit').value.trim();
      await putRecord(projectId, 'chapters', { ...chapter, content });
      renderChaptersTab(projectId, container);
    });
  });
}
