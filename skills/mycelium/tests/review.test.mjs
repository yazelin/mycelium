'use strict';
// 審閱頁的規則測試。純 node，不需要瀏覽器。
//
// 這裡用示範用的角色（林小雨 / 白衣客 / 城主…），不是任何真實作品的設定——
// 這個 repo 是公開的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitLayers, surfaceOnly } from '../scripts/layers.mjs';
import { buildReviewModel, debutVolume, filterData } from '../scripts/review.mjs';
import { buildReviewHtml } from '../scripts/review-page.mjs';
import { gitTreeWithRemote } from '../scripts/graph.mjs';
import { editEntity } from '../scripts/edits.mjs';

// 底層裡的這兩句只要出現在製作／公開模式的檔案裡，這個功能就等於沒有做。
const 底層機密 = '城主其實就是黑袍人，第三卷會揭穿';
const 伏筆機密 = '林小雨是城主早年的徒弟';

function demoData() {
  return {
    entities: [
      {
        id: 'e1', name: '林小雨', type: '人物', aliases: [], tags: ['主角'],
        notes: '════ 【表層｜寫的時候看這裡】 ════\n十七歲，總是背著一把太長的傘。\n'
          + '════ 【底層｜寫的時候朝這裡】 ════\n' + 底層機密,
        customFields: [{ key: '暗號', value: '雨停了' }],
      },
      {
        id: 'e2', name: '白衣客', type: '人物', aliases: ['落雨劍客'],
        notes: '════ 【表層】 ════\n雨夜裡替她擋刀的陌生人。',
      },
      // 沒有分層標記的舊資料：非作者模式一個字都不顯示（白名單，錯要錯在安全那邊）
      { id: 'e3', name: '城主', type: '勢力', aliases: ['黑袍人'], notes: 底層機密 },
      // 沒有任何關係的概念：關係圖上看不到，但審閱頁一定要看得到
      { id: 'e4', name: '東境城', type: '地點', aliases: [], notes: '' },
    ],
    relations: [
      { id: 'r1', sourceId: 'e2', targetId: 'e1', type: '護衛', notes: '雨夜擋刀，' + 底層機密 },
      { id: 'r2', sourceId: 'e3', targetId: 'e1', type: '追殺', notes: '' },
    ],
    chapters: [
      { id: 'c1', volume: 1, order: 0, title: '雨夜', status: '完稿', wordCount: 3200, summary: '林小雨初遇白衣客。', content: '' },
      { id: 'c2', volume: 2, order: 1, title: '追兵', status: '未寫', wordCount: 0, summary: '城主現身。', content: '' },
    ],
    foreshadow: [
      { id: 'f1', title: '林小雨的真實身份', status: '埋設中', plantChapterId: 'c1', recoverChapterId: 'c2', relatedEntityIds: ['e1'], relatedRelationIds: [], notes: 伏筆機密 },
    ],
    chatlogs: [],
  };
}

const opts = { title: 'demo', generatedAt: '2026-07-23', repoSlug: 'demo/demo' };

// ── 分層 ────────────────────────────────────────────────────────

test('════【表層】════ 與【表層描述】兩種寫法都認得', () => {
  const a = splitLayers('════ 【表層｜寫的時候看這裡】 ════\n看得到的\n════ 【底層】 ════\n看不到的');
  assert.deepEqual(a.map((s) => [s.title, s.kind, s.body]), [
    ['表層｜寫的時候看這裡', 'surface', '看得到的'],
    ['底層', 'deep', '看不到的'],
  ]);
  // 伏筆的備註是「標題後面直接接內文」那一種寫法
  const b = splitLayers('【表層描述——只能這樣寫】她撞上門。\n【底層】渲染降級。');
  assert.deepEqual(b.map((s) => [s.kind, s.body]), [['surface', '她撞上門。'], ['deep', '渲染降級。']]);
});

test('沒有標記的文字整段當底層——白名單，不是黑名單', () => {
  const r = surfaceOnly('這一段沒有任何標記。');
  assert.equal(r.text, '');
  assert.equal(r.kept, 0);
  assert.equal(r.hidden, 1);
});

// ── 全部可瀏覽 ──────────────────────────────────────────────────

test('每一種類型都在，包括一條關係都沒有的那些', () => {
  const model = buildReviewModel(demoData(), { mode: 'author', ...opts });
  assert.deepEqual(model.entities.map((e) => e.name), ['林小雨', '白衣客', '城主', '東境城']);
  const lonely = model.entities.find((e) => e.name === '東境城');
  assert.equal(lonely.relations.length, 0, '沒有關係的角色也要在清單裡');
  assert.equal(model.chapters.length, 2);
  assert.equal(model.foreshadow.length, 1);
  assert.equal(model.relations.length, 2);
  // 關係圖是其中一個檢視，不是全部：孤點在圖的模型裡也有
  assert.ok(model.graph.nodes.some((n) => n.name === '東境城'));
});

