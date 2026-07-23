'use strict';
import { collectProjectData, replaceProjectData } from './backup.js';
import { listProjects, PROJECT_STORES } from './db.js';

// Exported (not just used internally) so proposals.js can talk to the same
// GitHub Contents API endpoints with the same PAT-header handling and
// owner/name resolution, instead of re-implementing them.
export function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
export function b64DecodeUtf8(str) { return decodeURIComponent(escape(atob(str))); }

export async function ghFetch(url, options = {}) {
  const pat = localStorage.getItem('mycelium-github-pat');
  if (!pat) throw new Error('請先在設定填 GitHub PAT。');
  return fetch(url, {
    ...options,
    headers: { authorization: 'Bearer ' + pat, accept: 'application/vnd.github+json', ...(options.headers || {}) },
  });
}

export async function projectRepo(projectId) {
  const projects = await listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project || !project.repo || !project.repo.owner || !project.repo.name) throw new Error('這個作品尚未綁定 GitHub repo。');
  return project.repo;
}

export async function syncToGithub(projectId) {
  const repo = await projectRepo(projectId);
  const data = await collectProjectData(projectId);
  for (const store of PROJECT_STORES) {
    const path = `data/${store}.json`;
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
    let sha;
    const getRes = await ghFetch(url);
    if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else if (getRes.status !== 404) {
      const d = await getRes.json().catch(() => ({}));
      throw new Error(
        `無法確認 ${store} 是否已存在（HTTP ${getRes.status}），請確認 GitHub PAT 是否正確、未過期或權限足夠。` +
        (d.message ? `（GitHub 訊息：${d.message}）` : '')
      );
    }
    const content = b64EncodeUtf8(JSON.stringify(data[store], null, 2));
    const putRes = await ghFetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: `sync ${store}`, content, ...(sha ? { sha } : {}) }),
    });
    if (!putRes.ok) {
      const d = await putRes.json().catch(() => ({}));
      throw new Error(d.message || `同步 ${store} 失敗（HTTP ${putRes.status}）`);
    }
  }
}

export async function importFromGithub(projectId) {
  const repo = await projectRepo(projectId);
  const data = {};
  let foundCount = 0; // how many stores actually resolved (as opposed to 404ing)
  for (const store of PROJECT_STORES) {
    const path = `data/${store}.json`;
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
    const res = await ghFetch(url);
    if (res.status === 404) { data[store] = []; continue; }
    if (!res.ok) throw new Error(`讀取 ${store} 失敗（HTTP ${res.status}）`);
    const d = await res.json();
    data[store] = JSON.parse(b64DecodeUtf8(d.content));
    foundCount++;
  }
  // A 404 on every single store is not "an empty project" — it's a nonexistent
  // repo, a typo'd repo name, or a correctly-bound repo the user simply hasn't
  // synced yet. Treating that as "five empty stores" used to feed
  // replaceProjectData five empty arrays and silently delete the whole
  // project. A *partial* result (some stores present, some 404 — e.g. synced
  // entities but never chapters) is still a legitimate state and must import.
  if (foundCount === 0) {
    throw new Error('在這個 repo 找不到任何 data/*.json，未變更任何資料。');
  }
  await replaceProjectData(projectId, data);
}
