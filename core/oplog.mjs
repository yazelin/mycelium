import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { threadId } from 'node:worker_threads';
import { ulid } from './ids.mjs';

const LOCK_WAIT_MS = 10000; // 等鎖最多約 10 秒
const LOCK_STALE_MS = 60000; // 鎖檔超過 60 秒視為當機殘留
// 鎖檔的主機欄位：主機名＋pid namespace（Linux 容器重啟後主機名可能不變，但 pid 空間不同就不能用 pid 判斷存活）。
function lockHost() {
  try { return `${os.hostname()}#${fs.readlinkSync('/proc/self/ns/pid')}`; } catch { return os.hostname(); }
}
export const LOCK_HOST = lockHost();
// 本程序目前持有的鎖 token（放在全域，同一程序載入多份模組也共用）。
// 鎖檔的 pid／tid 是自己、token 卻不在這裡，就是上一次執行（同 pid 重啟）留下的殘留。
const HELD = (globalThis[Symbol.for('mycelium.heldLockTokens')] ??= new Set());
const isSelf = (info) => info.pid === process.pid && (info.tid ?? 0) === threadId;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const git = (dir, args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

// 沒有設定 git 身分（user.name／user.email）時，commit 改用這組預設身分，不讓記憶起不來。
const FALLBACK_IDENTITY = ['-c', 'user.name=mycelium', '-c', 'user.email=mycelium@localhost'];
export function gitIdentityArgs(dir) {
  try {
    git(dir, ['var', 'GIT_AUTHOR_IDENT']);
    git(dir, ['var', 'GIT_COMMITTER_IDENT']);
    return [];
  } catch {
    return FALLBACK_IDENTITY;
  }
}

// 讀寫 <dir>/.device.json；沒有就建立（裝置 id 取 ulid 尾 8 碼，名稱取主機名）。
export function loadDevice(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.device.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const info = { device: ulid().slice(-8), deviceName: os.hostname() };
  fs.writeFileSync(file, JSON.stringify(info) + '\n');
  return info;
}

// 每個裝置一個 append-only 的 jsonl，放在本機 git repo；讀回的順序是檔案順序，排序由呼叫端負責。
export class OpLog {
  constructor({ dir, device, deviceName, autoCommit = true }) {
    this.dir = dir;
    this.autoCommit = autoCommit;
    // 檔名只留安全字元，避免主機名帶特殊字元
    this.file = `${String(deviceName).replace(/[^\w.-]/g, '_')}-${device}.jsonl`;
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, '.git'))) git(dir, ['init', '-q']);
    this.identity = autoCommit ? gitIdentityArgs(dir) : [];
    // 關掉換行轉換，避免 Windows 的 autocrlf 改寫操作檔
    const attrs = path.join(dir, '.gitattributes');
    if (!fs.existsSync(attrs)) fs.writeFileSync(attrs, '* -text\n');
    const ignore = path.join(dir, '.gitignore');
    let cur = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
    for (const entry of ['.device.json', '.lock']) {
      if (!cur.split(/\r?\n/).includes(entry)) cur += (cur && !cur.endsWith('\n') ? '\n' : '') + `${entry}\n`;
    }
    if (!fs.existsSync(ignore) || fs.readFileSync(ignore, 'utf8') !== cur) fs.writeFileSync(ignore, cur);
    this.lockPath = path.join(dir, '.lock');
    this.lockDepth = 0;
    // 設定檔也要進 git，其他裝置 clone 後才有 `* -text`
    if (autoCommit) {
      const cfg = ['.gitattributes', '.gitignore'];
      git(dir, ['add', ...cfg]);
      if (git(dir, ['status', '--porcelain', '--', ...cfg]).length > 0) {
        git(dir, [...this.identity, 'commit', '-q', '-m', 'init ops 目錄', '--', ...cfg]);
      }
    }
  }

  // 鎖檔內容 {pid, tid, host, token}：釋放時憑 token 確認還是自己的鎖才刪。
  // 殘留判定：mtime 超過 60 秒，且同主機（主機名＋pid namespace 相同）時持有者 pid 已不存在，
  // 或 pid 是自己但 token 不是本程序持有（同 pid 重啟留下的）。跨主機只看 mtime。
  // 判定為殘留時回傳當時看到的 {token, mtimeMs}，供移除時確認沒被換掉；否則回傳 null。
  staleObservation() {
    let st;
    try { st = fs.statSync(this.lockPath); } catch { return null; } // 鎖剛被釋放
    if (Date.now() - st.mtimeMs <= LOCK_STALE_MS) return null;
    let info = null;
    try { info = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); } catch { /* 舊格式或半寫入：只看 mtime */ }
    if (info && info.host === LOCK_HOST && Number.isInteger(info.pid)) {
      if (isSelf(info)) {
        if (HELD.has(info.token)) return null; // 本程序另一個物件正持有
      } else if (info.pid !== process.pid) {
        try {
          process.kill(info.pid, 0);
          return null; // 持有者還活著，只是很久沒更新
        } catch (e) {
          if (e.code === 'EPERM') return null;
        }
      } else {
        return null; // 同程序的其他執行緒，無從得知是否持有：當作活著
      }
    }
    return { token: info?.token ?? null, mtimeMs: st.mtimeMs };
  }

  // 把判定為殘留的鎖移走。rename 之後再核對一次：搬走的若不是剛才判定的那把（被別人換成新鎖），
  // 就用 link 放回去（已有人重建鎖則 link 失敗，保持現狀），不刪。
  // 放回前若搬到的是本程序（同 pid、同執行緒）已不持有的鎖，就是孤兒，不放回。
  removeStale(seen, token) {
    const trash = `${this.lockPath}.stale-${token}`;
    try {
      fs.renameSync(this.lockPath, trash);
    } catch (e) {
      if (e.code === 'ENOENT') return; // 別人已處理
      // 同一把鎖只警告一次，不在等鎖迴圈裡洗版
      const key = `${seen.token}:${seen.mtimeMs}`;
      if (this.warnedStale !== key) {
        this.warnedStale = key;
        console.warn(`無法移除殘留的鎖檔（${e.code}）：${this.lockPath}`);
      }
      return;
    }
    let same = false;
    let orphan = false;
    try {
      const info = JSON.parse(fs.readFileSync(trash, 'utf8'));
      same = info.token === seen.token;
      orphan = info.host === LOCK_HOST && isSelf(info) && !HELD.has(info.token);
    } catch {
      try { same = seen.token === null && fs.statSync(trash).mtimeMs === seen.mtimeMs; } catch { return; } // 持有者已刪掉
    }
    if (same || orphan) {
      fs.rmSync(trash, { force: true });
      console.warn(`移除殘留的鎖檔：${this.lockPath}`);
      return;
    }
    this.onStaleMoved?.(); // 測試用：在搬走與放回之間插入動作
    try { fs.linkSync(trash, this.lockPath); } catch { /* 已有人重建鎖，或持有者已刪掉搬走的那份：不動它 */ }
    fs.rmSync(trash, { force: true });
  }

  // 釋放：刪掉內容是自己 token 的鎖檔，以及別人移除殘留時搬走、可能還沒放回的那份（.lock.stale-*）。
  // 搬走的人可能在我們檢查之間把鎖放回，所以重複檢查到兩邊都沒有自己的鎖為止（最多幾輪）。
  release(token) {
    const mineAt = (file) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')).token === token; } catch { return false; }
    };
    let found = false;
    for (let round = 0; round < 5; round++) {
      let hit = false;
      if (mineAt(this.lockPath)) { fs.rmSync(this.lockPath, { force: true }); hit = true; }
      let names = [];
      try { names = fs.readdirSync(this.dir); } catch { /* 目錄讀不到就略過 */ }
      for (const name of names) {
        if (!name.startsWith('.lock.stale-')) continue;
        const file = path.join(this.dir, name);
        if (mineAt(file)) { fs.rmSync(file, { force: true }); hit = true; }
      }
      if (!hit) break;
      found = true;
    }
    if (!found) console.warn(`鎖檔已不是自己的，不刪除：${this.lockPath}`);
  }

  // 更新鎖檔 mtime，讓長操作不被誤判為殘留（同步函式內跑不了 interval，由呼叫端在長操作前後手動呼叫）。
  touchLock() {
    if (this.lockDepth === 0) return;
    try {
      if (JSON.parse(fs.readFileSync(this.lockPath, 'utf8')).token !== this.lockToken) return;
      const now = new Date();
      fs.utimesSync(this.lockPath, now, now);
    } catch { /* 鎖檔不見了就算了，釋放時會警告 */ }
  }

  // 跨程序鎖：多個 MCP server 與命令列 sync 可能同時用同一個 ops 目錄。可重入（同一物件內巢狀呼叫不會卡住）。
  withLock(fn) {
    if (this.lockDepth > 0) {
      this.lockDepth++;
      try { return fn(); } finally { this.lockDepth--; }
    }
    const token = ulid();
    const deadline = Date.now() + (this.lockWaitMs ?? LOCK_WAIT_MS);
    HELD.add(token); // 先登記，鎖檔一出現就認得是自己的
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, tid: threadId, host: LOCK_HOST, token }));
        fs.closeSync(fd);
        break;
      } catch (e) {
        // Windows 上檔案正被刪除或掃毒程式開著時會回 EPERM／EACCES，視為暫時性、重試
        const transient = process.platform === 'win32' && (e.code === 'EPERM' || e.code === 'EACCES');
        if (e.code !== 'EEXIST' && !transient) { HELD.delete(token); throw e; }
        const seen = e.code === 'EEXIST' ? this.staleObservation() : null;
        if (seen) {
          this.onStaleJudged?.(); // 測試用：在判定與移除之間插入動作
          this.removeStale(seen, token);
        }
        if (Date.now() > deadline) {
          HELD.delete(token);
          throw new Error(`等不到操作檔的鎖（${this.lockPath}），可能有別的程序卡住`);
        }
        pause(20 + Math.floor(Math.random() * 30));
      }
    }
    this.lockDepth = 1;
    this.lockToken = token;
    try {
      return fn();
    } finally {
      this.lockDepth = 0;
      try { this.release(token); } finally { HELD.delete(token); }
    }
  }

  // 各操作檔目前的大小，用來判斷別的程序有沒有寫入。
  sizes() {
    const out = {};
    for (const name of this.files()) {
      try { out[name] = fs.statSync(path.join(this.dir, name)).size; } catch { /* 剛好被移走就略過 */ }
    }
    return out;
  }

  append(op) {
    const full = path.join(this.dir, this.file);
    // 當機可能留下沒換行的半行；該行從未生效，先截掉再寫，避免新紀錄接在殘片後面
    if (fs.existsSync(full)) {
      const buf = fs.readFileSync(full);
      if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) {
        const cut = buf.lastIndexOf(0x0a) + 1;
        let valid = true;
        try { JSON.parse(buf.subarray(cut).toString('utf8').replace(/\r$/, '')); } catch { valid = false; }
        if (valid) {
          fs.appendFileSync(full, '\n'); // 完整紀錄只缺換行：補上，不能刪
        } else {
          fs.truncateSync(full, cut);
          console.warn(`截掉不完整的最後一行：${this.file}`);
        }
      }
    }
    fs.appendFileSync(full, JSON.stringify(op) + '\n');
    if (this.autoCommit) {
      git(this.dir, ['add', this.file]);
      git(this.dir, [...this.identity, 'commit', '-q', '-m', `op ${op.type} ${op.id}`]);
    }
  }

  files() {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.jsonl'));
  }

  readAll() {
    const out = [];
    for (const name of this.files()) {
      const lines = fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
      let last = lines.length - 1;
      while (last >= 0 && lines[last].trim() === '') last--;
      lines.forEach((line, i) => {
        if (line.trim() === '') return;
        try {
          out.push(JSON.parse(line));
        } catch (e) {
          if (i === last) {
            console.warn(`略過不完整的最後一行：${name}`);
          } else {
            console.warn(`略過無法解析的操作：${name} 第 ${i + 1} 行`);
          }
        }
      });
    }
    return out;
  }
}
