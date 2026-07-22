'use strict';
import { chat } from './ai-providers.js';
import { getAllRecords, putRecord } from './db.js';
import { esc } from './util.js';

const EXTRACT_SYSTEM = `你是小說設定抽取助手。輸入是既有角色名單（含別名）與一段章節全文。
請找出文中的新角色/地點/勢力、新的人物關係、新的伏筆，並判斷每個名字是「全新角色」還是「既有角色的別名/新稱號」。
只回傳 JSON，格式：
{"entities":[{"name":"...","aliasOf":null,"type":"...","notes":"...","reason":"..."}],"relations":[{"source":"...","target":"...","type":"...","reason":"..."}],"foreshadow":[{"title":"...","notes":"...","reason":"..."}]}
entities 陣列裡，如果判斷是既有角色的別名，aliasOf 填該既有角色的名稱（必須完全符合既有名單裡的 name）；全新角色 aliasOf 填 null。
只回傳 JSON，不要其他文字。`;

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
    try {
      const entities = await getAllRecords(projectId, 'entities');
      const known = entities
        .map((e) => `${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}`)
        .join('\n');
      const raw = await chat('extract', [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `既有角色名單：\n${known || '（尚無）'}\n\n章節全文：\n${text}` },
      ]);
      const result = parseExtractionJson(raw);
      renderCandidates(projectId, container, entities, result);
      status.textContent = '分析完成，請勾選要寫入的項目。';
    } catch (e) {
      status.textContent = '分析失敗：' + e.message;
    }
  });
}

function renderCandidates(projectId, container, existingEntities, result) {
  const box = container.querySelector('#ex-results');
  const entityCandidates = result.entities || [];
  const relationCandidates = result.relations || [];
  const foreshadowCandidates = result.foreshadow || [];

  box.innerHTML = `
    <h3>新設定候選</h3>
    <ul class="candidate-list" id="ex-entities">
      ${entityCandidates.map((c) => `
        <li>
          <label><input type="checkbox" checked> ${esc(c.name)}
            ${c.aliasOf ? `→ 合併為「${esc(c.aliasOf)}」的別名` : `（新角色，類型：${esc(c.type || '未分類')}）`}
          </label>
          <p class="reason">${esc(c.reason || '')}</p>
        </li>`).join('')}
    </ul>
    <h3>新關係候選</h3>
    <ul class="candidate-list" id="ex-relations">
      ${relationCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.source)} —${esc(c.type)}→ ${esc(c.target)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
    <h3>新伏筆候選</h3>
    <ul class="candidate-list" id="ex-foreshadow">
      ${foreshadowCandidates.map((c) => `
        <li><label><input type="checkbox" checked> ${esc(c.title)}</label><p class="reason">${esc(c.reason || '')}</p></li>`).join('')}
    </ul>
    <button id="ex-apply" type="button">寫入勾選的項目</button>
  `;

  box.querySelector('#ex-apply').addEventListener('click', async () => {
    // Mutable, kept in sync as each candidate is written — not a one-time
    // snapshot. The flagship scenario this app exists for is a name that is
    // BOTH a brand-new entity AND the alias target of another candidate in
    // the very same batch (e.g. "魔王" appears as a new entity, then later in
    // the same extraction "系統管理員陳先生" is revealed as 魔王's alias).
    const nameToEntity = Object.fromEntries(existingEntities.map((e) => [e.name, e]));

    const entityLis = [...box.querySelectorAll('#ex-entities li')];

    // Two passes, not one: the AI response is a flat array with no guaranteed
    // ordering between a new entity and candidates that alias it — a chapter
    // could plausibly introduce "系統管理員陳先生" before revealing "魔王" is
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
    }

    const entitiesAfter = await getAllRecords(projectId, 'entities');
    const findEntity = (name) => entitiesAfter.find((e) => e.name === name || (e.aliases || []).includes(name));

    const relationLis = [...box.querySelectorAll('#ex-relations li')];
    for (let i = 0; i < relationLis.length; i++) {
      if (!relationLis[i].querySelector('input').checked) continue;
      const c = relationCandidates[i];
      const source = findEntity(c.source);
      const target = findEntity(c.target);
      if (!source || !target) continue;
      await putRecord(projectId, 'relations', { sourceId: source.id, targetId: target.id, type: c.type, notes: c.reason || '' });
    }

    const foreshadowLis = [...box.querySelectorAll('#ex-foreshadow li')];
    for (let i = 0; i < foreshadowLis.length; i++) {
      if (!foreshadowLis[i].querySelector('input').checked) continue;
      const c = foreshadowCandidates[i];
      await putRecord(projectId, 'foreshadow', { title: c.title, plantChapterId: null, recoverChapterId: null, status: '埋設中', relatedEntityIds: [], relatedRelationIds: [], notes: c.notes || '' });
    }

    alert('已寫入勾選的項目，切換到對應分頁查看。');
  });
}
