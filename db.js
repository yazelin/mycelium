'use strict';

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const META_DB = 'mycelium-meta';
const META_STORE = 'projects';
let metaDBPromise = null;
function metaDB() {
  if (!metaDBPromise) {
    metaDBPromise = openDB(META_DB, 1, (db) => {
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
    });
  }
  return metaDBPromise;
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function listProjects() {
  const db = await metaDB();
  return reqToPromise(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll());
}

export async function createProject(name) {
  const db = await metaDB();
  const project = { id: newId('p'), name, repo: null, createdAt: Date.now() };
  await reqToPromise(db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).add(project));
  return project;
}

export async function updateProjectMeta(id, patch) {
  const db = await metaDB();
  const store = db.transaction(META_STORE, 'readwrite').objectStore(META_STORE);
  const existing = await reqToPromise(store.get(id));
  const updated = Object.assign({}, existing, patch);
  await reqToPromise(store.put(updated));
  return updated;
}

export async function deleteProjectMeta(id) {
  const db = await metaDB();
  await reqToPromise(db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).delete(id));
  indexedDB.deleteDatabase('mycelium-project-' + id);
}

export const PROJECT_STORES = ['entities', 'relations', 'chapters', 'foreshadow', 'chatlogs'];
const projectDBCache = {};
function projectDB(projectId) {
  if (!projectDBCache[projectId]) {
    projectDBCache[projectId] = openDB('mycelium-project-' + projectId, 1, (db) => {
      for (const store of PROJECT_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    });
  }
  return projectDBCache[projectId];
}

export async function getAllRecords(projectId, store) {
  const db = await projectDB(projectId);
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function putRecord(projectId, store, record) {
  const db = await projectDB(projectId);
  if (!record.id) record.id = newId(store[0]);
  await reqToPromise(db.transaction(store, 'readwrite').objectStore(store).put(record));
  return record;
}

export async function deleteRecord(projectId, store, id) {
  const db = await projectDB(projectId);
  await reqToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(id));
}
