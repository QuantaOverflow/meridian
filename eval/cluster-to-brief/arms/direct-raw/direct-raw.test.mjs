import assert from 'node:assert/strict';
import { assemble, makeWindows, validateWindowCache, writeMaterial, stripMarkers, mustCover, repairCitations, contextOf } from './direct-raw.mjs';

const articles = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, title: `t${i + 1}`, publishDate: '2026-09-15', sourceId: null,
  sentences: [`sentence ${i + 1} ${'x'.repeat(70)}`],
}));
const windows = makeWindows(articles, 330, 1);
assert(windows.length > 1);
assert.deepEqual([...new Set(windows.flatMap(w => w.articleIds))].sort((a, b) => a - b), articles.map(a => a.id));
for (let i = 1; i < windows.length; i++) {
  assert(windows[i - 1].articleIds.some(id => windows[i].articleIds.includes(id)), 'adjacent windows overlap');
}

const candidates = [
  { id: 'w1c1', text: 'Exact candidate one.', sources: [{ articleId: 1, sentence: 1 }] },
  { id: 'w2c1', text: 'Exact candidate two.', sources: [{ articleId: 2, sentence: 1 }] },
];
const out = assemble(99, { verdict: 'written', reason: '', blocks: [{ title: 'Event', candidateIds: ['w2c1', 'w1c1'] }] }, candidates);
assert.deepEqual(out.blocks[0].sentences.map(s => s.text), ['Exact candidate two.', 'Exact candidate one.']);
assert.deepEqual(assemble(99, { verdict: 'not_a_single_event', reason: 'bag', blocks: [] }, candidates),
  { cluster: 99, verdict: 'not_a_single_event', reason: 'bag', blocks: [] });

const cacheWindow = windows[0];
const cachedCandidates = [{
  id: 'w1c1', topic: 'event', text: 'Evidence-bound sentence.',
  sources: [{ articleId: cacheWindow.articleIds[0], sentence: 1 }],
}];
const cache = {
  version: 1, cluster: 99, window: 1,
  articleIds: cacheWindow.articleIds, candidates: cachedCandidates,
};
const cluster = { articles };
assert.deepEqual(validateWindowCache(cache, 99, cacheWindow, cluster), cachedCandidates);
assert.throws(() => validateWindowCache({ ...cache, articleIds: [] }, 99, cacheWindow, cluster), /coverage/);
assert.throws(() => validateWindowCache({
  ...cache, candidates: [{ ...cachedCandidates[0], sources: [{ articleId: 999, sentence: 1 }] }],
}, 99, cacheWindow, cluster), /candidates\/references/);
assert.throws(() => validateWindowCache({
  ...cache, candidates: [{ ...cachedCandidates[0], id: 'wrong' }],
}, 99, cacheWindow, cluster), /candidate ids/);
const anchors = [{ id: 'w1a1', topic: 'event', sources: [{ articleId: cacheWindow.articleIds[0], sentence: 1 }] }];
const anchorCache = { version: 1, cluster: 99, window: 1, articleIds: cacheWindow.articleIds, anchors };
assert.deepEqual(validateWindowCache(anchorCache, 99, cacheWindow, cluster, 'anchor'), anchors);
assert.throws(() => validateWindowCache({ ...anchorCache, anchors: [{ ...anchors[0], id: 'w1c1' }] }, 99, cacheWindow, cluster, 'anchor'), /candidate ids/);
// 写作材料只含话题与原句，不含任何上一步写出的转述
assert.equal(writeMaterial(anchors, cluster), `### event\n[${cacheWindow.articleIds[0]}:1] ${articles[cacheWindow.articleIds[0] - 1].sentences[0]}`);
assert.equal(stripMarkers('Costs rose [986133:3, 1006787:2]. Then [12345:1] more.'), 'Costs rose. Then more.');
assert.equal(stripMarkers('Figure 3:2 stays [x].'), 'Figure 3:2 stays [x].');
{
  const src = (...ids) => ids.map(id => ({ articleId: id, sentence: 1 }));
  const A = [{ id: 'a', sources: src(1, 2, 3) }, { id: 'b', sources: src(4, 5, 6) }, { id: 'c', sources: src(7, 7) }, { id: 'd', sources: src(8) }];
  assert.deepEqual([...mustCover(A)], ['a', 'b']);                      // 最高档 3 篇
  assert.deepEqual([...mustCover([{ id: 'x', sources: src(1) }])], []); // 单篇报道不强制
}
{
  const arts = [{ id: 1, sentences: ['Oil hit $107 a barrel.', 'Analyst Jo Smith spoke.', 'He added "prices may rise further".'] },
                { id: 2, sentences: ['Oil rose sharply.'] }];
  const cl = { articles: arts };
  const pool = [{ articleId: 2, sentence: 1 }, { articleId: 1, sentence: 1 }, { articleId: 1, sentence: 3 }];
  const r = repairCitations([{ text: 'Oil rose to $107, and Smith said "prices may rise further".', sources: [{ articleId: 2, sentence: 1 }] }], pool, cl);
  assert.equal(r.added, 2);
  assert.deepEqual(r.sentences[0].sources.map(s => `${s.articleId}:${s.sentence}`), ['2:1', '1:1', '1:3']);
  const none = repairCitations([{ text: 'Oil hit $999.', sources: [{ articleId: 2, sentence: 1 }] }], pool, cl);
  assert.equal(none.added, 0);                                              // 找不到就不补
  assert.deepEqual(contextOf(cl, { articleId: 1, sentence: 3 }), { articleId: 1, sentence: 2 });
  assert.equal(contextOf(cl, { articleId: 1, sentence: 2 }), null);
}
console.log(`ok: ${articles.length} articles covered by ${windows.length} overlapping windows; exact assembly and strict cache validation`);
