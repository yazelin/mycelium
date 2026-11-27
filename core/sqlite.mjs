// 資料庫：node:sqlite 內建，零依賴。只壓掉 SQLite 的 ExperimentalWarning，其他警告照常印。
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  const name = warning?.name ?? type;
  const msg = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (name === 'ExperimentalWarning' && /SQLite/.test(msg)) return;
  return origEmit.call(process, warning, ...args);
};
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} finally {
  process.emitWarning = origEmit;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces(
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, time_axis TEXT, chapters_json TEXT);
CREATE TABLE IF NOT EXISTS entities(
  id TEXT PRIMARY KEY, space TEXT, type TEXT, name TEXT, summary TEXT, merged_into TEXT,
  name_hlc TEXT, summary_hlc TEXT, created_hlc TEXT);
CREATE TABLE IF NOT EXISTS aliases(
  id TEXT PRIMARY KEY, space TEXT, entity_id TEXT, alias TEXT, alias_key TEXT,
  platform TEXT, is_handle INTEGER DEFAULT 0, conflict INTEGER DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'public');
CREATE TABLE IF NOT EXISTS facts(
  id TEXT PRIMARY KEY, space TEXT, subject_id TEXT, predicate TEXT,
  object_entity TEXT, object_text TEXT, object_fact TEXT,
  valid_from TEXT, valid_to TEXT, audience TEXT, source_episode TEXT,
  confidence REAL, author TEXT, superseded_by TEXT, hlc TEXT);
CREATE TABLE IF NOT EXISTS episodes(
  id TEXT PRIMARY KEY, space TEXT, at TEXT, source TEXT, audience TEXT,
  body TEXT, entity_ids_json TEXT, hlc TEXT);
CREATE TABLE IF NOT EXISTS merges(
  id TEXT PRIMARY KEY, space TEXT, from_id TEXT, to_id TEXT, reason TEXT,
  status TEXT CHECK(status IN ('active','undone','pending')), hlc TEXT);
CREATE TABLE IF NOT EXISTS overwrites(
  id TEXT PRIMARY KEY, entity_id TEXT, field TEXT, old_value TEXT, new_value TEXT, hlc TEXT);
CREATE TABLE IF NOT EXISTS applied(op_id TEXT PRIMARY KEY, hlc TEXT);
CREATE TABLE IF NOT EXISTS vectors(
  ref_id TEXT, kind TEXT, model TEXT, dim INTEGER, vec BLOB);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  kind UNINDEXED, ref_id UNINDEXED, space UNINDEXED, text, tokenize='trigram');
`;

// 資料表格式改了就把版本加一；舊版的檔會被清空重建，Store 開啟時再從操作紀錄重播。
export const SCHEMA_VERSION = 2;
const DERIVED = ['fts', 'spaces', 'entities', 'aliases', 'facts', 'episodes', 'merges', 'overwrites', 'applied', 'vectors'];

export function openDb(path) {
  const db = new DatabaseSync(path);
  // 多個程序（多個 MCP server、命令列 sync）可能同時開同一個檔：等鎖最多 5 秒，並用 WAL 讓讀寫不互擋。
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  if (ver !== SCHEMA_VERSION) {
    const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
    if (hasTables) {
      console.warn(`資料庫格式版本 ${ver} 與程式的 ${SCHEMA_VERSION} 不同，清空重建（資料會從操作紀錄重播）`);
      for (const t of DERIVED) db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
  }
  db.exec(SCHEMA);
  if (ver !== SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
