'use strict';

// 抽取契約的單一事實來源：system prompt，以及它隱含要求的候選 JSON 形狀。
// 原本是網頁 app 與 skill 共用，網頁收掉之後（#34）搬進 skill；
// 提案檔的格式仍然沿用這一份，舊提案照樣套得進去。
export const EXTRACT_SYSTEM = `你是小說設定抽取助手。輸入是既有角色名單（含別名）與一段章節全文。
請找出文中的新角色/地點/勢力、新的人物關係、新的伏筆，並判斷每個名字是「全新角色」還是「既有角色的別名/新稱號」。
只回傳 JSON，格式：
{"entities":[{"name":"...","aliasOf":null,"type":"...","notes":"...","reason":"..."}],"relations":[{"source":"...","target":"...","type":"...","reason":"..."}],"foreshadow":[{"title":"...","notes":"...","reason":"..."}]}
entities 陣列裡，如果判斷是既有角色的別名，aliasOf 填該既有角色的名稱（必須完全符合既有名單裡的 name）；全新角色 aliasOf 填 null。
既有名單裡已經有的名字（不管是本名還是別名），不要再當成全新角色列一次——那會變成同一個角色被記成兩筆。
只有在本章補到既有角色的重要設定時才列出它：aliasOf 填 null，reason 開頭寫「補設定：」並說明補了什麼；套用時預設會略過，只有使用者明講要更新才會蓋上去。
名字照文中與既有名單的寫法原樣抄，不要多加空白、不要改全形半形。
只回傳 JSON，不要其他文字。`;

// user message 的「既有角色名單」那一半。
export function formatKnownEntities(entities) {
  return entities
    .map((e) => `${e.name}${e.aliases && e.aliases.length ? `（別名：${e.aliases.join('、')}）` : ''}`)
    .join('\n');
}

export function buildExtractUserMessage(entities, chapterText) {
  const known = formatKnownEntities(entities);
  return `既有角色名單：\n${known || '（尚無）'}\n\n章節全文：\n${chapterText}`;
}
