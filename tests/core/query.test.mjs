import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../../core/store.mjs';

process.env.GIT_AUTHOR_NAME = '測試';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = '測試';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';

const SP = 'social';
const CH = 'story';
function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-'));
  const s = openStore({ dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops'), autoCommit: false });
  s.createSpace({ id: SP, name: '社群', kind: 'social', timeAxis: 'date' });
  const ent = (name, type = 'person') => s.upsertEntity(SP, { type, name }).entityId;
  const ids = { 小雨: ent('林小雨'), 白衣客: ent('白衣客'), 劍客: ent('落雨劍客'), 城主: ent('城主'), 黑袍: ent('黑袍人') };
  const fact = (subj, predicate, o = {}) => s.remember(SP, {
    subjectId: subj, predicate, validFrom: '2026-01-01', audience: 'public', author: 't', ...o }).factId;
  return { s, ids, fact };
}
const dump = (r) => JSON.stringify(r);

test('洩漏負控制 1：城主的私事在公開場合不出現', () => {
  const { s, ids, fact } = fresh();
  fact(ids.城主, '身分', { objectText: '公開的城主', audience: 'public' });
  fact(ids.城主, '祕密', { objectText: '怕黑的秘密', audience: `person:${ids.城主}` });
  const r = s.recall(SP, { text: '城主今天來了', audiences: ['public'] });
  assert.ok(r.text.includes('公開的城主'));
  assert.ok(!dump(r).includes('怕黑的秘密'));
  const r2 = s.recall(SP, { text: '城主今天來了', audiences: ['public', `person:${ids.城主}`] });
  assert.ok(r2.text.includes('怕黑的秘密'));
});

test('洩漏負控制 2：落雨劍客私下說城主的事，只有他自己的範圍看得到', () => {
  const { s, ids, fact } = fresh();
  fact(ids.城主, '被評價', { objectText: '劍客私評：城主膽小', audience: `person:${ids.劍客}` });
  s.logEpisode(SP, { at: '2026-02-01', source: 'dm', audience: `person:${ids.劍客}`, body: '劍客悄悄說城主很膽小', entityIds: [ids.城主] });
  const hid = s.recall(SP, { text: '城主膽小嗎', audiences: ['public', `person:${ids.城主}`] });
  assert.ok(!dump(hid).includes('城主膽小'));
  assert.ok(!dump(hid).includes('悄悄說'));
  assert.ok(!dump(s.search(SP, '城主', { audiences: ['public', `person:${ids.城主}`] })).includes('膽小'));
  const ok = s.recall(SP, { text: '城主膽小嗎', audiences: ['public', `person:${ids.劍客}`] });
  assert.ok(ok.text.includes('城主膽小'));
  assert.ok(ok.text.includes('悄悄說'));
});

test('走關係洩漏：從白衣客走一層帶出城主，城主的私事不出現', () => {
  const { s, ids, fact } = fresh();
  fact(ids.白衣客, '效忠', { objectEntity: ids.城主 });
  fact(ids.城主, '祕密', { objectText: '藏著的密信', audience: `person:${ids.城主}` });
  const r = s.recall(SP, { text: '白衣客來了', audiences: ['public'], hops: 2 });
  assert.ok(r.entities.some((e) => e.id === ids.城主));
  assert.ok(!dump(r).includes('藏著的密信'));
  const n = s.neighbors(SP, ids.白衣客, { hops: 2, audiences: ['public'] });
  assert.ok(!dump(n).includes('藏著的密信'));
});

test('只經由不可見事實連到的人物不會出現', () => {
  const { s, ids, fact } = fresh();
  fact(ids.白衣客, '暗中認識', { objectEntity: ids.黑袍, audience: `person:${ids.白衣客}` });
  const r = s.recall(SP, { text: '白衣客來了', audiences: ['public'] });
  assert.ok(!r.entities.some((e) => e.id === ids.黑袍));
  assert.ok(!r.text.includes('黑袍人'));
  assert.equal(s.neighbors(SP, ids.白衣客, { audiences: ['public'] }).entities.length, 0);
});

test('引用另一條事實時，被引用的事實不可見就不呈現內容', () => {
  const { s, ids, fact } = fresh();
  const secret = fact(ids.城主, '祕密', { objectText: '藏在井底的寶藏', audience: `person:${ids.城主}` });
  fact(ids.小雨, '知道', { objectFact: secret });
  const r = s.recall(SP, { text: '林小雨說話了', audiences: ['public'] });
  assert.ok(!dump(r).includes('藏在井底'));
  assert.ok(!dump(s.getEntity(SP, ids.小雨, { audiences: ['public'] })).includes('藏在井底'));
  const r2 = s.recall(SP, { text: '林小雨說話了', audiences: ['public', `person:${ids.城主}`] });
  assert.ok(r2.text.includes('藏在井底'));
});

test('時間：at 早於失效時間拿得到舊事實，現在拿不到', () => {
  const { s, ids, fact } = fresh();
  const f = fact(ids.小雨, '住在', { objectText: '舊村' });
  s.invalidate(SP, f, '2026-06-01');
  fact(ids.小雨, '住在', { objectText: '新城', validFrom: '2026-06-01' });
  const past = s.recall(SP, { text: '林小雨', at: '2026-03-01', audiences: ['public'] });
  assert.ok(past.text.includes('舊村'));
  assert.ok(!past.text.includes('新城'));
  const now = s.recall(SP, { text: '林小雨', audiences: ['public'] });
  assert.ok(!now.text.includes('舊村'));
  assert.ok(now.text.includes('新城'));
  const g = s.getEntity(SP, ids.小雨, { audiences: ['public'] });
  assert.equal(g.activeFacts.length, 1);
  assert.equal(g.pastFacts.length, 1);
  assert.equal(g.entity.name, '林小雨');
});

test('章節軸：ch01 時「林小雨 知道 某事實」尚未生效，ch02 有', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-'));
  const s = openStore({ dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops'), autoCommit: false });
  s.createSpace({ id: CH, name: '故事', kind: 'story', timeAxis: 'chapter', chapters: ['ch01', 'ch02', 'ch03'] });
  const a = s.upsertEntity(CH, { type: 'person', name: '林小雨' }).entityId;
  const b = s.upsertEntity(CH, { type: 'person', name: '黑袍人' }).entityId;
  const base = s.remember(CH, { subjectId: b, predicate: '真身', objectText: '失蹤的掌門', validFrom: 'ch01', audience: 'public', author: 't' }).factId;
  s.remember(CH, { subjectId: a, predicate: '知道', objectFact: base, validFrom: 'ch02', audience: 'public', author: 't' });
  const c1 = s.recall(CH, { text: '林小雨', at: 'ch01', audiences: ['public'] });
  assert.ok(!c1.text.includes('知道'));
  const c2 = s.recall(CH, { text: '林小雨', at: 'ch02', audiences: ['public'] });
  assert.ok(c2.text.includes('知道'));
  assert.ok(c2.text.includes('失蹤的掌門'));
});

test('兩字名：search("城主") 找得到', () => {
  const { s, ids } = fresh();
  const r = s.search(SP, '城主', { audiences: ['public'] });
  assert.ok(r.some((h) => h.kind === 'entity' && h.id === ids.城主));
  const r3 = s.search(SP, '落雨劍客', { audiences: ['public'] });
  assert.ok(r3.some((h) => h.id === ids.劍客));
});

test('誤想起負控制：別名「白衣」不被「白色衣服」帶出', () => {
  const { s, ids } = fresh();
  s.addAlias(SP, ids.白衣客, '白衣');
  const no = s.recall(SP, { text: '她穿白色衣服', audiences: ['public'] });
  assert.ok(!no.entities.some((e) => e.id === ids.白衣客));
  const yes = s.recall(SP, { text: '白衣客來了', audiences: ['public'] });
  assert.ok(yes.entities.some((e) => e.id === ids.白衣客));
  const alias = s.recall(SP, { text: '白衣來了', audiences: ['public'] });
  assert.ok(alias.entities.some((e) => e.id === ids.白衣客));
});

test('recall 不帶 audiences 丟錯；remember 用未知範圍丟錯', () => {
  const { s, ids } = fresh();
  assert.throws(() => s.recall(SP, { text: '城主' }), /recall 要指定能看哪些可見範圍/);
  assert.throws(() => s.recall(SP, { text: '城主', audiences: [] }), /recall 要指定能看哪些可見範圍/);
  assert.throws(() => s.remember(SP, { subjectId: ids.城主, predicate: 'x', objectText: 'y', validFrom: '2026-01-01', audience: 'secret', author: 't' }), /未知的可見範圍/);
});

test('合併：林小雨併入白衣客後，person:林小雨 的私事不擴散給 person:白衣客', () => {
  const { s, ids, fact } = fresh();
  fact(ids.小雨, '心事', { objectText: '想學劍的心事', audience: `person:${ids.小雨}` });
  fact(ids.小雨, '身分', { objectText: '山下的學徒' });
  fact(ids.黑袍, '祕密', { objectText: '別人的私事', audience: `person:${ids.城主}` });
  s.mergeEntities(SP, ids.小雨, ids.白衣客, '同一人');
  // 公開事實照常跟著合併歸到白衣客
  const r = s.recall(SP, { text: '白衣客來了', audiences: ['public', `person:${ids.白衣客}`] });
  assert.ok(r.text.includes('山下的學徒'));
  assert.ok(!dump(r).includes('想學劍的心事'));
  assert.ok(!dump(r).includes('別人的私事'));
  const pub = s.recall(SP, { text: '白衣客來了', audiences: ['public'] });
  assert.ok(!pub.text.includes('想學劍的心事'));
  // 正控制：用原本的標籤查得到兩者
  const own = s.recall(SP, { text: '白衣客來了', audiences: ['public', `person:${ids.小雨}`] });
  assert.ok(own.text.includes('想學劍的心事'));
  assert.ok(own.text.includes('山下的學徒'));
  assert.equal(r.entities.filter((e) => e.id === ids.小雨).length, 0);
});

test('合併不擴散：getEntity、timeline、neighbors、search、episode、別名都用完全比對', () => {
  const { s, ids, fact } = fresh();
  const mine = `person:${ids.小雨}`;
  const other = [ 'public', `person:${ids.白衣客}` ];
  const own = [ 'public', mine ];
  fact(ids.小雨, '心事', { objectText: '想學劍的心事', audience: mine });
  fact(ids.小雨, '暗戀', { objectEntity: ids.城主, audience: mine });
  s.logEpisode(SP, { at: '2026-02-01', source: 'dm', audience: mine, body: '小雨私下提到玉佩的來歷', entityIds: [ids.小雨] });
  s.addAlias(SP, ids.小雨, '雨妹秘稱', { audience: mine });
  s.mergeEntities(SP, ids.小雨, ids.白衣客, '同一人');
  // getEntity
  assert.ok(!dump(s.getEntity(SP, ids.白衣客, { audiences: other })).includes('想學劍的心事'));
  assert.ok(!s.getEntity(SP, ids.白衣客, { audiences: other }).aliases.some((x) => x.alias === '雨妹秘稱'));
  assert.ok(s.getEntity(SP, ids.白衣客, { audiences: own }).aliases.some((x) => x.alias === '雨妹秘稱'));
  // timeline
  assert.ok(!dump(s.timeline(SP, { entityId: ids.白衣客, audiences: other })).includes('想學劍的心事'));
  assert.ok(dump(s.timeline(SP, { entityId: ids.白衣客, audiences: own })).includes('想學劍的心事'));
  // neighbors：私下的關係邊
  assert.ok(!s.neighbors(SP, ids.白衣客, { audiences: other }).entities.some((e) => e.id === ids.城主));
  assert.ok(s.neighbors(SP, ids.白衣客, { audiences: own }).entities.some((e) => e.id === ids.城主));
  // search：事實、episode、別名
  assert.ok(!dump(s.search(SP, '玉佩', { audiences: other })).includes('玉佩'));
  assert.ok(dump(s.search(SP, '玉佩', { audiences: own })).includes('玉佩'));
  assert.ok(!dump(s.search(SP, '想學劍', { audiences: other })).includes('想學劍'));
  assert.ok(!s.search(SP, '雨妹秘稱', { audiences: other }).some((h) => h.id === ids.白衣客));
  assert.ok(s.search(SP, '雨妹秘稱', { audiences: own }).some((h) => h.id === ids.白衣客));
  const rr = s.recall(SP, { text: '雨妹秘稱來了', audiences: other });
  assert.ok(!dump(rr).includes('想學劍的心事'));
  assert.ok(!dump(rr).includes('玉佩'));
});

test('maxChars 截在整行邊界、不超過上限', () => {
  const { s, ids, fact } = fresh();
  for (let i = 0; i < 30; i++) fact(ids.小雨, `事件${i}`, { objectText: `第${i}件很長很長的事情內容` });
  const r = s.recall(SP, { text: '林小雨', audiences: ['public'], maxChars: 100 });
  assert.ok(r.text.length > 0 && r.text.length <= 100);
  assert.ok(r.text.split('\n').every((l) => l.startsWith('【') || l.startsWith('- ')));
});

test('timeline 依 valid_from 排序且濾掉不可見事實', () => {
  const { s, ids, fact } = fresh();
  fact(ids.小雨, '後', { objectText: 'b', validFrom: '2026-05-01' });
  fact(ids.小雨, '先', { objectText: 'a', validFrom: '2026-02-01' });
  fact(ids.小雨, '私', { objectText: 'c', validFrom: '2026-03-01', audience: `person:${ids.城主}` });
  const t = s.timeline(SP, { entityId: ids.小雨, audiences: ['public'] });
  assert.deepEqual(t.map((f) => f.predicate), ['先', '後']);
});

test('recall 的 episodes 也受 at 限制（章節軸）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-'));
  const s = openStore({ dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops'), autoCommit: false });
  s.createSpace({ id: CH, name: '故事', kind: 'story', timeAxis: 'chapter', chapters: ['ch01', 'ch02', 'ch05', 'ch10'] });
  const a = s.upsertEntity(CH, { type: 'person', name: '林小雨' }).entityId;
  s.logEpisode(CH, { at: 'ch05', source: 'n', audience: 'public', body: '林小雨在第五章拿到了劍', entityIds: [a] });
  s.logEpisode(CH, { at: 'ch02', source: 'n', audience: 'public', body: '林小雨在第二章下山', entityIds: [a] });
  const early = s.recall(CH, { text: '林小雨', at: 'ch01', audiences: ['public'] });
  assert.equal(early.episodes.length, 0);
  assert.ok(!early.text.includes('第五章'));
  const mid = s.recall(CH, { text: '林小雨', at: 'ch05', audiences: ['public'] });
  assert.deepEqual(mid.episodes.map((e) => e.at), ['ch05', 'ch02']);
});

test('getEntity／neighbors／timeline 限定在指定空間', () => {
  const { s, ids } = fresh();
  s.createSpace({ id: 'st', name: '故事', kind: 'story', timeAxis: 'date' });
  const other = s.upsertEntity('st', { type: 'person', name: '黑袍人' }).entityId;
  assert.equal(s.getEntity(SP, other, { audiences: ['public'] }), null);
  assert.deepEqual(s.neighbors(SP, other, { audiences: ['public'] }), { entities: [], facts: [] });
  assert.deepEqual(s.timeline(SP, { entityId: other, audiences: ['public'] }), []);
  assert.ok(s.getEntity(SP, ids.城主, { audiences: ['public'] }));
});

test('別名有可見範圍：私下的暱稱不在公開場合想起或列出', () => {
  const { s, ids } = fresh();
  s.addAlias(SP, ids.白衣客, '小白', { audience: `person:${ids.劍客}` });
  const pub = s.recall(SP, { text: '小白來了', audiences: ['public'] });
  assert.ok(!pub.entities.some((e) => e.id === ids.白衣客));
  assert.ok(!pub.text.includes('小白'));
  const priv = s.recall(SP, { text: '小白來了', audiences: ['public', `person:${ids.劍客}`] });
  assert.ok(priv.entities.some((e) => e.id === ids.白衣客));
  assert.ok(!s.getEntity(SP, ids.白衣客, { audiences: ['public'] }).aliases.some((a) => a.alias === '小白'));
  assert.ok(s.getEntity(SP, ids.白衣客, { audiences: ['public', `person:${ids.劍客}`] }).aliases.some((a) => a.alias === '小白'));
  assert.ok(!s.search(SP, '小白', { audiences: ['public'] }).some((h) => h.id === ids.白衣客));
  assert.ok(s.search(SP, '小白', { audiences: ['public', `person:${ids.劍客}`] }).some((h) => h.id === ids.白衣客));
  assert.throws(() => s.addAlias(SP, ids.白衣客, '小白白', { audience: 'secret' }), /未知的可見範圍/);
});

test('search 的 MATCH 路徑不回傳不可見的事實與紀錄；引用隱藏事實的事實也不出現', () => {
  const { s, ids, fact } = fresh();
  const hid = fact(ids.城主, '祕密', { objectText: '井底藏著寶箱鑰匙', audience: `person:${ids.城主}` });
  fact(ids.小雨, '知道', { objectFact: hid });
  s.logEpisode(SP, { at: '2026-02-01', source: 'dm', audience: `person:${ids.城主}`, body: '城主私下提到寶箱鑰匙', entityIds: [ids.城主] });
  const pub = s.search(SP, '寶箱鑰匙', { audiences: ['public'] });
  assert.equal(pub.length, 0);
  const full = s.search(SP, '寶箱鑰匙', { audiences: ['public', `person:${ids.城主}`] });
  assert.ok(full.some((h) => h.kind === 'fact') && full.some((h) => h.kind === 'episode'));
  const refs = s.search(SP, '知道', { audiences: ['public'] });
  assert.ok(!refs.some((h) => h.kind === 'fact'));
});

test('舊資料含未知章節：recall／timeline／getEntity 不丟錯，該筆略過並 warn', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'query-'));
  const cfg = { dbPath: path.join(root, 'm.db'), opsDir: path.join(root, 'ops'), autoCommit: false };
  const s = openStore(cfg);
  s.createSpace({ id: CH, name: '故事', kind: 'story', timeAxis: 'chapter', chapters: ['c1', 'c2'] });
  const a = s.upsertEntity(CH, { type: 'person', name: '林小雨' }).entityId;
  s.remember(CH, { subjectId: a, predicate: '有', objectText: '劍', validFrom: 'c1', audience: 'public', author: 't' });
  s.close();
  // 舊版程式寫進去的壞資料（現在的 Store 會擋）
  const old = { id: '01OLDCH', dev: 'ZZZ', hlc: '9999999999990-0000-ZZZ', type: 'remember', space: CH,
    data: { factId: 'oldf', subjectId: a, predicate: '有', objectText: '盾', validFrom: 'c9', audience: 'public', author: 't' } };
  fs.writeFileSync(path.join(cfg.opsDir, 'old-ZZZ.jsonl'), JSON.stringify(old) + '\n');
  const s2 = openStore(cfg);
  const warn = t.mock.method(console, 'warn', () => {});
  const r = s2.recall(CH, { names: ['林小雨'], at: 'c2', audiences: ['public'] });
  assert.ok(r.text.includes('劍'));
  assert.ok(!r.text.includes('盾'));
  assert.doesNotThrow(() => s2.timeline(CH, { audiences: ['public'] }));
  assert.doesNotThrow(() => s2.getEntity(CH, a, { at: 'c2', audiences: ['public'] }));
  assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('c9')));
  s2.close();
});

