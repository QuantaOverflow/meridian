import assert from 'node:assert/strict';
import { assemble, makeWindows, validateWindowCache } from './direct-raw.mjs';

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
console.log(`ok: ${articles.length} articles covered by ${windows.length} overlapping windows; exact assembly and strict cache validation`);
