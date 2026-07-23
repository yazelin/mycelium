'use strict';
// 跑法：node --test skills/mycelium/tests/
// 純 node 測試，不需要瀏覽器、不連網。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCandidates, assertValidProjectData, buildProposal, validateCandidates } from '../scripts/candidates.mjs';

const empty = () => ({ entities: [], relations: [], chapters: [], foreshadow: [], chatlogs: [] });

function withCast() {
  const data = empty();
  data.entities.push({ id: 'e1', name: '林小雨', aliases: [], type: '人物', tags: [], notes: '主角' });
  return data;
}

test('別名候選排在目標角色之前也能正確合併（兩趟的重點）', () => {
  const data = withCast();
  const { data: next, log } = applyCandidates(data, {
    entities: [
      { name: '黑袍人', aliasOf: '城主', type: null, notes: null, reason: '本章揭露城主就是黑袍人' },
      { name: '城主', aliasOf: null, type: '人物', notes: '追殺主角的勢力領袖', reason: '首次登場的新角色' },
    ],
    relations: [],
    foreshadow: [],
  });
  const lord = next.entities.find((e) => e.name === '城主');
  assert.ok(lord, '城主應該被建立');
  assert.deepEqual(lord.aliases, ['黑袍人']);
  assert.equal(next.entities.filter((e) => e.name === '黑袍人').length, 0, '黑袍人不應變成獨立角色');
  assert.ok(log.some((l) => l.includes('併為')));
});

test('aliasOf 指到不存在的名字時退回建成獨立角色，不丟掉候選', () => {
  const { data: next, log } = applyCandidates(withCast(), {
    entities: [{ name: '白衣客', aliasOf: '不存在的人', type: '人物', notes: '', reason: '章節裡的新面孔' }],
  });
  const guest = next.entities.find((e) => e.name === '白衣客');
  assert.ok(guest);
  assert.deepEqual(guest.aliases, []);
  assert.ok(log.some((l) => l.includes('找不到')));
});

test('關係可以用別名指到角色', () => {
  const data = withCast();
  data.entities.push({ id: 'e2', name: '城主', aliases: ['黑袍人'], type: '人物', tags: [], notes: '' });
  const { data: next } = applyCandidates(data, {
    relations: [{ source: '林小雨', target: '黑袍人', type: '追殺', reason: '城主軍全境追殺林小雨' }],
  });
  assert.equal(next.relations.length, 1);
  assert.equal(next.relations[0].sourceId, 'e1');
  assert.equal(next.relations[0].targetId, 'e2');
});

test('找不到角色的關係候選被略過，不會產生斷掉的 relation', () => {
  const { data: next, log } = applyCandidates(withCast(), {
    relations: [{ source: '林小雨', target: '落雨劍客', type: '師承', reason: '對話提到' }],
  });
  assert.equal(next.relations.length, 0);
  assert.ok(log.some((l) => l.includes('略過關係')));
});

test('伏筆候選帶入預設欄位', () => {
  const { data: next } = applyCandidates(withCast(), {
    foreshadow: [{ title: '林小雨的真實身份', notes: '暗示她是城主早年的徒弟', reason: '城主的台詞埋了伏筆' }],
  });
  assert.equal(next.foreshadow.length, 1);
  assert.equal(next.foreshadow[0].status, '埋設中');
  assert.equal(next.foreshadow[0].plantChapterId, null);
  assert.deepEqual(next.foreshadow[0].relatedEntityIds, []);
});

test('套用結果永遠通過 app 匯入器的驗證規則', () => {
  const { data: next } = applyCandidates(withCast(), {
    entities: [{ name: '落雨劍客', aliasOf: null, type: '人物', notes: '', reason: '新角色' }],
    relations: [{ source: '林小雨', target: '落雨劍客', type: '師承', reason: '本章拜師' }],
    foreshadow: [{ title: '劍上的舊刻痕', notes: '', reason: '特寫描寫' }],
  });
  assert.equal(assertValidProjectData(next), true);
  for (const store of ['entities', 'relations', 'foreshadow']) {
    for (const rec of next[store]) assert.equal(typeof rec.id, 'string');
  }
});

test('原本的 data 不會被就地改動', () => {
  const data = withCast();
  const before = JSON.stringify(data);
  applyCandidates(data, { entities: [{ name: '城主', aliasOf: null, type: '人物', notes: '', reason: '新角色' }] });
  assert.equal(JSON.stringify(data), before);
});

test('缺 reason 的候選被擋下來', () => {
  assert.throws(() => validateCandidates({ entities: [{ name: '城主', aliasOf: null }] }), /reason/);
});

test('候選檔含 chapters 會被擋，導向 apply', () => {
  assert.throws(() => validateCandidates({ chapters: [] }), /章節/);
});

test('壞掉的候選檔不會被當成空提案', () => {
  assert.throws(() => validateCandidates(null), /不是物件/);
  assert.throws(() => validateCandidates({ entities: '城主' }), /必須是陣列/);
});

test('提案檔就是 app 抽取結果那三個陣列放在最上層', () => {
  const p = buildProposal({
    entities: [{ name: '城主', aliasOf: null, type: '人物', notes: '', reason: '首次登場' }],
  }, { source: '第12章', note: '手動貼進來的舊稿' });
  assert.equal(p.version, 1);
  assert.equal(p.source, '第12章');
  assert.ok(Array.isArray(p.entities) && Array.isArray(p.relations) && Array.isArray(p.foreshadow));
  assert.equal(p.entities[0].name, '城主');
});

test('批量匯入舊稿的章節會補齊 app 需要的欄位', () => {
  const { data: next } = applyCandidates(withCast(), {}, {
    chapters: [{ volume: 1, title: '雨夜', wordCount: 3200, summary: '林小雨初遇白衣客' }],
  });
  assert.equal(next.chapters.length, 1);
  assert.equal(next.chapters[0].status, '未寫');
  assert.equal(next.chapters[0].order, 0);
  assert.equal(assertValidProjectData(next), true);
});
