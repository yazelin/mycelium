import { randomBytes } from 'node:crypto';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = -1;
let lastRand = null; // 16 個 base32 位數的陣列

// ULID：10 位時間＋16 位亂數；同一毫秒內遞增，確保字串順序。
export function ulid() {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    for (let i = 15; i >= 0; i--) {
      if (lastRand[i] < 31) { lastRand[i]++; break; }
      lastRand[i] = 0;
    }
  } else {
    lastMs = ms;
    lastRand = Array.from(randomBytes(16), (b) => b & 31);
    lastRand[0] &= 15; // 留進位空間
  }
  let t = '';
  let n = ms;
  for (let i = 0; i < 10; i++) { t = B32[n % 32] + t; n = Math.floor(n / 32); }
  return t + lastRand.map((d) => B32[d]).join('');
}

const MAX_AHEAD_MS = 86400000;

// 混合邏輯時鐘：字串 "<13 位毫秒>-<4 位計數>-<裝置id>"，字串比較即時間順序。
export class Hlc {
  constructor(device) {
    this.device = device;
    this.ms = 0;
    this.counter = 0;
  }
  now() {
    const wall = Date.now();
    if (wall > this.ms) { this.ms = wall; this.counter = 0; } else { this.counter++; }
    return this.#fmt();
  }
  observe(remote) {
    const [msStr, cStr] = String(remote).split('-');
    const rms = Number(msStr);
    const rc = Number(cStr);
    if (!Number.isFinite(rms) || !Number.isFinite(rc)) throw new Error(`時戳格式錯誤：${remote}`);
    // 別台時鐘快太多（超過現在＋1 天）時只推進到現在＋1 天，不讓一台壞時鐘把之後所有寫入都拖到未來。
    // 那筆操作照樣套用、照它自己的 hlc 排序；這裡只限制本機時鐘。
    const cap = Date.now() + MAX_AHEAD_MS;
    if (rms > cap) {
      console.warn(`遠端時戳超過現在一天以上，時鐘只推進到現在＋1 天：${remote}`);
      if (cap > this.ms) { this.ms = cap; this.counter = 0; }
      return;
    }
    if (rms > this.ms || (rms === this.ms && rc > this.counter)) {
      this.ms = rms;
      this.counter = rc;
    }
  }
  #fmt() {
    return `${String(this.ms).padStart(13, '0')}-${String(this.counter).padStart(4, '0')}-${this.device}`;
  }
}
