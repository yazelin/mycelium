'use strict';

// 紀錄層的共用規則：狀態列舉、章節排序、伏筆逾期判斷、刪除 entity 的連帶範圍。
//
// 原本是網頁 app 與 skill 共用的一份，網頁收掉之後（#34）搬進 skill。
// 「章節怎麼排」「伏筆算不算逾期」「刪一個角色會連帶刪掉哪些關係」只有這一份答案。
//
// 這裡只放純函式，不碰 DOM 也不碰資料庫。

export const CHAPTER_STATUSES = ['未寫', '草稿', '完稿'];
export const FORESHADOW_STATUSES = ['埋設中', '已回收', '棄用'];

/**
 * 角色的「製作層」欄位：畫師與生圖模型要的是可畫的規格，不是行為描寫。
 * 表層寫的是「袖子太長、走路會撞到東西」，那是寫小說用的；要畫出來還需要
 * 身高、髮色、配色。這幾個欄位就是那份規格。
 *
 * 一個角色可以有很多份（`visuals` 是陣列）：第一卷的艾可，跟第二卷被清空記憶
 * 之後的艾可，眼神就不該一樣。所以版本名是第一個欄位，不是可有可無的標籤。
 */
// key = 存在資料裡的欄位名；flag = 指令列選項；spec = 傳進 editEntity 的 spec 欄位
// （視覺備註的 spec 名字不能叫 notes——那是角色本身的設定內文，會撞在一起）。
export const VISUAL_FIELDS = [
  { key: 'appearance', flag: 'appearance', spec: 'appearance', label: '外貌', hint: '身高、體型、髮色髮長、眼睛' },
  { key: 'outfit', flag: 'outfit', spec: 'outfit', label: '服裝', hint: '款式、材質、配件' },
  { key: 'palette', flag: 'palette', spec: 'palette', label: '配色', hint: '主色、副色、重點色' },
  { key: 'features', flag: 'features', spec: 'features', label: '特徵', hint: '疤、飾品、慣用手、招牌姿勢' },
  { key: 'prompt', flag: 'prompt', spec: 'prompt', label: '生成提示詞', hint: '可以直接貼進生圖模型的那一段' },
  { key: 'notes', flag: 'visual-notes', spec: 'visualNotes', label: '備註', hint: '其他要交代給畫師的事' },
];

/** 一份空的視覺版本。欄位先立好、內容留空，等要開始畫圖的時候再填。 */
export function emptyVisual(version) {
  const v = { version };
  for (const f of VISUAL_FIELDS) v[f.key] = '';
  return v;
}

/** 這一份視覺版本還全空嗎（頁面要把「還沒填」講清楚，而不是留一片空白）。 */
export function isEmptyVisual(visual) {
  return VISUAL_FIELDS.every((f) => !String((visual || {})[f.key] || '').trim());
}

/** 章節排序：先卷、後卷內順序。回傳新陣列，不動傳進來的那個。 */
export function sortChapters(chapters) {
  return (chapters || []).slice().sort((a, b) => (a.volume - b.volume) || (a.order - b.order));
}

/**
 * 伏筆逾期：還在「埋設中」、有指定回收章、而那一章已經「完稿」——
 * 表示該回收的地方已經寫完了卻沒回收。
 */
export function isForeshadowOverdue(item, chapterById) {
  if (!item || item.status !== '埋設中' || !item.recoverChapterId) return false;
  const recoverChapter = chapterById[item.recoverChapterId];
  return !!recoverChapter && recoverChapter.status === '完稿';
}

/**
 * 刪除一個 entity 時要連帶刪掉的關係。
 *
 * 為什麼一定要連帶刪：source/target 指向已不存在的 entity 的關係，會讓
 * Cytoscape 建圖當下丟例外、整張關係圖畫不出來（見 schema.mjs 的 validRelations，
 * 那是最後一道防線，但資料本身該乾淨的時候就要乾淨）。
 */
export function relationsAffectedByEntityDelete(relations, entityId) {
  return (relations || []).filter((r) => r.sourceId === entityId || r.targetId === entityId);
}

/**
 * 刪除 entity 後，還會指向它的伏筆關聯。
 * 這些關聯**不會**被自動清掉（留著比默默刪掉安全），但要列出來提醒使用者。
 */
export function foreshadowReferencingEntity(foreshadow, entityId) {
  return (foreshadow || []).filter((f) => (f.relatedEntityIds || []).includes(entityId));
}

export function foreshadowReferencingRelation(foreshadow, relationId) {
  return (foreshadow || []).filter((f) => (f.relatedRelationIds || []).includes(relationId));
}

/** 伏筆指向的章節被刪掉時，會受影響的伏筆（埋設或回收章任一）。 */
export function foreshadowReferencingChapter(foreshadow, chapterId) {
  return (foreshadow || []).filter((f) => f.plantChapterId === chapterId || f.recoverChapterId === chapterId);
}
