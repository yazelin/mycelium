// 故事時間比較：date 軸用 ISO 字串，chapter 軸用章節清單的索引。
function idx(chapters, x) {
  const i = (chapters ?? []).indexOf(x);
  if (i < 0) throw new Error(`未知的章節：${x}`);
  return i;
}

export function cmpTime(space, a, b) {
  let x = a;
  let y = b;
  if (space.time_axis === 'chapter') {
    x = idx(space.chapters, a);
    y = idx(space.chapters, b);
  }
  return x < y ? -1 : x > y ? 1 : 0;
}

// at 為 null 表示「現在」：只看 valid_to 是否為空。失效點不含。
export function activeAt(space, fact, at) {
  if (at == null) return fact.valid_to == null || fact.valid_to === '';
  if (fact.valid_from != null && fact.valid_from !== '' && cmpTime(space, fact.valid_from, at) > 0) return false;
  if (fact.valid_to != null && fact.valid_to !== '' && cmpTime(space, at, fact.valid_to) >= 0) return false;
  return true;
}
