'use strict';
import { getAllRecords } from './db.js';

export async function buildContext(projectId) {
  const [entities, relations, foreshadow, chapters] = await Promise.all([
    getAllRecords(projectId, 'entities'),
    getAllRecords(projectId, 'relations'),
    getAllRecords(projectId, 'foreshadow'),
    getAllRecords(projectId, 'chapters'),
  ]);
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const recentChapters = chapters
    .sort((a, b) => (a.volume - b.volume) || (a.order - b.order))
    .slice(-10);

  return [
    '【設定庫】',
    ...entities.map((e) => `- ${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}［${e.type || '未分類'}］：${e.notes || ''}`),
    '【人物關係】',
    ...relations.map((r) => `- ${(entityById[r.sourceId] || {}).name || '?'} —${r.type}→ ${(entityById[r.targetId] || {}).name || '?'}`),
    '【伏筆】',
    ...foreshadow.map((f) => `- ${f.title}［${f.status}］：${f.notes || ''}`),
    '【最近章節摘要】',
    ...recentChapters.map((c) => `- 第${c.volume}卷・${c.title}：${c.summary || ''}`),
  ].join('\n');
}