// ---- C2：remember 回傳的 sameKindActive 不能洩漏 ----
test('sameKindActive：公開寫入不回傳 person: 事實（負控制）；同範圍寫入會回傳（正控制）', () => {
  const { s, ids, fact } = fresh();
  const pub = fact(ids.小雨, '住在', { objectText: '台北' });
  const priv = s.remember(SP, { subjectId: ids.小雨, predicate: '住在', objectText: '台南的秘密地址',
    validFrom: '2026-11-01', audience: `person:${ids.城主}`, author: 't' }).factId;
  assert.ok(pub);
  const r = s.remember(SP, { subjectId: ids.小雨, predicate: '住在', objectText: '高雄', validFrom: '2026-11-20', audience: 'public', author: 't' });
  assert.ok(!dump(r).includes('台南的秘密地址'));
  assert.ok(!r.sameKindActive.some((x) => x.factId === priv));
  const r2 = s.remember(SP, { subjectId: ids.小雨, predicate: '住在', objectText: '台中',
    validFrom: '2026-11-21', audience: `person:${ids.城主}`, author: 't' });
  assert.ok(r2.sameKindActive.some((x) => x.factId === priv));
  assert.ok(r2.sameKindActive.some((x) => x.object === '高雄')); // 公開的也列出
});

test('sameKindActive 用 resolve 後的主體：合併前掛在舊人物名下的事實也列出', () => {
  const { s, ids, fact } = fresh();
  const old = fact(ids.劍客, '武器', { objectText: '落雨劍' });
  s.mergeEntities(SP, ids.劍客, ids.白衣客, '同一人');
  const r = s.remember(SP, { subjectId: ids.白衣客, predicate: '武器', objectText: '木劍', validFrom: '2026-02-01', audience: 'public', author: 't' });
  assert.ok(r.sameKindActive.some((x) => x.factId === old));
});

