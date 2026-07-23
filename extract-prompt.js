'use strict';

// Single source of truth for the extraction contract: the system prompt AND,
// implicitly, the candidate JSON shape it demands. Both the browser app
// (extract.js) and the local-agent skill (skills/mycelium) import this file, so
// an agent running in a terminal produces candidates the app can apply without
// a second, diverging format existing anywhere.
export const EXTRACT_SYSTEM = `你是小說設定抽取助手。輸入是既有角色名單（含別名）與一段章節全文。
請找出文中的新角色/地點/勢力、新的人物關係、新的伏筆，並判斷每個名字是「全新角色」還是「既有角色的別名/新稱號」。
只回傳 JSON，格式：
{"entities":[{"name":"...","aliasOf":null,"type":"...","notes":"...","reason":"..."}],"relations":[{"source":"...","target":"...","type":"...","reason":"..."}],"foreshadow":[{"title":"...","notes":"...","reason":"..."}]}
entities 陣列裡，如果判斷是既有角色的別名，aliasOf 填該既有角色的名稱（必須完全符合既有名單裡的 name）；全新角色 aliasOf 填 null。
只回傳 JSON，不要其他文字。`;

// The "既有角色名單" half of the user message. Kept here (not in extract.js) so
// the skill builds byte-identical prompts to the app's.
export function formatKnownEntities(entities) {
  return entities
    .map((e) => `${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}`)
    .join('\n');
}

export function buildExtractUserMessage(entities, chapterText) {
  const known = formatKnownEntities(entities);
  return `既有角色名單：\n${known || '（尚無）'}\n\n章節全文：\n${chapterText}`;
}
