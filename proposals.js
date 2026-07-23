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
    items.push(await fetchListItem(repo, f));
  }
  return { exists: true, items };
}

// Fetches and classifies one listed proposal file's content. Kept separate
// from listProposals' loop so the two failure kinds this issue is about stay
// textually distinct instead of sharing a try/catch:
//   - 'gone'/'auth'/'fetch': the file itself couldn't be read (404 because it
//     was moved to proposals/applied/ by an apply that already succeeded,
//     401 because the PAT is bad/expired, or any other transport failure) —
//     none of these say anything about the file's *content*, so they must
//     never render as 「格式不正確」.
//   - 'invalid': the file WAS read, but its JSON/shape is actually broken.
// item.valid stays false for both, since neither is applicable — only
// item.errorKind tells the UI which message family to show.
async function fetchListItem(repo, f) {
  const item = { name: f.name, path: f.path };
  let fileRes;
  try {
    fileRes = await ghFetch(contentsUrl(repo, f.path));
  } catch (e) {
    item.valid = false;
    item.errorKind = 'fetch';
    item.error = `讀取失敗：${e.message}`;
    return item;
  }
  if (fileRes.status === 404) {
    item.valid = false;
    item.errorKind = 'gone';
    item.error = '這份提案檔已經不存在，可能已經套用或被移除了，請重新整理提案清單。';
    return item;
  }
  if (fileRes.status === 401) {
    item.valid = false;
    item.errorKind = 'auth';
    item.error = '認證失敗（HTTP 401），請確認 GitHub Personal Access Token 是否正確或已過期。';
    return item;
  }
  if (!fileRes.ok) {
    const d = await fileRes.json().catch(() => ({}));
    item.valid = false;
    item.errorKind = 'fetch';
    item.error = `讀取失敗（HTTP ${fileRes.status}）。` + (d.message ? `（GitHub 訊息：${d.message}）` : '');
    return item;
  }
  try {
    const fileJson = await fileRes.json();
    const data = JSON.parse(b64DecodeUtf8(fileJson.content));
    item.data = data;
    item.valid = isValidProposal(data);
    if (!item.valid) {
      item.errorKind = 'invalid';
      item.error = 'entities / relations / foreshadow 必須都是陣列，且每筆都要是物件。';
    }
  } catch (e) {
    item.valid = false;
    item.errorKind = 'invalid';
    item.error = '這份提案檔不是合法的 JSON。';
  }
  return item;
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
