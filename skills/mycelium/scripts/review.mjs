'use strict';
// review 的資料模型：把一份完整的作品資料，壓成「某一種模式的人可以看到的那一份」。
//
// 這裡是整個功能的安全核心。三種模式的差別**全部在這一層決定**，前端拿到的
// JSON 裡就已經沒有它不該有的東西——不是用 CSS 藏起來。看原始碼會破功的東西，
// 就不可以進到檔案裡。
import { splitLayers } from './layers.mjs';
import { buildGraphModel } from './graph.mjs';
import { isForeshadowOverdue, sortChapters } from './records.mjs';
import { validRelations } from './schema.mjs';

export const MODES = ['author', 'production', 'public'];
export const MODE_LABEL = { author: '作者', production: '製作', public: '公開' };
export const MODE_TAGLINE = {
  author: '全部：表層、底層、伏筆、改動標記',
  production: '只有表層與視覺設定，底層在產生檔案時就被拿掉了',
  public: '依卷數解鎖的表層設定',
};

/** 作者以外的模式，一律只留標題含「表層」的段落。 */
function visibleSections(text, mode) {
  const sections = splitLayers(text);
  if (mode === 'author') return { sections, hidden: 0 };
  const kept = sections.filter((s) => s.kind === 'surface');
  return { sections: kept, hidden: sections.length - kept.length };
}

function sectionsToText(sections) {
  return sections.map((s) => s.body).join('\n\n').trim();
}

/**
 * 角色第一次出現在第幾卷：用章節（標題／摘要／正文）有沒有提到他來算。
 *
 * 公開模式算解鎖的時候只認本名（`includeAliases: false`）：別名常常是很短的
 * 普通詞（「靈異」「鬼打牆」），拿去比對整篇正文一定會誤中，把還不該公開的
 * 條目放出去。少放一個沒關係，多放一個就是劇透。
 */
export function debutVolume(entity, chapters, { includeAliases = true } = {}) {
  const names = [entity.name, ...(includeAliases ? (entity.aliases || []) : [])].filter(Boolean);
  let min = null;
  for (const c of chapters || []) {
    const hay = `${c.title || ''}\n${c.summary || ''}\n${c.content || ''}`;
    if (!names.some((n) => hay.includes(n))) continue;
    const v = Number(c.volume) || 1;
    if (min === null || v < min) min = v;
  }
  return min;
}

/**
 * 依模式過濾出一份「形狀跟原始資料一樣」的資料。
 * 關係圖、清單、搜尋索引全部從這一份長出來，所以只要這裡乾淨，整個檔案就乾淨。
 */
export function filterData(data, { mode = 'author', volume = 1 } = {}) {
  const entities = data.entities || [];
  const chapters = data.chapters || [];

  if (mode === 'author') {
    return { ...data, entities, chapters, relations: data.relations || [], foreshadow: data.foreshadow || [], chatlogs: [] };
  }

  const debut = new Map(entities.map((e) => [e.id, debutVolume(e, chapters, { includeAliases: false })]));
  const inPublic = (e) => {
    const d = debut.get(e.id);
    // 還沒在任何一章出現過的角色，讀者也還沒讀到——公開模式一律不放。
    if (d === null || d > volume) return false;
    // 也要真的有整理過表層。沒有表層的條目對讀者是一格空白，放上去只是雜訊。
    return visibleSections(e.notes, 'public').sections.length > 0;
  };

  const keptEntities = (mode === 'public' ? entities.filter(inPublic) : entities).map((e) => {
    const { sections } = visibleSections(e.notes, mode);
    return {
      ...e,
      // 別名常常本身就是反轉（「城主就是黑袍人」），公開模式不給。
      aliases: mode === 'public' ? [] : (e.aliases || []),
      tags: [],
      notes: sectionsToText(sections),
      customFields: [],
      // 視覺設定是給畫師與生圖模型的工作檔，不是給讀者的。
      visuals: mode === 'public' ? [] : (e.visuals || []),
    };
  });

  const keptIds = new Set(keptEntities.map((e) => e.id));
  const byId = Object.fromEntries(keptEntities.map((e) => [e.id, e]));
  const relations = validRelations(data.relations || [], byId)
    .filter((r) => keptIds.has(r.sourceId) && keptIds.has(r.targetId))
    // 關係的備註幾乎都是劇情（「第二卷後成為單向關係」），只留「誰跟誰、什麼關係」。
    .map((r) => ({ ...r, notes: '' }));

  const keptChapters = (mode === 'public' ? chapters.filter((c) => (Number(c.volume) || 1) <= volume) : chapters)
    .map((c) => {
      const { sections } = visibleSections(c.summary, mode);
      return { ...c, summary: sectionsToText(sections), content: '' };
    });

  return {
    entities: keptEntities,
    relations,
    chapters: keptChapters,
    // 伏筆＝還沒發生的反轉，本身就是劇透。非作者模式整個 store 不進檔案。
    foreshadow: [],
    chatlogs: [],
  };
}

function changeOf(history, id) {
  const c = history && history.changes ? history.changes[id] : null;
  return c ? { at: c.at, kind: c.kind, message: c.message } : null;
}

