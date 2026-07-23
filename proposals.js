'use strict';
// Reads agent-written proposals from the work's bound GitHub repo
// (`proposals/<timestamp>.json`, see skills/mycelium/SKILL.md's 「產出的格式
// 契約」) and applies only the items the owner ticks, using the exact same
// candidate-review UI and two-pass apply logic as the in-app AI extraction
// flow (extract.js) — no second copy of that logic exists here.
import { ghFetch, projectRepo, b64DecodeUtf8 } from './github-sync.js';
import { isPlainRecord } from './backup.js';

const PROPOSALS_DIR = 'proposals';
const APPLIED_DIR = `${PROPOSALS_DIR}/applied`;

// A proposal file is valid when entities/relations/foreshadow are each
// arrays of plain records — the same per-record shape backup.js's importer
// (and the skill, via candidates.mjs) already enforce. Reusing isPlainRecord
// here instead of re-deriving the rule keeps this app-side check identical to
// the ones the skill runs before ever writing the file.
export function isValidProposal(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  for (const key of ['entities', 'relations', 'foreshadow']) {
    if (!Array.isArray(data[key])) return false;
    if (!data[key].every(isPlainRecord)) return false;
  }
  return true;
}

function contentsUrl(repo, path) {
  return `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`;
}

/**
 * Lists proposal files under proposals/ in the bound repo, newest first
 * (timestamp filenames sort lexicographically = chronologically), each with
 * its parsed metadata for display.
 *
 * `exists: false` means the proposals/ directory itself doesn't exist yet —
 * distinct from `exists: true, items: []` (directory exists, e.g. only an
 * applied/ subfolder, but nothing to apply). Neither case is an error: both
 * must read as "no proposals" and must never be treated as "apply nothing",
 * mirroring the 404-vs-empty distinction importFromGithub already draws
 * (issue #4).
 */
export async function listProposals(projectId) {
  const repo = await projectRepo(projectId);
  const res = await ghFetch(contentsUrl(repo, PROPOSALS_DIR));
  if (res.status === 404) return { exists: false, items: [] };
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(`讀取提案清單失敗（HTTP ${res.status}）。` + (d.message ? `（GitHub 訊息：${d.message}）` : ''));
  }
  const list = await res.json();
  if (!Array.isArray(list)) {
    // Contents API returns an object (not an array) when the path resolves
    // to a file rather than a directory — proposals/ has been replaced by
    // something unexpected. Treat it as "found nothing to list", not a crash.
    return { exists: true, items: [] };
  }
  const files = list.filter((f) => f.type === 'file' && f.name.endsWith('.json'));
  files.sort((a, b) => b.name.localeCompare(a.name));

  const items = [];
  for (const f of files) {
    const item = { name: f.name, path: f.path };
    try {
      const fileRes = await ghFetch(contentsUrl(repo, f.path));
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
      const fileJson = await fileRes.json();
      const data = JSON.parse(b64DecodeUtf8(fileJson.content));
      item.data = data;
      item.valid = isValidProposal(data);
    } catch (e) {
      item.error = e.message;
      item.valid = false;
    }
    items.push(item);
  }
  return { exists: true, items };
}

/**
 * Fetches and validates a single proposal file, right before it's used —
 * listing already shows a validity hint, but this re-checks at the point of
 * selection so a file that changed (or was never valid) can't slip through.
 * Throws a Traditional-Chinese error and leaves the caller free to change
 * nothing on failure.
 */
export async function fetchProposal(projectId, path) {
  const repo = await projectRepo(projectId);
  const res = await ghFetch(contentsUrl(repo, path));
  if (res.status === 404) throw new Error('這份提案檔已經不存在，可能已經被套用或刪除了，請重新整理提案清單。');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(`讀取提案失敗（HTTP ${res.status}）。` + (d.message ? `（GitHub 訊息：${d.message}）` : ''));
  }
  const fileJson = await res.json();
  let data;
  try {
    data = JSON.parse(b64DecodeUtf8(fileJson.content));
  } catch (e) {
    throw new Error('這份提案檔不是合法的 JSON，未變更任何資料。');
  }
  if (!isValidProposal(data)) {
    throw new Error('這份提案檔格式不正確（entities / relations / foreshadow 必須都是陣列，且每筆都要是物件），未變更任何資料。');
  }
  return { data, sha: fileJson.sha, rawContent: fileJson.content };
}

/**
 * Marks a proposal as handled after it's been applied: copies the exact
 * bytes already fetched from GitHub to proposals/applied/<name>, then
 * deletes the original — mirroring the Contents API GET-sha/PUT pattern
 * github-sync.js already uses for data/*.json. Copy-then-delete (not the
 * other order) so a failure partway leaves the source file in place rather
 * than losing it.
 */
export async function markProposalApplied(projectId, path, rawContent) {
  const repo = await projectRepo(projectId);
  const name = path.split('/').pop();
  const appliedPath = `${APPLIED_DIR}/${name}`;

  const putRes = await ghFetch(contentsUrl(repo, appliedPath), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `mark proposal applied: ${name}`, content: rawContent }),
  });
  if (!putRes.ok) {
    const d = await putRes.json().catch(() => ({}));
    throw new Error(
      `候選項目已經套用進設定庫，但搬移到 proposals/applied/ 失敗（HTTP ${putRes.status}），原提案檔仍留在 proposals/，請手動處理避免下次重複套用。` +
      (d.message ? `（GitHub 訊息：${d.message}）` : '')
    );
  }

  // Need the current sha of the *source* file to delete it — the one from
  // fetchProposal() could be stale if something else touched the repo since.
  const getRes = await ghFetch(contentsUrl(repo, path));
  if (!getRes.ok) {
    throw new Error(
      `候選項目已經套用，也已複製到 proposals/applied/，但確認原檔案時失敗（HTTP ${getRes.status}），請手動刪除 ${path} 避免下次重複套用。`
    );
  }
  const sha = (await getRes.json()).sha;
  const delRes = await ghFetch(contentsUrl(repo, path), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `mark proposal applied: ${name}`, sha }),
  });
  if (!delRes.ok) {
    const d = await delRes.json().catch(() => ({}));
    throw new Error(
      `候選項目已經套用，也已複製到 proposals/applied/，但刪除原檔案失敗（HTTP ${delRes.status}），請手動刪除 ${path} 避免下次重複套用。` +
      (d.message ? `（GitHub 訊息：${d.message}）` : '')
    );
  }
}
