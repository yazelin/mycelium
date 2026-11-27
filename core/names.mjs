// 名字比對用的鍵：NFKC 正規化、去掉所有空白、轉小寫。
export function nameKey(name) {
  if (name == null) return '';
  return String(name).normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}
