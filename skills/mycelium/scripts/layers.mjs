'use strict';
// 表層／底層的分層規則——這是整個 review 的劇透邊界，也是唯一一道。
//
// 作品的設定文字本來就寫成兩段：
//
//   ════ 【表層｜寫的時候看這裡】 ════
//   他看起來怎樣、怎麼講話、做了什麼
//   ════ 【底層｜寫的時候朝這裡】 ════
//   這一切其實是什麼機制、什麼時候會反轉
//
// 那個格式當初是為了寫作紀律（寫的時候只寫表層），但它剛好就是劇透線。
//
// 規則只有一條，而且是**白名單**：只有標題含「表層」的段落會被留下來，
// 其餘一律當成底層。沒有標記的整段文字＝沒有分層＝全部當底層。
//
// 為什麼是白名單而不是黑名單：黑名單漏掉一種寫法，反轉就流出去了；白名單漏掉
// 一種寫法，只是少顯示一段設定。錯的方向要選不會傷人的那一邊。

/** 標題行：可能被 ════ 夾著，也可能後面直接接內文（伏筆的備註就是這樣寫的）。 */
const HEADING = /^[ \t]*[═＝=]*[ \t]*【([^】]{1,40})】[ \t]*[═＝=]*[ \t]*(.*)$/;

/** 標題含這兩個字的段落＝可以給外人看的那一層。 */
const SURFACE = /表層/;

/**
 * 把一段設定文字切成段落。回傳 [{ title, kind, body }]：
 *   - title 為 null 代表「第一個標題之前的文字」（沒有分層的舊資料就只有這一段）
 *   - kind 是 'surface'（表層）或 'deep'（其餘一切）
 */
export function splitLayers(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];
  const sections = [];
  let current = { title: null, kind: 'deep', lines: [] };
  for (const line of raw.split('\n')) {
    const m = line.match(HEADING);
    if (m) {
      if (current.lines.length || current.title !== null) sections.push(current);
      const title = m[1].trim();
      current = { title, kind: SURFACE.test(title) ? 'surface' : 'deep', lines: [] };
      if (m[2].trim()) current.lines.push(m[2]);
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length || current.title !== null) sections.push(current);
  return sections
    .map((s) => ({ title: s.title, kind: s.kind, body: s.lines.join('\n').trim() }))
    .filter((s) => s.body || s.title);
}

/**
 * 非作者模式看到的版本：只留表層段落。
 * 回傳 { text, kept, hidden }——hidden 是被拿掉幾段，頁面要老實告訴讀的人
 * 「這裡本來還有東西，是在產生檔案的時候就被拿掉的」，而不是假裝沒有。
 */
export function surfaceOnly(text) {
  const sections = splitLayers(text);
  const kept = sections.filter((s) => s.kind === 'surface');
  return {
    text: kept.map((s) => s.body).join('\n\n').trim(),
    kept: kept.length,
    hidden: sections.length - kept.length,
  };
}

/** 這段文字有沒有標出表層。沒有的話，非作者模式就一個字都不會顯示。 */
export function hasSurface(text) {
  return splitLayers(text).some((s) => s.kind === 'surface');
}
