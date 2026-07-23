'use strict';
// 把一份作品資料壓成餵給模型的 context 區塊。
//
// 原本住在網頁 app 的 ai-context.js（網頁 AI 與 skill 共用同一份格式），
// 網頁收掉之後（#34）搬過來。純函式，不碰 DOM 也不碰資料庫。
import { validRelations } from './schema.mjs';

export function formatContext({ entities = [], relations = [], foreshadow = [], chapters = [] }) {
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const relationById = Object.fromEntries(relations.map((r) => [r.id, r]));

  // 端點已不存在的關係不送給模型當雜訊——跟關係圖同一個過濾。
  const usable = validRelations(relations, entityById);

  // 先 .slice()：呼叫端（skill）會拿同一份 data 繼續用，不可以就地排序它。
  const recentChapters = chapters
    .slice()
    .sort((a, b) => (a.volume - b.volume) || (a.order - b.order))
    .slice(-10);

  // 伏筆的關聯 id 指向已刪除的角色／已不成立的關係時，這裡直接略過，
  // 而不是送一個裸 id 或「?」給模型。
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
    ...usable.map((r) => `- ${(entityById[r.sourceId] || {}).name || '?'} —${r.type}→ ${(entityById[r.targetId] || {}).name || '?'}${r.notes ? `：${r.notes}` : ''}`),
    '【伏筆】',
    ...foreshadow.map((f) => {
      const linked = linkedLabels(f);
      return `- ${f.title}［${f.status}］：${f.notes || ''}${linked.length ? `（關聯：${linked.join('、')}）` : ''}`;
    }),
    '【最近章節摘要】',
    ...recentChapters.map((c) => `- 第${c.volume}卷・${c.title}：${c.summary || ''}`),
  ].join('\n');
}
