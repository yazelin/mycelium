'use strict';
// 資料形狀的單一事實來源：五個 store 的名字、備份／提案資料的驗證規則、
// 以及「哪些關係畫得出來」的過濾。
//
// 這三件事原本散在網頁 app 的 db.js / backup.js / graph.js 裡，網頁收掉之後
// （#34）搬到這裡，skill 就是它們唯一的家。搬過來的是純邏輯，一行 DOM 或
// IndexedDB 都沒有帶進來。

/** 一部作品的資料由這五個陣列組成，順序固定（快照、diff、提案都照這個順序印）。 */
export const PROJECT_STORES = ['entities', 'relations', 'chapters', 'foreshadow', 'chatlogs'];

// 一筆紀錄必須是「普通物件」：非 null、非陣列。id 允許缺席（寫入時再補），
// 但只要有值就必須是字串或數字——這是舊 app 從 IndexedDB 的 keyPath 規則學來
// 的教訓：一個形狀怪異的 id 會在 store 已經被清空之後才炸開。
function hasValidIdIfPresent(rec) {
  const id = rec.id;
  if (!id) return true;
  return (typeof id === 'string') || (typeof id === 'number');
}

export function isPlainRecord(rec) {
  return rec !== null && typeof rec === 'object' && !Array.isArray(rec) && hasValidIdIfPresent(rec);
}

/**
 * 一份完整的作品資料：普通物件，而且**五個 store 全部**都是陣列。
 * 要求「全部都有」而不是「有其中之一」是刻意的：少了一個 key 的半份檔案，
 * 套用時會被當成「那個 store 是空的」而整組洗掉。
 */
export function isValidProjectData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return PROJECT_STORES.every((store) => Array.isArray(data[store]));
}

/**
 * 畫得出來的關係：來源與目標角色都還存在的那些。
 *
 * 為什麼一定要過濾：端點指向已刪除角色的關係，會讓 Cytoscape 在建圖當下同步
 * 丟例外、整張圖畫不出來。這種懸空關係還是進得來（匯入舊備份、手改 JSON、
 * 早期沒有連帶刪除的資料），所以不能只靠刪除時的連帶清理。
 * `mycelium graph` 與 `context` 共用這一份判斷。
 */
export function validRelations(relations, entityById) {
  return (relations || []).filter((r) => entityById[r.sourceId] && entityById[r.targetId]);
}

/** HTML 逸出。產生離線 HTML 時，角色名字／設定文字一律經過這裡。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
