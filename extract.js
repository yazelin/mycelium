'use strict';
import { chat } from './ai-providers.js';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';
import { EXTRACT_SYSTEM, buildExtractUserMessage } from './extract-prompt.js';

const TASK = 'extract';

function parseExtractionJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 沒有回傳可解析的 JSON。');
  return JSON.parse(match[0]);
}

export async function renderExtractPanel(projectId, container) {
  container.innerHTML = `
    <section class="extract-form">
      <textarea id="ex-text" placeholder="貼上章節全文…" rows="10"></textarea>
      <button id="ex-run" type="button">分析</button>
      <p id="ex-status"></p>
    </section>
    <div id="ex-results"></div>
  `;

  container.querySelector('#ex-run').addEventListener('click', async () => {
    const text = container.querySelector('#ex-text').value.trim();
    if (!text) return;
    const status = container.querySelector('#ex-status');
    status.textContent = '分析中…';
    // Same chatlogs recording pattern as ai-panel.js's runChatTask: log the
    // user side up front and the assistant side once a reply lands, so the
    // extraction task's exchange is reviewable afterwards like the other
    // three AI tasks (chat/consistency/plot) already are — this was the one
    // task that logged nothing at all.
    await putRecord(projectId, 'chatlogs', { task: TASK, role: 'user', content: text, createdAt: Date.now() });
    try {
      const entities = await getAllRecords(projectId, 'entities');
      const raw = await chat('extract', [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: buildExtractUserMessage(entities, text) },
      ]);
      await putRecord(projectId, 'chatlogs', { task: TASK, role: 'assistant', content: raw, createdAt: Date.now() });
      const result = parseExtractionJson(raw);
      renderCandidates(projectId, container, entities, result);
      status.textContent = '分析完成，請勾選要寫入的項目。';
    } catch (e) {
      // Matches runChatTask in ai-panel.js: a failed call surfaces the error
      // in the UI but isn't persisted to chatlogs (only a completed exchange is).
      status.textContent = '分析失敗：' + e.message;
    }
  });
}

function renderCandidates(projectId, container, existingEntities, result) {
  const box = container.querySelector('#ex-results');
  box.innerHTML = candidateListHtml(result, 'ex') + `<button id="ex-apply" type="button">寫入勾選的項目</button>`;

  box.querySelector('#ex-apply').addEventListener('click', async () => {
    await applyCandidates(projectId, existingEntities, result, box, 'ex');
    alert('已寫入勾選的項目，切換到對應分頁查看。');
  });
}

// Shared candidate-review markup, keyed by an id prefix so more than one
// independent review panel can exist in the app without id collisions — the
// extraction flow (this file, prefix "ex") and the GitHub-proposal flow
// (proposals.js, prefix "pr") both call this instead of each building their
// own copy of the checkbox list.
export function candidateListHtml(result, prefix) {
  const entityCandidates = result.entities || [];
  const relationCandidates = result.relations || [];
  const foreshadowCandidates = result.foreshadow || [];

  return `
    <h3>新設定候選</h3>
    <ul class="candidate-list" id="${prefix}-entities">
      ${entityCandidates.map((c) => `
        <li>
          <label><input type="checkbox" checked> ${esc(c.name)}
            ${c.aliasOf ? `→ 合併為「${esc(c.aliasOf)}」的別名` : `（新角色，類型：${esc(c.type || '未分類')}）`}
          </label>
          <p class="reason">${esc(c.reason || '')}</p>
        </li>`).join('')}
    </ul>
    <h3>新關係候選</h3>
    <ul class="candidate-list" id="${prefix}-relations">
      ${relationCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.source)} —${esc(c.type)}→ ${esc(c.target)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
    <h3>新伏筆候選</h3>
    <ul class="candidate-list" id="${prefix}-foreshadow">
      ${foreshadowCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.title)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
  `;
}

