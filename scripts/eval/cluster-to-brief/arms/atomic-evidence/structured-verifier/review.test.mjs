import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './comparator.mjs';
import { resolveQuote } from './contracts.mjs';

function quantity(value = '562', state = 'damaged') {
  return { family: 'scoped_quantity', nodes: [{ id: 'g', kind: 'population', ambiguous: false }, { id: 'report', kind: 'entity', ambiguous: false }], facts: [{ id: 'q', population: 'g', value, unit: 'areas', state, extent: 'total', reportSource: 'report', ambiguous: false, anchors: [] }], coverage: [{ factIds: ['q'], residualCode: 'none', span: {} }], needsContext: [] };
}
const alignment = () => ({ nodeLinks: [{ candidateNodeId: 'g', evidenceNodeId: 'g', relation: 'equivalent' }, { candidateNodeId: 'report', evidenceNodeId: 'report', relation: 'equivalent' }], factPairs: [{ candidateFactId: 'q', evidenceFactId: 'q', unresolved: false }] });
test('review: missing alignment never passes', () => { assert.equal(compare(quantity(), quantity(), { nodeLinks: [], factPairs: [] }).status, 'pending'); });
test('review: same value cannot rescue a mismatched damage state', () => {
  const r = compare(quantity('562', 'completely_destroyed'), quantity(), alignment());
  assert.equal(r.status, 'pending'); assert.ok(r.receipts.some(x => x.ruleId === 'same_measurement_state' && x.status === 'not_established'));
});
test('review: explicit unknown quantity state cannot pass by alignment equivalence', () => {
  assert.equal(compare(quantity('562', 'unknown'), quantity('562', 'unknown'), alignment()).status, 'pending');
});
test('review: blank business fields cannot become entailed', () => {
  const c = quantity(); const e = quantity(); c.facts[0].unit = ''; e.facts[0].unit = '';
  assert.equal(compare(c, e, alignment()).status, 'pending');
});
test('review: decimal formatting is deterministic, not semantic disagreement', () => {
  assert.equal(compare(quantity('562.0'), quantity('562'), alignment()).status, 'pass');
});
test('review: repeated exact text must be disambiguated, never first-match silently', () => {
  const docs = [{ sourceId: 's', text: 'A then A' }];
  assert.throws(() => resolveQuote({ sourceId: 's', exactText: 'A', occurrence: 0 }, docs));
  assert.equal(resolveQuote({ sourceId: 's', exactText: 'A', occurrence: 2 }, docs).start, 7);
});
