'use strict';
// 跑法：npm run test:skill
// 就地編輯／新增／刪除的規則測試。不需要瀏覽器、不連網。
//
// 例子一律用示範用的角色（林小雨 / 白衣客 / 落雨劍客 / 城主 / 黑袍人），
// 這個 repo 是公開的，真實作品的劇情不進版控。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addChapter, addEntity, addForeshadow, addRelation, describeRecord, diffData, editChapter,
  editEntity, editForeshadow, editRelation, findEntity, isEmptyDiff, planRemoval, removeRecord,
} from '../scripts/edits.mjs';
import { applyCandidates, assertValidProjectData } from '../scripts/candidates.mjs';

function fixture() {
  return {
    entities: [
      { id: 'e1', name: '林小雨', aliases: [], type: '人物', tags: ['主角'], notes: '主角', customFields: [] },
      { id: 'e2', name: '城主', aliases: ['黑袍人'], type: '人物', tags: [], notes: '追殺主角的勢力領袖' },
      { id: 'e3', name: '落雨劍客', aliases: [], type: '人物', tags: [], notes: '' },
    ],
    relations: [
      { id: 'r1', sourceId: 'e2', targetId: 'e1', type: '追殺', notes: '' },
      { id: 'r2', sourceId: 'e3', targetId: 'e1', type: '師承', notes: '' },
      { id: 'r3', sourceId: 'e3', targetId: 'e2', type: '舊識', notes: '' },
    ],
    chapters: [
      { id: 'c1', volume: 1, order: 0, title: '雨夜', status: '完稿', wordCount: 3200, summary: '林小雨初遇白衣客', content: '雨下了一整夜。' },
      { id: 'c2', volume: 1, order: 1, title: '追兵', status: '未寫', wordCount: 0, summary: '', content: '' },
    ],
    foreshadow: [
      {
        id: 'f1', title: '林小雨的真實身份', plantChapterId: 'c1', recoverChapterId: 'c2',
        status: '埋設中', relatedEntityIds: ['e1'], relatedRelationIds: ['r2'], notes: '',
      },
    ],
    chatlogs: [],
  };
}

// ── 編輯保留 id ────────────────────────────────────────────────────────

test('edit entity 保留 id，關係與伏筆連結都不會斷', () => {
  const before = fixture();
  const { data } = editEntity(before, '林小雨', { rename: '林小雨（成年）', notes: '補完的背景', addAlias: '雨姑娘' });
  const e = data.entities.find((x) => x.id === 'e1');
  assert.equal(e.name, '林小雨（成年）');
  assert.equal(e.notes, '補完的背景');
  assert.deepEqual(e.aliases, ['雨姑娘']);
  assert.equal(data.entities.length, 3, '不可以多出分身');
  assert.equal(data.relations.filter((r) => r.sourceId === 'e1' || r.targetId === 'e1').length, 2);
  assert.deepEqual(data.foreshadow[0].relatedEntityIds, ['e1']);
});

test('edit entity 的自訂欄位可以新增、覆寫、移除', () => {
  const one = editEntity(fixture(), '林小雨', { field: ['身高=158cm', '慣用手=左'] }).data;
  assert.deepEqual(findEntity(one, '林小雨').customFields, [{ key: '身高', value: '158cm' }, { key: '慣用手', value: '左' }]);
  const two = editEntity(one, '林小雨', { field: '身高=160cm' }).data;
  assert.deepEqual(findEntity(two, '林小雨').customFields[0], { key: '身高', value: '160cm' });
  const three = editEntity(two, '林小雨', { rmField: '慣用手' }).data;
  assert.equal(findEntity(three, '林小雨').customFields.length, 1);
});

test('edit chapter 保留 id，指向它的伏筆不會變孤兒', () => {
  const { data } = editChapter(fixture(), '追兵', { status: '完稿', wordcount: undefined, wordCount: 2100, title: '追兵至' });
  const c = data.chapters.find((x) => x.id === 'c2');
  assert.equal(c.status, '完稿');
  assert.equal(c.wordCount, 2100);
  assert.equal(c.title, '追兵至');
  assert.equal(data.foreshadow[0].recoverChapterId, 'c2');
});

test('edit foreshadow 保留 id，並能改狀態與章節連結', () => {
  const { data } = editForeshadow(fixture(), '林小雨的真實身份', { status: '已回收', recover: '追兵', linkEntity: '城主' });
  const f = data.foreshadow[0];
  assert.equal(f.id, 'f1');
  assert.equal(f.status, '已回收');
  assert.equal(f.recoverChapterId, 'c2');
  assert.deepEqual(f.relatedEntityIds, ['e1', 'e2']);
});