test('伏筆帶著埋設／回收章與逾期判斷', () => {
  const model = buildReviewModel(demoData(), { mode: 'author', ...opts });
  const f = model.foreshadow[0];
  assert.equal(f.plant.title, '雨夜');
  assert.equal(f.recover.title, '追兵');
  assert.deepEqual(f.entities, ['林小雨']);
  assert.equal(f.overdue, false);
});

// ── 改動標記 ────────────────────────────────────────────────────

test('改過的那一筆會被標出來，沒改的不會', () => {
  const history = {
    changes: { e1: { at: '2026-07-23T10:00:00Z', kind: 'changed', message: 'agent edit entity 20260723-100000 (entities)' } },
    commits: [], scanned: 3, oldest: null, truncated: false,
  };
  const model = buildReviewModel(demoData(), { mode: 'author', history, ...opts });
  const by = Object.fromEntries(model.entities.map((e) => [e.name, e]));
  assert.equal(by['林小雨'].change.kind, 'changed');
  assert.equal(by['林小雨'].change.at, '2026-07-23T10:00:00Z');
  assert.equal(by['白衣客'].change, null);
});

test('改動資訊只給作者模式——commit 訊息不是給外人看的', () => {
  const history = { changes: { e1: { at: 'x', kind: 'changed', message: 'agent edit entity' } }, commits: [], scanned: 1, oldest: null, truncated: false };
  for (const mode of ['production', 'public']) {
    const model = buildReviewModel(demoData(), { mode, volume: 9, history, ...opts });
    assert.equal(model.history, null);
    assert.ok(model.entities.every((e) => e.change === null));
  }
});

// ── 三種模式：底層不可以進到檔案裡 ──────────────────────────────

for (const mode of ['production', 'public']) {
  test(`${mode} 模式產出的整份 HTML 裡搜不到底層內容`, () => {
    const model = buildReviewModel(demoData(), { mode, volume: 9, ...opts });
    const html = buildReviewHtml({ model, siblings: {} });
    // 這一條是整個功能的重點：不是 CSS 藏起來，是根本沒有寫進去。
    assert.ok(!html.includes(底層機密), '底層內容出現在檔案裡');
    assert.ok(!html.includes(伏筆機密), '伏筆內容出現在檔案裡');
    assert.ok(!html.includes('雨停了'), '自訂欄位（常常是底層）出現在檔案裡');
    // 表層照樣要看得到，否則就只是把東西全砍掉而已
    assert.ok(html.includes('總是背著一把太長的傘'), '表層應該還在');
  });
}

test('製作模式：伏筆整個 store 不進檔案，底層段落數會被誠實講出來', () => {
  const model = buildReviewModel(demoData(), { mode: 'production', ...opts });
  assert.equal(model.foreshadow.length, 0);
  assert.equal(model.dropped.foreshadow, 1);
  const 城主 = model.entities.find((e) => e.name === '城主');
  assert.equal(城主.sections.length, 0, '沒有標表層的設定一個字都不給');
  assert.equal(城主.hiddenSections, 1);
  assert.ok(model.relations.every((r) => r.notes === ''), '關係備註幾乎都是劇情');
});

test('公開模式：依卷數解鎖，還沒登場的角色與還沒出版的卷都不在', () => {
  const data = demoData();
  // 城主沒有標表層，所以就算解鎖到第二卷也只會剩一格空白——那不該放上公開頁
  data.entities[2].notes = '════ 【表層】 ════\n黑袍下看不見臉的人。';
  assert.equal(debutVolume(data.entities[0], data.chapters), 1);
  assert.equal(debutVolume(data.entities[2], data.chapters), 2, '城主第二卷才登場');
  const v1 = buildReviewModel(data, { mode: 'public', volume: 1, ...opts });
  assert.deepEqual(v1.entities.map((e) => e.name), ['林小雨', '白衣客']);
  assert.deepEqual(v1.chapters.map((c) => c.title), ['雨夜']);
  assert.ok(v1.entities.every((e) => e.aliases.length === 0), '別名本身常常就是反轉');
  const v2 = buildReviewModel(data, { mode: 'public', volume: 2, ...opts });
  assert.ok(v2.entities.some((e) => e.name === '城主'));
});

test('公開模式的解鎖只認本名——別名是「靈異」這種普通詞時會整篇誤中', () => {
  const data = demoData();
  data.entities.push({
    id: 'e5', name: '民俗恐怖對照', type: '寫作守則', aliases: ['靈異'],
    notes: '════ 【表層】 ════\n對照表。',
  });
  data.chapters[0].summary = '雨夜裡的靈異傳聞。';
  assert.equal(debutVolume(data.entities[4], data.chapters), 1, '含別名時會誤判成已登場');
  assert.equal(debutVolume(data.entities[4], data.chapters, { includeAliases: false }), null);
  const model = buildReviewModel(data, { mode: 'public', volume: 5, ...opts });
  assert.ok(!model.entities.some((e) => e.name === '民俗恐怖對照'));
});

