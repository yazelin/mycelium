'use strict';
import { getAllRecords } from './db.js';

// Pure formatter, split out of buildContext so the local-agent skill
// (skills/mycelium — it reads data/*.json out of the work's GitHub repo instead
// of IndexedDB) hands its model the exact same context block the in-app AI
// sees. Any change to what the model is told happens here, once.
export function formatContext({ entities = [], relations = [], foreshadow = [], chapters = [] }) {
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const relationById = Object.fromEntries(relations.map((r) => [r.id, r]));

  // Skip relations whose source or target entity no longer exists, matching
  // the defensive filter in graph.js. Dangling relations can still enter the
  // database via imports (bypassing cascade-delete), so this guard prevents
  // them from being sent to the AI model as noise.
  const validRelations = relations.filter((r) => entityById[r.sourceId] && entityById[r.targetId]);

  // .slice() first: this used to sort the caller's own array in place, which
  // was harmless while the caller was always a fresh getAll() result but is a
  // trap now that the skill passes in data it keeps using afterwards.
  const recentChapters = chapters
    .slice()
    .sort((a, b) => (a.volume - b.volume) || (a.order - b.order))
    .slice(-10);

  // Same dangling-link guard as validRelations above, applied to a foreshadow's
  // relatedEntityIds/relatedRelationIds: an id pointing at a deleted entity (or
  // a relation that no longer resolves) is dropped here rather than sent to the
  // model as a bare id or a "?" placeholder — the UI's "（已刪除）" degrade is
  // for human display, the AI context just omits what no longer exists.
  function linkedLabels(f) {
    const entityLabels = (f.relatedEntityIds || []).map((id) => entityById[id]).filter(Boolean).map((e) => e.name);
    const relationLabels = (f.relatedRelationIds || [])
      .map((id) => relationById[id])
      .filter((r) => r && entityById[r.sourceId] && entityById[r.targetId])
      .map((r) => `${entityById[r.sourceId].name}—${r.type}→${entityById[r.targetId].name}`);
    return [...entityLabels, ...relationLabels];
  }

  return [
    '【設定庫】',
    ...entities.map((e) => `- ${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}［${e.type || '未分類'}］：${e.notes || ''}${e.customFields && e.customFields.length ? `（${e.customFields.map((f) => `${f.key}：${f.value}`).join('、')}）` : ''}`),
    '【人物關係】',
    ...validRelations.map((r) => `- ${(entityById[r.sourceId] || {}).name || '?'} —${r.type}→ ${(entityById[r.targetId] || {}).name || '?'}${r.notes ? `：${r.notes}` : ''}`),
    '【伏筆】',
    ...foreshadow.map((f) => {
      const linked = linkedLabels(f);
      return `- ${f.title}［${f.status}］：${f.notes || ''}${linked.length ? `（關聯：${linked.join('、')}）` : ''}`;
    }),
    '【最近章節摘要】',
    ...recentChapters.map((c) => `- 第${c.volume}卷・${c.title}：${c.summary || ''}`),
  ].join('\n');
}

export async function buildContext(projectId) {
  const [entities, relations, foreshadow, chapters] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
    getAllRecords(projectId, 'foreshadow'),
    getAllRecords(projectId, 'chapters'),
  ]);
  return formatContext({ entities, relations, foreshadow, chapters });
}