// ---- I1：upsertEntity 的候選不比對隱藏別名 ----
test('upsertEntity 候選：person: 別名預設不比對（負控制），帶 audiences 時比對（正控制）', () => {
  const { s, ids } = fresh();
  s.addAlias(SP, ids.小雨, '小愛秘名', { audience: `person:${ids.城主}` });
  const c = s.upsertEntity(SP, { type: 'person', name: '小愛秘名' });
  assert.ok(!c.candidates.some((x) => x.entityId === ids.小雨));
  assert.ok(!dump(c).includes('林小雨'));
  const c2 = s.upsertEntity(SP, { type: 'person', name: '小愛秘名', audiences: ['public', `person:${ids.城主}`] });
  assert.ok(c2.candidates.some((x) => x.entityId === ids.小雨 && x.why === 'alias'));
});

// ---- I2：較窄的可見範圍不能改動較寬的事實；輸出不指向看不到的紀錄 ----
test('person: 事實取代公開事實被拒且不寫入；public 取代 public 可以', () => {
  const { s, ids, fact } = fresh();
  const pub = fact(ids.小雨, '住在', { objectText: '台北' });
  const n = s.oplog.readAll().length;
  assert.throws(() => s.remember(SP, { subjectId: ids.小雨, predicate: '住在', objectText: '台南', validFrom: '2026-11-01',
    audience: `person:${ids.城主}`, author: 't', supersedes: [pub] }), /不能用較私下的資訊改動較公開的事實/);
  assert.throws(() => s.invalidate(SP, pub, '2026-11-01', undefined, `person:${ids.城主}`), /不能用較私下的資訊改動較公開的事實/);
  assert.equal(s.oplog.readAll().length, n);
  const nf = s.remember(SP, { subjectId: ids.小雨, predicate: '住在', objectText: '高雄', validFrom: '2026-11-01',
    audience: 'public', author: 't', supersedes: [pub] }).factId;
  assert.equal(s.db.prepare('SELECT superseded_by FROM facts WHERE id=?').get(pub).superseded_by, nf);
  // 同一個 person: 範圍可以互相取代；公開寫入可以讓私下事實失效
  const p1 = fact(ids.小雨, '暗號', { objectText: '甲', audience: `person:${ids.城主}` });
  s.remember(SP, { subjectId: ids.小雨, predicate: '暗號', objectText: '乙', validFrom: '2026-02-01',
    audience: `person:${ids.城主}`, author: 't', supersedes: [p1] });
  const p2 = fact(ids.小雨, '綽號', { objectText: '丙', audience: `person:${ids.城主}` });
  s.invalidate(SP, p2, '2026-03-01');
  assert.equal(s.db.prepare('SELECT valid_to FROM facts WHERE id=?').get(p2).valid_to, '2026-03-01');
});