test('公開模式不放沒有整理過表層的條目——那對讀者只是一格空白', () => {
  const data = demoData();
  const model = buildReviewModel(data, { mode: 'public', volume: 5, ...opts });
  assert.ok(!model.entities.some((e) => e.name === '東境城'), '沒有內容的條目不放');
  assert.ok(!model.entities.some((e) => e.name === '城主'), '沒有標表層的條目不放');
});

test('公開模式的關係只留兩端都解鎖的那些', () => {
  const filtered = filterData(demoData(), { mode: 'public', volume: 1 });
  assert.deepEqual(filtered.relations.map((r) => r.id), ['r1']);
});

test('產出的 HTML 自帶 cytoscape 與資料，不引任何外部網址', () => {
  const html = buildReviewHtml({ model: buildReviewModel(demoData(), { mode: 'author', ...opts }), siblings: {} });
  assert.ok(html.includes('cytoscape'));
  assert.ok(!/(src|href)="https?:/.test(html), '不可以有任何外部資源');
});

test('資料裡的 </script> 不會提早關掉腳本區塊', () => {
  const data = demoData();
  data.entities[0].notes = '════ 【表層】 ════\n他說 </script><script>alert(1)</script>';
  const html = buildReviewHtml({ model: buildReviewModel(data, { mode: 'author', ...opts }), siblings: {} });
  assert.ok(!html.includes('</script><script>alert(1)'));
});

// ── 寫入保護 ────────────────────────────────────────────────────

test('有 remote 的 git 工作目錄會被認出來（review / graph 共用這道擋）', () => {
  const root = mkdtempSync(join(tmpdir(), 'mycelium-guard-'));
  const repo = join(root, 'repo');
  const deep = join(repo, 'a', 'b');
  mkdirSync(deep, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
  assert.equal(gitTreeWithRemote(deep), null, '沒有 remote 的話不擋');
  git('remote', 'add', 'origin', 'https://example.com/x.git');
  assert.equal(gitTreeWithRemote(deep), repo, '有 remote 就要擋，而且要講出是哪一個 repo');
  const plain = mkdtempSync(join(tmpdir(), 'mycelium-plain-'));
  assert.equal(gitTreeWithRemote(plain), null);
});

test('本 repo 的 .gitignore 擋得住 review 產出的檔名', () => {
  const name = 'demo.production.review.html';
  const out = execFileSync('git', ['check-ignore', '-v', name], { encoding: 'utf8' });
  assert.match(out, /\*\.review\.html/);
});

// ── 製作層欄位 ──────────────────────────────────────────────────

test('同一個角色可以有很多個視覺版本，欄位先立好可以留空', () => {
  const data = demoData();
  const one = editEntity(data, '林小雨', { visual: '第一卷' });
  const 林 = one.data.entities.find((e) => e.name === '林小雨');
  assert.deepEqual(Object.keys(林.visuals[0]), ['version', 'appearance', 'outfit', 'palette', 'features', 'prompt', 'notes']);
  assert.equal(林.visuals[0].appearance, '', '先加欄位、先留空');

  const two = editEntity(one.data, '林小雨', { visual: '第二卷・失憶後', appearance: '眼神沒有焦點', prompt: 'girl, empty eyes' });
  const 林2 = two.data.entities.find((e) => e.name === '林小雨');
  assert.deepEqual(林2.visuals.map((v) => v.version), ['第一卷', '第二卷・失憶後']);
  assert.equal(林2.visuals[1].appearance, '眼神沒有焦點');
  assert.equal(林2.visuals[0].appearance, '', '改一版不會動到另一版');

  const three = editEntity(two.data, '林小雨', { rmVisual: '第一卷' });
  assert.deepEqual(three.data.entities.find((e) => e.name === '林小雨').visuals.map((v) => v.version), ['第二卷・失憶後']);
});

test('沒講改哪一版就不給改——預設只有一版正是要避免的事', () => {
  assert.throws(() => editEntity(demoData(), '林小雨', { appearance: '黑髮' }), /哪一版/);
});

test('視覺設定會進到製作模式的頁面，公開模式不給', () => {
  const data = demoData();
  const { data: next } = editEntity(data, '林小雨', { visual: '第一卷', prompt: 'a girl with an oversized umbrella' });
  const prod = buildReviewHtml({ model: buildReviewModel(next, { mode: 'production', ...opts }), siblings: {} });
  assert.ok(prod.includes('a girl with an oversized umbrella'));
  const pub = buildReviewHtml({ model: buildReviewModel(next, { mode: 'public', volume: 1, ...opts }), siblings: {} });
  assert.ok(!pub.includes('a girl with an oversized umbrella'), '生圖提示詞是製作用的，不對外');
});