test('edit foreshadow --plant none 可以清掉章節連結', () => {
  const { data } = editForeshadow(fixture(), 'f1', { plant: 'none' });
  assert.equal(data.foreshadow[0].plantChapterId, null);
});

test('edit relation 保留 id', () => {
  const { data } = editRelation(fixture(), '落雨劍客>林小雨', { type: '師徒', notes: '第一章拜師' });
  const r = data.relations.find((x) => x.id === 'r2');
  assert.equal(r.type, '師徒');
  assert.equal(r.notes, '第一章拜師');
  assert.deepEqual(data.foreshadow[0].relatedRelationIds, ['r2']);
});

test('編輯不會就地改動傳進來的 data', () => {
  const data = fixture();
  const snapshot = JSON.stringify(data);
  editEntity(data, '林小雨', { notes: '改了' });
  editChapter(data, '雨夜', { status: '草稿' });
  removeRecord(data, 'entity', '城主');
  assert.equal(JSON.stringify(data), snapshot);
});

// ── 驗證擋在寫入之前 ────────────────────────────────────────────────────

test('不合法的狀態被擋下來，不產生任何資料', () => {
  assert.throws(() => editChapter(fixture(), '雨夜', { status: '寫完了' }), /章節狀態只能是/);
  assert.throws(() => editForeshadow(fixture(), 'f1', { status: '回收了' }), /伏筆狀態只能是/);
  assert.throws(() => editChapter(fixture(), '雨夜', { volume: '零' }), /卷數/);
  assert.throws(() => editChapter(fixture(), '雨夜', { wordCount: -5 }), /字數/);
});

test('找不到、對到多筆、沒指定欄位都會擋下來', () => {
  assert.throws(() => editEntity(fixture(), '不存在的人', { notes: 'x' }), /找不到角色/);
  assert.throws(() => editEntity(fixture(), '林小雨', {}), /沒有指定任何要改的欄位/);
  const data = fixture();
  data.entities.push({ id: 'e4', name: '落雨劍客的弟子', aliases: [], type: '', tags: [], notes: '' });
  // 完全相符優先，所以「落雨劍客」仍指得動本尊；只有模糊比對對到多筆才算歧義。
  assert.equal(editEntity(data, '落雨劍客', { notes: 'x' }).data.entities.find((e) => e.id === 'e3').notes, 'x');
  assert.throws(() => editEntity(data, '落雨', { notes: 'x' }), /對到 2 筆/);
});

test('改名或加別名撞到既有角色時擋下來，不製造重複角色', () => {
  assert.throws(() => editEntity(fixture(), '林小雨', { rename: '城主' }), /已經是/);
  assert.throws(() => editEntity(fixture(), '林小雨', { addAlias: '黑袍人' }), /已經屬於/);
  assert.throws(() => addEntity(fixture(), { name: '黑袍人' }), /已經存在/);
});

test('edit entity 用別名也找得到本尊', () => {
  const { data } = editEntity(fixture(), '黑袍人', { notes: '真身是城主' });
  assert.equal(data.entities.find((e) => e.id === 'e2').notes, '真身是城主');
});

// ── 新增 ────────────────────────────────────────────────────────────────

test('add 出來的紀錄欄位齊全，且通過整份驗證', () => {
  let data = addEntity(fixture(), { name: '白衣客', type: '人物', notes: '雨夜裡的陌生人', aliases: ['執傘人'] }).data;
  const created = data.entities.find((e) => e.name === '白衣客');
  assert.deepEqual(created.aliases, ['執傘人']);
  assert.deepEqual(created.tags, []);

  data = addChapter(data, { title: '傘下', volume: 2, status: '草稿', wordCount: 1200 }).data;
  const ch = data.chapters.find((c) => c.title === '傘下');
  assert.equal(ch.order, 2);
  assert.equal(ch.status, '草稿');

  data = addRelation(data, { source: '白衣客', target: '林小雨', type: '護衛', notes: '' }).data;
  assert.ok(data.relations.find((r) => r.sourceId === created.id && r.targetId === 'e1'));

  data = addForeshadow(data, { title: '白衣客的傘', plant: '傘下', linkEntity: '白衣客' }).data;
  const f = data.foreshadow.find((x) => x.title === '白衣客的傘');
  assert.equal(f.status, '埋設中');
  assert.equal(f.plantChapterId, ch.id);
  assert.deepEqual(f.relatedEntityIds, [created.id]);

  assert.equal(assertValidProjectData(data), true);
});

test('add relation 找不到角色就擋下來，不產生斷掉的關係', () => {
  assert.throws(() => addRelation(fixture(), { source: '林小雨', target: '不存在的人', type: '追殺' }), /找不到角色/);
  assert.throws(() => addRelation(fixture(), { source: '城主', target: '林小雨', type: '追殺' }), /已經有一模一樣/);
});