test('公開查詢輸出的 superseded_by／source_episode 不指向看不到的紀錄（只清輸出）', () => {
  const { s, ids, fact } = fresh();
  const pub = fact(ids.小雨, '住在', { objectText: '台北' });
  const priv = fact(ids.小雨, '住在', { objectText: '台南的秘密地址', validFrom: '2026-11-01', audience: `person:${ids.城主}` });
  s.invalidate(SP, pub, '2026-11-01', priv); // 公開寫入讓公開事實失效，但指向私下事實
  const ep = s.logEpisode(SP, { at: '2026-11-21', source: 'dm', audience: `person:${ids.城主}`, body: '私訊內容' });
  const cat = fact(ids.小雨, '喜歡', { objectText: '貓', sourceEpisode: ep });
  const g = s.getEntity(SP, ids.小雨, { audiences: ['public'] });
  const past = g.pastFacts.find((f) => f.id === pub);
  assert.equal(past.superseded_by, null);
  assert.ok(!dump(g).includes(priv) && !dump(g).includes(ep));
  const rc = s.recall(SP, { names: ['林小雨'], audiences: ['public'] });
  assert.equal(rc.facts.find((f) => f.id === cat).source_episode, null);
  assert.ok(!dump(rc).includes(ep));
  assert.ok(!dump(s.timeline(SP, { audiences: ['public'] })).includes(priv));
  assert.ok(!dump(s.search(SP, '貓', { audiences: ['public'] })).includes(ep));
  // 資料庫不動；看得到的範圍照常拿到
  assert.equal(s.db.prepare('SELECT superseded_by FROM facts WHERE id=?').get(pub).superseded_by, priv);
  const g2 = s.getEntity(SP, ids.小雨, { audiences: ['public', `person:${ids.城主}`] });
  assert.equal(g2.pastFacts.find((f) => f.id === pub).superseded_by, priv);
});

