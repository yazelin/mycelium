'use strict';
// 「上次以來 AI 動了什麼」——從作品 repo 的 git 歷史算出來。
//
// 為什麼是 git 而不是另外記一份：這個 skill 的每一次寫入本來就是一個 commit
// （`agent edit entity 20260723-131850 (entities)`），歷史已經在那裡了，
// 再記一份就會有兩份真相。
//
// 做法：列出動過 data/ 的 commit（新→舊），逐個抓當時的檔案內容，相鄰兩份用 id
// 對齊比對，就知道「哪一筆是在哪一個 commit 被新增或修改的」。
// 只往回看有限筆數（--history），因為使用者要的是「最近」，不是考古。
import { execFile } from 'node:child_process';

const STORE_OF_MESSAGE = /\(([a-z]+)\)\s*$/;
const DATA_STORES = ['entities', 'relations', 'chapters', 'foreshadow'];

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).trim();
        if (/gh auth login|not logged/i.test(msg)) return reject(new Error('gh 尚未登入，請先跑 `gh auth login`。'));
        const e = new Error(msg);
        e.notFound = /HTTP 404|Not Found/i.test(msg);
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

/** 一次跑幾個 gh，多了會被 GitHub 擋、少了要等很久。 */
async function pooled(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listCommits(repo, limit) {
  const out = await gh([
    'api', `repos/${repo.slug}/commits?path=data&per_page=${Math.min(100, limit)}`,
    '--jq', '.[] | [.sha, .commit.committer.date, .commit.message] | @tsv',
  ]);
  return out.split('\n').filter(Boolean).slice(0, limit).map((line) => {
    const [sha, at, ...rest] = line.split('\t');
    const message = rest.join('\t');
    const m = message.match(STORE_OF_MESSAGE);
    return { sha, at, message, store: m && DATA_STORES.includes(m[1]) ? m[1] : null };
  });
}

async function fileAt(repo, store, sha) {
  try {
    const raw = await gh(['api', '-H', 'Accept: application/vnd.github.raw',
      `repos/${repo.slug}/contents/data/${store}.json?ref=${sha}`]);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.notFound) return [];
    throw e;
  }
}

function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 回傳 { changes, commits, scanned, oldest, truncated }。
 *   changes：{ [紀錄 id]: { at, kind: 'added'|'changed', message, sha } }，只留最新的那一次
 *   commits：新→舊的清單，每筆帶著這次動到哪些 id（頁面的「改動」時間軸用這個）
 *
 * 抓不到歷史（沒網路、repo 沒 commit）不該讓整個指令失敗——review 少了新舊標記
 * 還是能看，所以呼叫端可以吞掉錯誤，只是頁面會說「這次沒有讀到歷史」。
 */
export async function fetchHistory(repo, { limit = 40, concurrency = 6 } = {}) {
  const commits = await listCommits(repo, limit + 1);
  if (!commits.length) return { changes: {}, commits: [], scanned: 0, oldest: null, truncated: false };

  // 每個 store 各自一條時間線：只有動過那個 store 的 commit 才要抓內容。
  const byStore = {};
  for (const c of commits) {
    const store = c.store;
    if (!store) continue;
    (byStore[store] ||= []).push(c);
  }
  const jobs = [];
  for (const [store, list] of Object.entries(byStore)) {
    for (const c of list) jobs.push({ store, sha: c.sha });
  }
  const contents = new Map();
  await pooled(jobs, concurrency, async (job) => {
    contents.set(`${job.store}@${job.sha}`, await fileAt(repo, job.store, job.sha));
  });

  const changes = {};
  const touched = new Map(); // sha -> { added:[], changed:[], removed:[] }
  for (const [store, list] of Object.entries(byStore)) {
    for (let i = 0; i < list.length; i++) {
      const now = contents.get(`${store}@${list[i].sha}`) || [];
      // 最舊的那一個 commit 沒有「更舊的一份」可以比，就不猜它動了什麼——
      // 寧可少標，也不要把整個設定庫都標成「新的」。
      const older = i + 1 < list.length ? contents.get(`${store}@${list[i + 1].sha}`) : null;
      if (!older) continue;
      const olderById = new Map(older.map((r) => [r.id, r]));
      const nowById = new Map(now.map((r) => [r.id, r]));
      const entry = touched.get(list[i].sha) || { added: [], changed: [], removed: [] };
      for (const rec of now) {
        const before = olderById.get(rec.id);
        const kind = !before ? 'added' : (sameRecord(before, rec) ? null : 'changed');
        if (!kind) continue;
        entry[kind === 'added' ? 'added' : 'changed'].push({ id: rec.id, store, label: labelOf(store, rec) });
        // 新→舊掃，第一次遇到就是最近一次；後面再遇到是更早的改動，不要蓋掉。
        if (!changes[rec.id]) changes[rec.id] = { at: list[i].at, kind, message: list[i].message, sha: list[i].sha, store };
      }
      for (const rec of older) {
        if (!nowById.has(rec.id)) entry.removed.push({ id: rec.id, store, label: labelOf(store, rec) });
      }
      touched.set(list[i].sha, entry);
    }
  }

  const timeline = commits
    .slice(0, limit)
    .map((c) => ({ ...c, ...(touched.get(c.sha) || { added: [], changed: [], removed: [] }) }))
    .filter((c) => c.added.length || c.changed.length || c.removed.length);

  return {
    changes,
    commits: timeline,
    scanned: Math.min(commits.length, limit),
    oldest: commits.length ? commits[Math.min(commits.length, limit) - 1].at : null,
    truncated: commits.length > limit,
  };
}

function labelOf(store, rec) {
  if (store === 'relations') return rec.type || '關係';
  return rec.name || rec.title || rec.id;
}