// ── 刪除與連帶 ──────────────────────────────────────────────────────────

test('刪 entity 連帶刪掉所有相關關係', () => {
  const before = fixture();
  const plan = planRemoval(before, 'entity', '城主');
  assert.deepEqual(plan.cascade[0].records.map((r) => r.id).sort(), ['r1', 'r3']);
  const { data, log } = removeRecord(before, 'entity', '城主');
  assert.equal(data.entities.length, 2);
  assert.deepEqual(data.relations.map((r) => r.id), ['r2']);
  assert.ok(log.some((l) => l.includes('連帶刪除')));
  assert.equal(assertValidProjectData(data), true);
});

test('刪 entity 前的清單會先算出來，包含受影響的伏筆提醒', () => {
  const plan = planRemoval(fixture(), 'entity', '林小雨');
  assert.equal(plan.cascade[0].records.length, 2);
  assert.ok(plan.warn.some((w) => w.includes('伏筆')));
});

test('刪章節會提醒正文與指向它的伏筆，但不動其他 store', () => {
  const plan = planRemoval(fixture(), 'chapter', '雨夜');
  assert.ok(plan.warn.some((w) => w.includes('正文')));
  const { data } = removeRecord(fixture(), 'chapter', '雨夜');
  assert.equal(data.chapters.length, 1);
  assert.equal(data.foreshadow.length, 1, '伏筆不會被連帶刪掉');
});

test('刪關係只刪那一筆', () => {
  const { data } = removeRecord(fixture(), 'relation', 'r3');
  assert.equal(data.relations.length, 2);
  assert.equal(data.entities.length, 3);
});

test('描述文字看得出是哪一筆', () => {
  const data = fixture();
  assert.equal(describeRecord(data, 'relation', data.relations[0]), '城主 —追殺→ 林小雨');
});

// ── diff / 還原 ────────────────────────────────────────────────────────

test('diff 用 id 對齊，列出新增/刪除/欄位變更', () => {
  const before = fixture();
  const after = editEntity(before, '林小雨', { notes: '新的設定' }).data;
  const d = diffData(before, after);
  assert.equal(d.entities.changed.length, 1);
  assert.equal(d.entities.changed[0].fields[0].key, 'notes');
  assert.equal(d.entities.changed[0].fields[0].to, '新的設定');

  const removed = removeRecord(before, 'entity', '城主').data;
  const d2 = diffData(before, removed);
  assert.equal(d2.entities.removed.length, 1);
  assert.equal(d2.relations.removed.length, 2);
  assert.ok(isEmptyDiff(diffData(before, fixture())));
});

test('還原＝把快照整份換回來，round-trip 後跟原始一模一樣', () => {
  const original = fixture();
  const snapshot = JSON.parse(JSON.stringify(original));
  let data = editEntity(original, '林小雨', { notes: '亂改' }).data;
  data = removeRecord(data, 'entity', '城主').data;
  data = addChapter(data, { title: '亂加的一章' }).data;
  assert.ok(!isEmptyDiff(diffData(snapshot, data)));
  // restore 指令做的事就是這一步：整份換成快照內容。
  assert.equal(assertValidProjectData(snapshot), true);
  assert.ok(isEmptyDiff(diffData(snapshot, JSON.parse(JSON.stringify(snapshot)))));
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(original)), '快照本身不會被後續編輯汙染');
});

// ── #29：候選撞到既有角色 ───────────────────────────────────────────────

test('候選名字撞到既有角色的本名或別名時不會建立分身', () => {
  const { data, log } = applyCandidates(fixture(), {
    entities: [
      { name: '城主', aliasOf: null, type: '人物', notes: '重複送進來的既有角色', reason: '第二章又出現' },
      { name: '黑袍人', aliasOf: null, type: '人物', notes: '其實是城主的別名', reason: '模型沒認出來' },
    ],
  });
  assert.equal(data.entities.length, 3, '不可以多出任何角色');
  assert.equal(log.filter((l) => l.includes('未重複建立')).length, 2);
});

test('--update-existing 走就地更新，保留既有 id 與關係', () => {
  const { data, log } = applyCandidates(fixture(), {
    entities: [{ name: '城主', aliasOf: null, type: '勢力', notes: '補完的世界觀階層', reason: '第二章補述' }],
  }, { updateExisting: true });
  const lord = data.entities.find((e) => e.name === '城主');
  assert.equal(lord.id, 'e2', 'id 一定要保留，否則關係會斷');
  assert.equal(lord.type, '勢力');
  assert.equal(lord.notes, '補完的世界觀階層');
  assert.equal(data.relations.length, 3);
  assert.ok(log.some((l) => l.includes('更新既有角色')));
});
