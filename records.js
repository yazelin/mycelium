'use strict';

// 紀錄層的共用規則：狀態列舉、章節排序、伏筆逾期判斷、刪除 entity 的連帶範圍。
//
// 網頁 app（chapters.js / foreshadow.js / entities.js）與本機 agent skill
// （skills/mycelium）都 import 這一份，所以「章節怎麼排」「伏筆算不算逾期」
// 「刪一個角色會連帶刪掉哪些關係」在兩邊永遠是同一套答案，不存在第二份實作。
//
// 這裡只放純函式，不碰 DOM 也不碰 IndexedDB，才能同時跑在瀏覽器與 node。

export const CHAPTER_STATUSES = ['未寫', '草稿', '完稿'];
export const FORESHADOW_STATUSES = ['埋設中', '已回收', '棄用'];

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
 * Cytoscape 在 renderGraphTab 途中丟例外、整張關係圖畫不出來（見 graph.js）。
 * 網頁與 skill 走同一個函式，就不會有一邊漏刪的情形。
 */
export function relationsAffectedByEntityDelete(relations, entityId) {
  return (relations || []).filter((r) => r.sourceId === entityId || r.targetId === entityId);
}

/**
 * 刪除 entity 後，還會指向它的伏筆關聯。
 * 網頁**不會**自動清掉這些關聯（顯示成「（已刪除）」），skill 也照做，
 * 但要能列出來提醒使用者。
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
