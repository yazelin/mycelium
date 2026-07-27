'use strict';
// precheck 的規則測試。純 node，不需要瀏覽器、不連網。
//
// 這裡用示範用的角色（林小雨 / 白衣客 / 城主…），不是任何真實作品的設定——
// 這個 repo 是公開的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrecheck, classify, formatPrecheck, hitsOf, outline } from '../scripts/precheck.mjs';

const canon = `# 設定聖經

## 一、世界

雨城終年下雨。**這條已定案。**

## 二、林小雨

- 十七歲，總是背著一把太長的傘。
- **紅線：不准讓她主動求助。** 她開口求人就不是她了。
- 她的傘是誰給的：**待定**，寫的時候別替她答。

## 三、城主

- 表面是雨城之主。
- 第三卷才揭穿的事**先不要**在第一卷提。
`;

const outlineDoc = `# 卷一大綱

## 第七章：傘下的人

林小雨第一次把傘借給別人。

- **【要埋】** 借傘的對象後面要壞掉，所以這一章要讓讀者記得他。
- **【待定】** 那個人叫什麼名字還沒決定。

## 第八章：雨停了

城主現身。
`;

function demo() {
  return {
    chapters: [
      { id: 'c6', order: 6, title: '第六章：長街', status: '草稿', wordCount: 4000, summary: '林小雨走過長街。' },
      { id: 'c7', order: 7, title: '第七章：傘下的人', status: '未寫', wordCount: 0, summary: '林小雨第一次把傘借給別人。' },
      { id: 'c8', order: 8, title: '第八章：雨停了', status: '未寫', wordCount: 0, summary: '城主現身。' },
    ],
    entities: [
      { id: 'e1', name: '林小雨', type: '人物', aliases: [] },
      { id: 'e2', name: '城主', type: '人物', aliases: ['黑袍人'] },
      { id: 'e3', name: '落雨劍客', type: '人物', aliases: [] },
    ],
    foreshadow: [
      { id: 'f1', title: '傘是誰給的', status: '埋設中', plantChapterId: 'c7' },
      { id: 'f2', title: '城主的真面目', status: '埋設中', plantChapterId: 'c8' },
    ],
    docs: [{ name: 'canon.md', text: canon }, { name: '卷一大綱.md', text: outlineDoc }],
  };
}

function run(titlePart) {
  const d = demo();
  const chapter = d.chapters.find((c) => c.title.includes(titlePart));
  return buildPrecheck({
    chapter,
    entities: d.entities,
    relations: [],
    foreshadows: d.foreshadow,
    chapters: d.chapters,
    docs: d.docs,
  });
}

test('outline 把每一行掛回它所在的標題路徑', () => {
  const rows = outline(canon);
  const red = rows.find((r) => r.text.includes('不准讓她主動求助'));
  assert.equal(red.section, '設定聖經 › 二、林小雨');
  assert.ok(red.line > 1);
});

test('classify：未決／紅線／已定案三種標記各自認得', () => {
  assert.deepEqual(classify('她的傘是誰給的：**待定**'), ['open']);
  assert.deepEqual(classify('**紅線：不准讓她主動求助。**'), ['red']);
  assert.deepEqual(classify('雨城終年下雨。**這條已定案。**'), ['settled']);
});

test('同一行可以同時是紅線與未決，兩邊都算', () => {
  const kinds = classify('**待定**，而且**不准**在第一卷提');
  assert.ok(kinds.includes('open'));
  assert.ok(kinds.includes('red'));
});

test('hitsOf 只回傳真的出現在該行的關鍵詞', () => {
  assert.deepEqual(hitsOf('林小雨走過長街', ['林小雨', '城主']), ['林小雨']);
});

test('會出場的人是從章節內容比對出來的，沒出場的不列', () => {
  const pre = run('第七章');
  assert.deepEqual(pre.cast, ['林小雨']);
  assert.ok(!pre.cast.includes('落雨劍客'));
});

test('別名也算出場——身分反轉的角色不會被漏掉', () => {
  const d = demo();
  const chapter = { id: 'x', order: 9, title: '第九章：黑袍', status: '未寫', summary: '黑袍人站在橋上。' };
  const pre = buildPrecheck({ chapter, entities: d.entities, chapters: [chapter], docs: d.docs });
  assert.deepEqual(pre.cast, ['城主']);
});

test('未決只列跟這一章或這一章的人有關的，不整份洗出來', () => {
  const pre = run('第七章');
  const texts = pre.open.map((o) => o.text).join('\n');
  assert.ok(texts.includes('那個人叫什麼名字還沒決定'), '大綱裡第七章的待定要列');
  assert.ok(texts.includes('她的傘是誰給的'), '林小雨的待定要列');
  assert.ok(!texts.includes('第三卷才揭穿'), '城主那條跟第七章無關，不該列');
});

test('紅線同樣只列有關的', () => {
  const pre = run('第七章');
  const texts = pre.red.map((r) => r.text).join('\n');
  assert.ok(texts.includes('不准讓她主動求助'));
});

test('必讀壓成「檔案＋段落」，不會一行一行洗版', () => {
  const pre = run('第七章');
  const keys = pre.sections.map((s) => `${s.doc}|${s.section}`);
  assert.equal(new Set(keys).size, keys.length, '同一段不該重複出現');
  assert.ok(pre.sections.length <= pre.open.length + pre.red.length + 6);
});

test('會帶出前一章，讓 agent 知道接在哪裡', () => {
  const pre = run('第七章');
  assert.equal(pre.prev.title, '第六章：長街');
  assert.equal(pre.prev.status, '草稿');
});

test('第一章沒有前一章時不會爆', () => {
  const d = demo();
  const pre = buildPrecheck({ chapter: d.chapters[0], entities: d.entities, chapters: d.chapters, docs: d.docs });
  assert.equal(pre.prev, null);
});

test('掛在這一章的伏筆會被撈出來，別章的不會', () => {
  const pre = run('第七章');
  assert.deepEqual(pre.foreshadows.map((f) => f.name), ['傘是誰給的']);
});

test('沒有設定文件時不會爆，而且會講出「沒有提到」這件事', () => {
  const d = demo();
  const pre = buildPrecheck({ chapter: d.chapters[1], entities: d.entities, chapters: d.chapters, docs: [] });
  assert.deepEqual(pre.sections, []);
  assert.ok(formatPrecheck(pre).includes('這本身就值得先確認'));
});

test('輸出把三張清單跟擋門那句都印出來', () => {
  const out = formatPrecheck(run('第七章'));
  assert.ok(out.includes('必讀'));
  assert.ok(out.includes('未決'));
  assert.ok(out.includes('紅線'));
  assert.ok(out.includes('必讀的段落全部讀完之前不要動筆'));
  assert.ok(out.includes('未決的先問，不要自己決定'));
});
