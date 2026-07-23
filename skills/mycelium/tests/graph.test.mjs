'use strict';
// 關係圖匯出的規則測試。純 node，不需要瀏覽器。
//
// 這裡用示範用的角色（林小雨 / 白衣客 / 城主…），不是任何真實作品的設定——
// 這個 repo 是公開的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphHtml, buildGraphModel } from '../scripts/graph.mjs';

function demoData() {
  return {
    entities: [
      { id: 'e1', name: '林小雨', type: '人物', notes: '主角', aliases: [] },
      { id: 'e2', name: '白衣客', type: '人物', notes: '', aliases: ['落雨劍客'] },
      { id: 'e3', name: '城主', type: '勢力', notes: '', aliases: ['黑袍人'] },
      { id: 'e4', name: '東境城', type: '地點', notes: '', aliases: [] },
    ],
    relations: [
      { id: 'r1', sourceId: 'e2', targetId: 'e1', type: '護衛', notes: '雨夜擋刀' },
      { id: 'r2', sourceId: 'e3', targetId: 'e1', type: '追殺', notes: '' },
      // 端點已不存在：不可以進到圖裡，否則整張圖畫不出來
      { id: 'r3', sourceId: 'e1', targetId: 'e-gone', type: '不存在', notes: '' },
    ],
    chapters: [],
    foreshadow: [
      { id: 'f1', title: '林小雨的真實身份', status: '埋設中', relatedEntityIds: ['e1'] },
    ],
    chatlogs: [],
  };
}

test('端點不存在的關係不會進到圖裡', () => {
  const model = buildGraphModel(demoData());
  assert.equal(model.edges.length, 2);
  assert.ok(!model.edges.some((e) => e.id === 'r3'));
});

test('節點大小反映牽連多寡，孤點最小', () => {
  const model = buildGraphModel(demoData());
  const by = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.equal(by['林小雨'].degree, 2);
  assert.equal(by['東境城'].degree, 0);
  assert.ok(by['林小雨'].size > by['白衣客'].size);
  assert.ok(by['白衣客'].size > by['東境城'].size);
});

test('同類型共用顏色與形狀，不同類型不共用', () => {
  const model = buildGraphModel(demoData());
  const by = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.equal(by['林小雨'].color, by['白衣客'].color);
  assert.equal(by['林小雨'].shape, by['白衣客'].shape);
  assert.notEqual(by['林小雨'].color, by['城主'].color);
  assert.notEqual(by['林小雨'].shape, by['城主'].shape);
  assert.deepEqual(model.legend.map((l) => [l.type, l.count]), [['人物', 2], ['勢力', 1], ['地點', 1]]);
});

test('側欄資料帶著別名與相關伏筆', () => {
  const model = buildGraphModel(demoData());
  const by = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.deepEqual(by['白衣客'].aliases, ['落雨劍客']);
  assert.deepEqual(by['林小雨'].foreshadow, [{ title: '林小雨的真實身份', status: '埋設中' }]);
});

test('長中文名字會斷行，圖上才不會壓成一條', () => {
  const model = buildGraphModel({
    entities: [{ id: 'e1', name: '落雨劍客與他的舊傘', type: '人物' }],
    relations: [], chapters: [], foreshadow: [], chatlogs: [],
  });
  assert.equal(model.nodes[0].label, '落雨劍客與他\n的舊傘');
  assert.equal(model.nodes[0].name, '落雨劍客與他的舊傘');
});

test('產出的 HTML 自帶 cytoscape 與資料，不引任何外部網址', () => {
  const html = buildGraphHtml({
    model: buildGraphModel(demoData()), title: 'demo', generatedAt: '2026-07-23',
  });
  assert.ok(html.includes('林小雨'), '資料要內嵌');
  assert.ok(html.includes('cytoscape'), 'cytoscape 要內嵌');
  assert.ok(!/(src|href)="https?:/.test(html), '不可以有任何外部資源');
});

test('資料裡的 </script> 不會提早關掉腳本區塊', () => {
  const data = demoData();
  data.entities[0].notes = '他說 </script><script>alert(1)</script>';
  const html = buildGraphHtml({ model: buildGraphModel(data), title: 'demo', generatedAt: 'x' });
  assert.ok(!html.includes('</script><script>alert(1)'));
});
