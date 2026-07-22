'use strict';
import { PROJECT_STORES, getAllRecords, putRecord, deleteRecord } from './db.js';

export async function collectProjectData(projectId) {
  const data = {};
  for (const store of PROJECT_STORES) data[store] = await getAllRecords(projectId, store);
  return data;
}

export async function replaceProjectData(projectId, data) {
  for (const store of PROJECT_STORES) {
    const existing = await getAllRecords(projectId, store);
    for (const rec of existing) await deleteRecord(projectId, store, rec.id);
    for (const rec of (data[store] || [])) await putRecord(projectId, store, rec);
  }
}

// A parsed backup file must be a plain object carrying at least one
// PROJECT_STORES array, or replaceProjectData's `data[store] || []` silently
// treats every store as empty and wipes the project. Checked before any
// destructive call so a wrong-shaped file (e.g. an unrelated JSON the user
// picked by mistake) changes nothing.
export function isValidProjectData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return PROJECT_STORES.some((store) => Array.isArray(data[store]));
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
