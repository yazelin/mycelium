'use strict';
import { collectProjectData, replaceProjectData } from './backup.js';
import { listProjects, PROJECT_STORES } from './db.js';

function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64DecodeUtf8(str) { return decodeURIComponent(escape(atob(str))); }

async function ghFetch(url, options = {}) {
  const pat = localStorage.getItem('mycelium-github-pat');
  if (!pat) throw new Error('請先在設定填 GitHub PAT。');
  return fetch(url, {
    ...options,
    headers: { authorization: 'Bearer ' + pat, accept: 'application/vnd.github+json', ...(options.headers || {}) },
  });
}

async function projectRepo(projectId) {
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
    if (getRes.ok) sha = (await getRes.json()).sha;
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
  for (const store of PROJECT_STORES) {
    const path = `data/${store}.json`;
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
    const res = await ghFetch(url);
    if (res.status === 404) { data[store] = []; continue; }
    if (!res.ok) throw new Error(`讀取 ${store} 失敗（HTTP ${res.status}）`);
    const d = await res.json();
    data[store] = JSON.parse(b64DecodeUtf8(d.content));
  }
  await replaceProjectData(projectId, data);
}
