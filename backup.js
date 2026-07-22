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

export async function exportProjectJson(projectId, projectName) {
  const data = await collectProjectData(projectId);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mycelium-${(projectName || projectId).replace(/[^\w-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importProjectJson(projectId, data) {
  await replaceProjectData(projectId, data);
}
