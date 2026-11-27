// 跨裝置同步：各裝置只 append 自己的 jsonl，經 git 遠端交換；拉回後把新操作重播進 SQLite。
import { execFileSync } from 'node:child_process';
import { ulid } from './ids.mjs';
import { rebuildAll, catchUp } from './store.mjs';
import { gitIdentityArgs } from './oplog.mjs';

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
const errText = (e) => `${e.stderr ?? ''}${e.message ?? ''}`;

// 清空衍生資料表（vectors 除外），依 (hlc, dev, id) 重播全部操作。
export function rebuild(store) {
  const run = () => rebuildAll(store.db, store.oplog.readAll());
  return store.locked ? store.locked(run) : run();
}

// 預設的 private 檢查：只認得 GitHub 遠端網址（https、git@、ssh 形式，主機名錨定），用 gh 查 .private。
const GH_RE = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
export function defaultCheckPrivate(url) {
  const m = GH_RE.exec(url);
  if (!m) throw new Error('無法確認遠端是不是 private，拒絕推送');
  try {
    const out = execFileSync('gh', ['api', `repos/${m[1]}/${m[2]}`, '--jq', '.private'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() === 'true';
  } catch (e) {
    throw new Error(`無法確認遠端是不是 private，拒絕推送：${errText(e).trim()}`);
  }
}

export async function sync(store, { remote = 'origin', branch = 'main', requirePrivate = true,
  checkPrivate = defaultCheckPrivate, onFetched } = {}) {
  const dir = store.oplog.dir;
  try {
    git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    throw new Error('上次同步的合併還沒完成，請先處理');
  } catch (e) {
    if (e.message.startsWith('上次同步')) throw e;
  }
  if (requirePrivate) {
    const url = git(dir, ['remote', 'get-url', remote]).trim();
    if ((await checkPrivate(url)) !== true) throw new Error('遠端不是 private repo，拒絕推送');
  }
  // 網路抓取在鎖外做，不讓慢網路卡住 MCP 寫入；提交、合併、補套在鎖內；推送不佔鎖。
  // fetch 會順便建立遠端追蹤分支，所以「是不是第一次」要在 fetch 前判斷
  let firstSync = false;
  try { git(dir, ['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${branch}`]); } catch { firstSync = true; }
  const fetched = fetchRemote(dir, remote, branch); // 唯一 ref 名稱，抓不到分支時為 null
  if (onFetched) onFetched();
  const locked = store.locked ?? ((fn) => fn());
  let out;
  try {
    out = locked(() => pullAndApply(store, dir, remote, branch, fetched, firstSync));
  } finally {
    if (fetched) { try { git(dir, ['update-ref', '-d', fetched]); } catch { /* 清不掉不影響結果 */ } }
  }
  const { applied, rebuilt } = out;
  git(dir, ['push', '-q', remote, `HEAD:${branch}`]);
  return { pulled: applied, pushed: true, rebuilt };
}

// 鎖外抓遠端分支到唯一的暫存 ref，回傳 ref 名；遠端還沒有該分支（第一次同步）回傳 null，其他失敗照丟。
// 不用 FETCH_HEAD：它是共用檔，別的 git 操作可能覆寫。
function fetchRemote(dir, remote, branch) {
  const ref = `refs/mycelium/fetch-${ulid()}`;
  try {
    git(dir, ['fetch', '-q', remote, `+${branch}:${ref}`]);
    return ref;
  } catch (e) {
    if (/couldn't find remote ref/i.test(errText(e))) return null;
    throw new Error(`git pull 失敗（fetch）：${errText(e)}`);
  }
}

function pullAndApply(store, dir, remote, branch, fetched, firstSync) {
  const id = store.oplog.identity?.length ? store.oplog.identity : gitIdentityArgs(dir); // 合併 commit 也要身分
  store.oplog.touchLock?.();
  // 自己尚未提交的操作檔先提交，merge 才不會被未提交變更擋住
  git(dir, ['add', '--', ...store.oplog.files()]);
  if (git(dir, ['status', '--porcelain', '--', '*.jsonl']).trim()) {
    git(dir, [...id, 'commit', '-q', '-m', 'sync：提交本機操作']);
  }
  if (fetched) {
    // 只有第一次同步才允許無共同歷史的合併
    try {
      git(dir, [...id, 'merge', '--no-edit', '-q', ...(firstSync ? ['--allow-unrelated-histories'] : []), fetched]);
    } catch (e) {
      throw new Error(`git pull 失敗：${errText(e)}`);
    }
    store.oplog.touchLock?.();
  }
  const r = catchUp(store);
  store.oplog.touchLock?.();
  return r;
}
