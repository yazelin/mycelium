import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ulid } from './ids.mjs';

const LOCK_WAIT_MS = 10000; // 等鎖最多約 10 秒
const LOCK_STALE_MS = 60000; // 鎖檔超過 60 秒視為當機殘留
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

  // 鎖檔內容 {pid, host, token}：釋放時憑 token 確認還是自己的鎖才刪。
  // 殘留判定：mtime 超過 60 秒，且（同主機時）持有者 pid 已不存在。
  // 判定為殘留時回傳當時看到的 {token, mtimeMs}，供移除時確認沒被換掉；否則回傳 null。
  staleObservation() {
    let st;
    try { st = fs.statSync(this.lockPath); } catch { return null; } // 鎖剛被釋放
    if (Date.now() - st.mtimeMs <= LOCK_STALE_MS) return null;
    let info = null;
    try { info = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); } catch { /* 舊格式或半寫入：只看 mtime */ }
    if (info && info.host === os.hostname() && Number.isInteger(info.pid)) {
      try {
        process.kill(info.pid, 0);
        return null; // 持有者還活著，只是很久沒更新
      } catch (e) {
        if (e.code === 'EPERM') return null;
      }
    }
    return { token: info?.token ?? null, mtimeMs: st.mtimeMs };
  }

  // 把判定為殘留的鎖移走。rename 之後再核對一次：搬走的若不是剛才判定的那把（被別人換成新鎖），
  // 就用 link 放回去（已有人重建鎖則 link 失敗，保持現狀），不刪。
  removeStale(seen, token) {
    const trash = `${this.lockPath}.stale-${token}`;
    try {
      fs.renameSync(this.lockPath, trash);
    } catch (e) {
      if (e.code === 'ENOENT') return; // 別人已處理
      console.warn(`無法移除殘留的鎖檔（${e.code}）：${this.lockPath}`);
      return;
    }
    let same = false;
    try {
      const info = JSON.parse(fs.readFileSync(trash, 'utf8'));
      same = info.token === seen.token;
    } catch {
      same = seen.token === null && fs.statSync(trash).mtimeMs === seen.mtimeMs;
    }
    if (same) {
      fs.rmSync(trash, { force: true });
      console.warn(`移除殘留的鎖檔：${this.lockPath}`);
      return;
    }
    try { fs.linkSync(trash, this.lockPath); } catch { /* 已有人重建鎖：不動它 */ }
    fs.rmSync(trash, { force: true });
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
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), token }));
        fs.closeSync(fd);
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const seen = this.staleObservation();
        if (seen) {
          this.onStaleJudged?.(); // 測試用：在判定與移除之間插入動作
          this.removeStale(seen, token);
        }
        if (Date.now() > deadline) throw new Error(`等不到操作檔的鎖（${this.lockPath}），可能有別的程序卡住`);
        pause(20 + Math.floor(Math.random() * 30));
      }
    }
    this.lockDepth = 1;
    this.lockToken = token;
    try {
      return fn();
    } finally {
      this.lockDepth = 0;
      let mine = false;
      try { mine = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')).token === token; } catch { /* 讀不到就當不是自己的 */ }
      if (mine) fs.rmSync(this.lockPath, { force: true });
      else console.warn(`鎖檔已不是自己的，不刪除：${this.lockPath}`);
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