// Shared apply logic: writes only the ticked candidates into IndexedDB via
// putRecord, two passes not one (see below). `box` is the container that has
// candidateListHtml's checkbox lists inside it (looked up by the same
// `prefix`). Both the extraction flow and the GitHub-proposal flow call this
// one implementation — it took three review rounds to get the alias-merge
// ordering right, so it must not be copy-pasted into a second version that
// can drift from this one.
//
// Returns how many of each kind were actually applied, for the caller's own
// success message.
export async function applyCandidates(projectId, existingEntities, result, box, prefix) {
  const entityCandidates = result.entities || [];
  const relationCandidates = result.relations || [];
  const foreshadowCandidates = result.foreshadow || [];

  // Mutable, kept in sync as each candidate is written — not a one-time
  // snapshot. The flagship scenario this app exists for is a name that is
  // BOTH a brand-new entity AND the alias target of another candidate in
  // the very same batch (e.g. "城主" appears as a new entity, then later in
  // the same extraction "黑袍人" is revealed as 城主's alias).
  const nameToEntity = Object.fromEntries(existingEntities.map((e) => [e.name, e]));

  const entityLis = [...box.querySelectorAll(`#${prefix}-entities li`)];
  let entitiesApplied = 0;

  // Two passes, not one: the AI response is a flat array with no guaranteed
  // ordering between a new entity and candidates that alias it — a chapter
  // could plausibly introduce "黑袍人" before revealing "城主" is
  // the same person, so the alias candidate can appear before its target.
  // Pass 1 creates every plain new-entity candidate first, so pass 2's
  // alias lookups always see a complete nameToEntity map regardless of the
  // order the AI listed candidates in.
  for (let i = 0; i < entityLis.length; i++) {
    if (!entityLis[i].querySelector('input').checked) continue;
    const c = entityCandidates[i];
    if (c.aliasOf) continue;
    const created = await putRecord(projectId, 'entities', { name: c.name, aliases: [], type: c.type || '', tags: [], notes: c.notes || '' });
    nameToEntity[c.name] = created;
    entitiesApplied++;
  }

  for (let i = 0; i < entityLis.length; i++) {
    if (!entityLis[i].querySelector('input').checked) continue;
    const c = entityCandidates[i];
    if (!c.aliasOf) continue;
    if (nameToEntity[c.aliasOf]) {
      const target = nameToEntity[c.aliasOf];
      const aliases = Array.from(new Set([...(target.aliases || []), c.name]));
      const merged = await putRecord(projectId, 'entities', { ...target, aliases });
      nameToEntity[target.name] = merged;
      nameToEntity[c.name] = merged; // so a later candidate can alias by this new name too
    } else {
      // aliasOf target doesn't exist anywhere (existing entities or pass 1
      // creations) — the AI referenced something that doesn't exist at
      // all. Keep the current fallback: create it as its own entity rather
      // than silently dropping the candidate.
      const created = await putRecord(projectId, 'entities', { name: c.name, aliases: [], type: c.type || '', tags: [], notes: c.notes || '' });
      nameToEntity[c.name] = created;
    }
    entitiesApplied++;
  }

  const entitiesAfter = await getAllRecords(projectId, 'entities');
  const findEntity = (name) => entitiesAfter.find((e) => e.name === name || (e.aliases || []).includes(name));

  const relationLis = [...box.querySelectorAll(`#${prefix}-relations li`)];
  let relationsApplied = 0;
  for (let i = 0; i < relationLis.length; i++) {
    if (!relationLis[i].querySelector('input').checked) continue;
    const c = relationCandidates[i];
    const source = findEntity(c.source);
    const target = findEntity(c.target);
    if (!source || !target) continue;
    await putRecord(projectId, 'relations', { sourceId: source.id, targetId: target.id, type: c.type, notes: c.reason || '' });
    relationsApplied++;
  }

  const foreshadowLis = [...box.querySelectorAll(`#${prefix}-foreshadow li`)];
  let foreshadowApplied = 0;
  for (let i = 0; i < foreshadowLis.length; i++) {
    if (!foreshadowLis[i].querySelector('input').checked) continue;
    const c = foreshadowCandidates[i];
    await putRecord(projectId, 'foreshadow', { title: c.title, plantChapterId: null, recoverChapterId: null, status: '埋設中', relatedEntityIds: [], relatedRelationIds: [], notes: c.notes || '' });
    foreshadowApplied++;
  }

  return { entities: entitiesApplied, relations: relationsApplied, foreshadow: foreshadowApplied };
}