/**
 * 前端要的完整模型。mode 決定內容，history 決定「哪一筆是新的」。
 * 非作者模式不帶改動資訊：那是作者自己的工作面，commit 訊息也不該給外人看。
 */
export function buildReviewModel(data, { mode = 'author', volume = 1, history = null, title = '', generatedAt = '', repoSlug = '' } = {}) {
  const withHistory = mode === 'author' ? history : null;
  const filtered = filterData(data, { mode, volume });
  const entities = filtered.entities;
  const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
  const relations = validRelations(filtered.relations, byId);
  const chapters = sortChapters(filtered.chapters);
  const chapterById = Object.fromEntries(chapters.map((c) => [c.id, c]));
  const foreshadow = filtered.foreshadow;

  const relsOf = (id) => relations
    .filter((r) => r.sourceId === id || r.targetId === id)
    .map((r) => {
      const out = r.sourceId === id;
      const other = byId[out ? r.targetId : r.sourceId];
      return { id: r.id, dir: out ? 'out' : 'in', type: r.type || '關係', notes: r.notes || '', otherId: other ? other.id : null, other: other ? other.name : '（已刪除）' };
    });

  const original = Object.fromEntries((data.entities || []).map((e) => [e.id, e]));
  const types = [];
  for (const e of entities) {
    const t = e.type || '未分類';
    if (!types.includes(t)) types.push(t);
  }

  const entityModel = entities.map((e) => {
    const src = original[e.id] || e;
    const { sections, hidden } = visibleSections(src.notes, mode);
    return {
      id: e.id,
      name: e.name,
      type: e.type || '未分類',
      aliases: e.aliases || [],
      tags: e.tags || [],
      sections,
      hiddenSections: hidden,
      fields: (e.customFields || []).map((f) => ({ key: f.key, value: f.value })),
      visuals: (e.visuals || []).map((v) => ({ ...v })),
      relations: relsOf(e.id),
      foreshadow: foreshadow
        .filter((f) => (f.relatedEntityIds || []).includes(e.id))
        .map((f) => ({ id: f.id, title: f.title, status: f.status })),
      chapters: chapters
        .filter((c) => {
          const hay = `${c.title || ''}\n${c.summary || ''}\n${c.content || ''}`;
          return [e.name, ...(e.aliases || [])].some((n) => n && hay.includes(n));
        })
        .map((c) => ({ id: c.id, title: c.title, volume: c.volume })),
      debut: debutVolume(src, data.chapters || []),
      change: changeOf(withHistory, e.id),
    };
  });

  const relationModel = relations.map((r) => ({
    id: r.id,
    type: r.type || '關係',
    notes: r.notes || '',
    sourceId: r.sourceId,
    targetId: r.targetId,
    source: (byId[r.sourceId] || {}).name || '？',
    target: (byId[r.targetId] || {}).name || '？',
    change: changeOf(withHistory, r.id),
  }));

  const chapterModel = chapters.map((c) => ({
    id: c.id,
    volume: Number(c.volume) || 1,
    order: Number(c.order) || 0,
    title: c.title || '（未命名）',
    status: c.status || '未寫',
    wordCount: Number(c.wordCount) || 0,
    summary: c.summary || '',
    content: c.content || '',
    foreshadow: foreshadow
      .filter((f) => f.plantChapterId === c.id || f.recoverChapterId === c.id)
      .map((f) => ({ id: f.id, title: f.title, role: f.plantChapterId === c.id ? '埋' : '收' })),
    change: changeOf(withHistory, c.id),
  }));

  const foreshadowModel = foreshadow.map((f) => {
    const plant = chapterById[f.plantChapterId];
    const recover = chapterById[f.recoverChapterId];
    return {
      id: f.id,
      title: f.title,
      status: f.status || '埋設中',
      notes: f.notes || '',
      plant: plant ? { id: plant.id, title: plant.title, volume: plant.volume } : null,
      recover: recover ? { id: recover.id, title: recover.title, volume: recover.volume, status: recover.status } : null,
      overdue: isForeshadowOverdue(f, chapterById),
      entities: (f.relatedEntityIds || []).map((id) => (byId[id] || {}).name).filter(Boolean),
      change: changeOf(withHistory, f.id),
    };
  });

  const graph = buildGraphModel({ entities, relations, foreshadow, chapters, chatlogs: [] });

  return {
    mode,
    volume,
    title,
    repoSlug,
    generatedAt,
    modeLabel: MODE_LABEL[mode],
    types,
    entities: entityModel,
    relations: relationModel,
    chapters: chapterModel,
    foreshadow: foreshadowModel,
    graph,
    history: withHistory
      ? { commits: withHistory.commits, scanned: withHistory.scanned, oldest: withHistory.oldest, truncated: withHistory.truncated }
      : null,
    dropped: {
      entities: (data.entities || []).length - entityModel.length,
      relations: (data.relations || []).length - relationModel.length,
      chapters: (data.chapters || []).length - chapterModel.length,
      foreshadow: (data.foreshadow || []).length - foreshadowModel.length,
      sections: entityModel.reduce((n, e) => n + e.hiddenSections, 0),
    },
  };
}
