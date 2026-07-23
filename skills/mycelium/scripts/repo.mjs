'use strict';
// 作品 repo 的存取層：一律走 gh CLI（使用者已經登入過），不碰 PAT。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_STORES } from '../../../db.js';

export const CONFIG_PATH = join(homedir(), '.config', 'mycelium', 'works.json');

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { default: null, works: {} };
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { default: cfg.default || null, works: cfg.works || {} };
  } catch (e) {
    throw new Error(`設定檔 ${CONFIG_PATH} 不是合法 JSON：${e.message}`);
  }
}

/**
 * 決定要操作哪一部作品的 repo。優先序：--repo > --work > MYCELIUM_REPO > 設定檔的 default。
 * 一個 skill 服務多部作品，作品與 repo 一對一。
 */
export function resolveRepo({ repo, work } = {}) {
  const cfg = readConfig();
  let slug = repo || null;
  if (!slug && work) {
    slug = cfg.works[work];
    if (!slug) throw new Error(`設定檔裡沒有作品「${work}」，現有：${Object.keys(cfg.works).join('、') || '（空）'}`);
  }
  if (!slug) slug = process.env.MYCELIUM_REPO || null;
  if (!slug && cfg.default) slug = cfg.works[cfg.default] || cfg.default;
  if (!slug) {
    throw new Error(
      `不知道要讀哪一部作品。請用 --repo <owner/name>、--work <作品名>、環境變數 MYCELIUM_REPO，` +
      `或在 ${CONFIG_PATH} 寫 {"default":"作品名","works":{"作品名":"owner/name"}}。`
    );
  }
  const [owner, name] = String(slug).split('/');
  if (!owner || !name) throw new Error(`repo 格式要是 owner/name，收到「${slug}」。`);
  return { owner, name, slug: `${owner}/${name}` };
}

function gh(args, input) {
  try {
    return execFileSync('gh', args, {
      input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    if (/gh auth login|not logged/i.test(stderr)) {
      throw new Error('gh 尚未登入，請先跑 `gh auth login`。');
    }
    const err = new Error(stderr || e.message);
    err.stderr = stderr;
    err.notFound = /HTTP 404|Not Found/i.test(stderr);
    throw err;
  }
}

export function ghGetRaw(repo, path) {
  try {
    return gh([
      'api',
      '-H', 'Accept: application/vnd.github.raw',
      `repos/${repo.slug}/contents/${path}`,
    ]);
  } catch (e) {
    if (e.notFound) return null;
    throw e;
  }
}

export function ghGetSha(repo, path) {
  try {
    const out = gh(['api', `repos/${repo.slug}/contents/${path}`, '--jq', '.sha']);
    return out.trim() || null;
  } catch (e) {
    if (e.notFound) return null;
    throw e;
  }
}

export function ghPutFile(repo, path, contentString, message) {
  const sha = ghGetSha(repo, path);
  const body = {
    message,
    content: Buffer.from(contentString, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };
  gh(['api', '--method', 'PUT', `repos/${repo.slug}/contents/${path}`, '--input', '-'], JSON.stringify(body));
  return { path, updated: !!sha };
}

export function cacheDir(repo) {
  return join(homedir(), '.cache', 'mycelium-skill', `${repo.owner}__${repo.name}`);
}

/**
 * 讀作品 repo 的 data/*.json。全部五個都 404 代表 repo 打錯或還沒同步過，
 * 這時候要報錯而不是回傳五個空陣列——跟 app 的 importFromGithub 同一個判斷，
 * 那個誤判曾經整份洗掉專案。
 */
export function pullData(repo) {
  const data = {};
  let found = 0;
  const missing = [];
  for (const store of PROJECT_STORES) {
    const raw = ghGetRaw(repo, `data/${store}.json`);
    if (raw === null) {
      data[store] = [];
      missing.push(store);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`data/${store}.json 不是合法 JSON：${e.message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`data/${store}.json 不是陣列。`);
    data[store] = parsed;
    found++;
  }
  if (found === 0) {
    throw new Error(`在 ${repo.slug} 找不到任何 data/*.json——確認 repo 名稱，或先在網頁按一次「同步到 GitHub」。`);
  }
  const dir = join(cacheDir(repo), 'data');
  mkdirSync(dir, { recursive: true });
  for (const store of PROJECT_STORES) {
    writeFileSync(join(dir, `${store}.json`), JSON.stringify(data[store], null, 2) + '\n', 'utf8');
  }
  return { data, missing, cachedAt: dir };
}

export function readCachedData(repo) {
  const dir = join(cacheDir(repo), 'data');
  if (!existsSync(dir)) return null;
  const data = {};
  for (const store of PROJECT_STORES) {
    const f = join(dir, `${store}.json`);
    data[store] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  }
  return data;
}

export function timestamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * 直接寫入前的快照：先存一份本機備份（就算 GitHub 那邊出事也救得回來），
 * 再把同一份推到 repo 的 snapshots/<timestamp>/。回傳兩邊的位置。
 */
export function writeSnapshot(repo, data, ts = timestamp()) {
  const localDir = join(cacheDir(repo), 'snapshots', ts);
  mkdirSync(localDir, { recursive: true });
  for (const store of PROJECT_STORES) {
    writeFileSync(join(localDir, `${store}.json`), JSON.stringify(data[store] || [], null, 2) + '\n', 'utf8');
  }
  const remote = [];
  for (const store of PROJECT_STORES) {
    const path = `snapshots/${ts}/${store}.json`;
    ghPutFile(repo, path, JSON.stringify(data[store] || [], null, 2) + '\n', `snapshot ${ts} ${store}`);
    remote.push(path);
  }
  return { localDir, remoteDir: `snapshots/${ts}/`, remote, ts };
}

/** 本機快取裡有哪些快照（時間戳排序，新的在後）。 */
export function localSnapshots(repo) {
  const dir = join(cacheDir(repo), 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** repo 裡有哪些快照。repo 還沒有 snapshots/ 就回空陣列。 */
export function remoteSnapshots(repo) {
  const raw = ghGetRaw(repo, 'snapshots');
  if (raw === null) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((f) => f.type === 'dir').map((f) => f.name).sort();
}

/**
 * 讀某個快照的五個 store。先看本機快取（快、離線也行），沒有才去 repo 抓。
 * 回傳 { data, from }；兩邊都沒有就回 null。
 */
export function readSnapshot(repo, ts) {
  const dir = join(cacheDir(repo), 'snapshots', ts);
  if (existsSync(dir)) {
    const data = {};
    for (const store of PROJECT_STORES) {
      const f = join(dir, `${store}.json`);
      data[store] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
    }
    return { data, from: dir };
  }
  const data = {};
  let found = 0;
  for (const store of PROJECT_STORES) {
    const raw = ghGetRaw(repo, `snapshots/${ts}/${store}.json`);
    if (raw === null) { data[store] = []; continue; }
    data[store] = JSON.parse(raw);
    found++;
  }
  if (!found) return null;
  return { data, from: `${repo.slug} 的 snapshots/${ts}/` };
}

export function writeData(repo, data, message) {
  const written = [];
  for (const store of PROJECT_STORES) {
    ghPutFile(repo, `data/${store}.json`, JSON.stringify(data[store] || [], null, 2) + '\n', `${message} (${store})`);
    written.push(`data/${store}.json`);
  }
  const dir = join(cacheDir(repo), 'data');
  mkdirSync(dir, { recursive: true });
  for (const store of PROJECT_STORES) {
    writeFileSync(join(dir, `${store}.json`), JSON.stringify(data[store] || [], null, 2) + '\n', 'utf8');
  }
  return written;
}