test('合併不擴散：sameKindActive 與 upsertEntity 候選不帶出合併前的私下紀錄', () => {
  const { s, ids, fact } = fresh();
  const mine = `person:${ids.小雨}`;
  const priv = fact(ids.小雨, '住在', { objectText: '山下的小屋', audience: mine });
  s.addAlias(SP, ids.小雨, '雨妹秘稱', { audience: mine });
  s.mergeEntities(SP, ids.小雨, ids.白衣客, '同一人');
  const r = s.remember(SP, { subjectId: ids.白衣客, predicate: '住在', objectText: '客棧', validFrom: '2026-11-01',
    audience: `person:${ids.白衣客}`, author: 't' });
  assert.ok(!r.sameKindActive.some((x) => x.factId === priv));
  assert.ok(!dump(r).includes('山下的小屋'));
  // 正控制：用原標籤寫入會列出
  const r2 = s.remember(SP, { subjectId: ids.白衣客, predicate: '住在', objectText: '山頂', validFrom: '2026-11-02',
    audience: mine, author: 't' });
  assert.ok(r2.sameKindActive.some((x) => x.factId === priv));
  // upsertEntity 候選
  const c = s.upsertEntity(SP, { type: 'person', name: '雨妹秘稱', audiences: ['public', `person:${ids.白衣客}`] });
  assert.ok(!c.candidates.some((x) => x.why === 'alias'));
  const c2 = s.upsertEntity(SP, { type: 'person', name: '雨妹秘稱', audiences: ['public', mine] });
  assert.ok(c2.candidates.some((x) => x.why === 'alias')); // 別名仍綁在原人物列上
});

