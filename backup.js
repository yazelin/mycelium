'use strict';
import { PROJECT_STORES, getAllRecords, putRecord, deleteRecord } from './db.js';

export async function collectProjectData(projectId) {
  const data = {};
  for (const store of PROJECT_STORES) data[store] = await getAllRecords(projectId, store);
  return data;
}

// A record must be a plain, non-null, non-array object for putRecord/IndexedDB
// to accept it (putRecord reads/writes `.id` on it). Anything else (numbers,
// strings, null, arrays, ...) throws once written, but only after
// replaceProjectData has already deleted the store's existing records — so
// this must be checked up front, not discovered mid-write.
//
// A plain-object shape alone isn't enough, though: IndexedDB's `put()` also
// validates the record's `id` (its keyPath value) and throws synchronously
// (`DataError: ... yielded a value that is not a valid key`) for a truthy
// `id` that isn't a valid key (e.g. `{}`, `true`, an array, an object) —
// again only after the store has already been emptied. A missing or falsy
// `id` must still be allowed through: db.js's `putRecord` intentionally
// auto-assigns a fresh id in that case (`if (!record.id) record.id = ...`),
// so only a *truthy* id that isn't a non-empty string or a number is invalid.
function hasValidIdIfPresent(rec) {
  const id = rec.id;
  if (!id) return true; // falsy/absent: putRecord auto-assigns one
  return (typeof id === 'string') || (typeof id === 'number');
}

function isPlainRecord(rec) {
  return rec !== null && typeof rec === 'object' && !Array.isArray(rec) && hasValidIdIfPresent(rec);
}

export async function replaceProjectData(projectId, data) {
  // Validate every record in every store before touching the database. Any
  // caller of this function (importProjectJson, GitHub import, ...) gets the
  // same guarantee: a bad element anywhere means nothing is deleted anywhere,
  // rather than the previous behaviour where the delete-then-write loop for
  // one store already emptied it before the bad element in it was reached.
  for (const store of PROJECT_STORES) {
    for (const rec of (data[store] || [])) {
      if (!isPlainRecord(rec)) {
        throw new Error(`備份資料中的「${store}」含有無效的紀錄，未變更任何資料。`);
      }
    }
  }
  for (const store of PROJECT_STORES) {
    const existing = await getAllRecords(projectId, store);
    for (const rec of existing) await deleteRecord(projectId, store, rec.id);
    for (const rec of (data[store] || [])) await putRecord(projectId, store, rec);
  }
}

// A parsed backup file must be a plain object carrying EVERY PROJECT_STORES
// key as an array. A genuine export from this app always has all five
// (collectProjectData always writes every store, even as `[]`), so requiring
// all of them doesn't reject real backups. Anything less — e.g. a
// hand-trimmed file with only one store key — used to pass under `.some()`,
// and replaceProjectData's `data[store] || []` would then silently treat
// every *missing* store as empty and wipe it. Checked before any destructive
// call so a wrong-shaped or partial file changes nothing.
export function isValidProjectData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return PROJECT_STORES.every((store) => Array.isArray(data[store]));
}

// Characters that are genuinely unsafe in filenames: path separators, other
// filesystem-reserved punctuation, and ASCII control characters (built from
// character codes at runtime, not typed as escape sequences, to keep this
// file free of literal control bytes). Chinese (and other non-ASCII)
// characters are real, distinguishing content in a project name and must
// survive into the filename, unlike the old `\w`-only sanitizer (ASCII-only)
// which collapsed every all-Chinese name down to a single "_".
const CONTROL_CHARS = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
const UNSAFE_FILENAME_CHARS_RE = new RegExp('[\\\\/:*?"<>|' + CONTROL_CHARS + ']', 'g');

function sanitizeForFilename(name) {
  return String(name || '').replace(UNSAFE_FILENAME_CHARS_RE, '_').trim();
}

export async function exportProjectJson(projectId, projectName) {
  const data = await collectProjectData(projectId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stem = sanitizeForFilename(projectName);
  // If sanitizing left nothing distinguishing (empty, or only underscores/
  // whitespace), fall back to the project id so two projects can never
  // collide on the same filename.
  const safeStem = /[^_\s]/.test(stem) ? stem : projectId;
  a.download = `mycelium-${safeStem}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importProjectJson(projectId, data) {
  if (!isValidProjectData(data)) {
    throw new Error('這個檔案看起來不是 mycelium 的備份檔，未匯入任何資料。');
  }
  await replaceProjectData(projectId, data);
}
