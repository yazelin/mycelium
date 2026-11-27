// 跨裝置同步：各裝置只 append 自己的 jsonl，經 git 遠端交換；拉回後把新操作重播進 SQLite。
import { execFileSync } from 'node:child_process';
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

export async function sync(store, { remote = 'origin', branch = 'main', requirePrivate = false,
  checkPrivate = defaultCheckPrivate } = {}) {
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
  // 提交、拉回、補套在跨程序鎖內做，避免和 MCP server 的寫入交錯；推送不佔鎖。
  const locked = store.locked ?? ((fn) => fn());
  const { applied, rebuilt } = locked(() => pullAndApply(store, dir, remote, branch));
  git(dir, ['push', '-q', remote, `HEAD:${branch}`]);
  return { pulled: applied, pushed: true, rebuilt };
}

function pullAndApply(store, dir, remote, branch) {
  const id = store.oplog.identity?.length ? store.oplog.identity : gitIdentityArgs(dir); // 合併 commit 也要身分
  // 自己尚未提交的操作檔先提交，pull 才不會被未提交變更擋住
  git(dir, ['add', '--', ...store.oplog.files()]);
  if (git(dir, ['status', '--porcelain', '--', '*.jsonl']).trim()) {
    git(dir, [...id, 'commit', '-q', '-m', 'sync：提交本機操作']);
  }
  // 只有第一次同步（從沒抓過遠端分支）才允許無共同歷史的合併
  let firstSync = false;
  try { git(dir, ['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${branch}`]); } catch { firstSync = true; }
  const pullArgs = [...id, 'pull', '--no-rebase', ...(firstSync ? ['--allow-unrelated-histories'] : []), '--no-edit', '-q', remote, branch];
  try {
    git(dir, pullArgs);
  } catch (e) {
    // 遠端還沒有這個分支（第一次同步）不算錯；其他失敗（含衝突）照丟，保留現場
    if (!/couldn't find remote ref/i.test(errText(e))) throw new Error(`git pull 失敗：${errText(e)}`);
  }
  return catchUp(store);
}