test('合併不擴散：checkWidth 不讓 person:白衣客 取代合併前 person:林小雨 的事實', () => {
  const { s, ids, fact } = fresh();
  const mine = `person:${ids.小雨}`;
  const priv = fact(ids.小雨, '暗號', { objectText: '甲', audience: mine });
  s.mergeEntities(SP, ids.小雨, ids.白衣客, '同一人');
  const n = s.oplog.readAll().length;
  assert.throws(() => s.remember(SP, { subjectId: ids.白衣客, predicate: '暗號', objectText: '乙', validFrom: '2026-02-01',
    audience: `person:${ids.白衣客}`, author: 't', supersedes: [priv] }), /不能用另一人的私下資訊改動這條事實/);
  assert.throws(() => s.invalidate(SP, priv, '2026-03-01', undefined, `person:${ids.白衣客}`), /不能用另一人的私下資訊改動這條事實/);
  assert.equal(s.oplog.readAll().length, n);
  // 正控制：同一個標籤可以取代
  s.remember(SP, { subjectId: ids.白衣客, predicate: '暗號', objectText: '丙', validFrom: '2026-02-01',
    audience: mine, author: 't', supersedes: [priv] });
});

// ---- I3：handle 查到的 entityId 是原綁定的人物，person: 標籤用它 ----
test('findByHandle：A 併入 B 後回 entityId=A、resolvedId=B；用 person:A 寫的私事只在 person:A 看得到', () => {
  const { s, ids } = fresh();
  s.addAlias(SP, ids.劍客, '@rainblade', { platform: 'line', isHandle: true });
  s.mergeEntities(SP, ids.劍客, ids.白衣客, '本人公開聲明');
  const h = s.findByHandle(SP, 'line', '@rainblade');
  assert.deepEqual(h, { entityId: ids.劍客, resolvedId: ids.白衣客 });
  assert.equal(s.findByHandle(SP, 'line', '@nobody'), null);
  // 主體用 resolvedId，audience 用原綁定的 entityId
  s.remember(SP, { subjectId: h.resolvedId, predicate: '私下說', objectText: '明天要去北山採藥', validFrom: '2026-01-02',
    audience: `person:${h.entityId}`, author: 't' });
  const seen = s.recall(SP, { text: '白衣客', audiences: ['public', `person:${ids.劍客}`] });
  assert.ok(dump(seen).includes('明天要去北山採藥'));
  const hidden = s.recall(SP, { text: '白衣客', audiences: ['public', `person:${ids.白衣客}`] });
  assert.ok(!dump(hidden).includes('明天要去北山採藥'));
});

test('upsertEntity 候選帶 resolvedId，同一個 resolvedId 只列一次', () => {
  const { s, ids } = fresh();
  s.addAlias(SP, ids.劍客, '白衣客');
  s.mergeEntities(SP, ids.劍客, ids.白衣客, '同一人');
  const c = s.upsertEntity(SP, { type: 'person', name: '白衣客' });
  const hits = c.candidates.filter((x) => x.resolvedId === ids.白衣客);
  assert.equal(hits.length, 1);
  for (const x of c.candidates) assert.equal(x.resolvedId, s.resolve(x.entityId));
  // 只有別名命中的人物：entityId 保留原綁定，resolvedId 是合併後的人
  s.addAlias(SP, ids.黑袍, '夜行者');
  s.mergeEntities(SP, ids.黑袍, ids.城主, '同一人');
  const c2 = s.upsertEntity(SP, { type: 'person', name: '夜行者' });
  assert.ok(c2.candidates.some((x) => x.entityId === ids.黑袍 && x.resolvedId === ids.城主 && x.why === 'alias'));
});
