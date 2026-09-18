import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oracleCases } from './oracle.mjs';
import { compare } from './comparator.mjs';
import { canonicalDecimal } from './numeric.mjs';
const cases = new Map(oracleCases().map(c => [c.originalId, c]));
test('oracle: reporter/speaker swap has explicit mismatched role', () => {
  const r = cases.get('p11-u').comparison;
  assert.equal(r.status, 'conflict'); assert.equal(r.receipts.filter(x => x.ruleId === 'speaker_edge' && x.status === 'explicit_conflict').length, 2);
});
test('oracle: future warning does not establish completed confirmation', () => {
  const r = cases.get('p12-u').comparison;
  assert.equal(r.status, 'pending');
  for (const field of ['reportMode', 'eventState']) assert.ok(r.receipts.some(x => x.ruleId === `same_report_${field}` && x.status === 'not_established'));
});
test('oracle: damaged count cannot be joined to destroyed state', () => {
  const r = cases.get('p20-u').comparison;
  assert.equal(r.status, 'pending'); assert.ok(r.receipts.some(x => x.ruleId === 'same_measurement_state' && x.status === 'not_established'));
});
test('oracle: normal represented relations retained; unsupported qualifiers stay pending', () => {
  assert.equal(cases.get('p12-s').comparison.status, 'pass');
  for (const id of ['p11-s', 'p20-s']) { const r = cases.get(id).comparison; assert.equal(r.status, 'pending'); assert.ok(r.receipts.every(x => x.status === 'entailed')); assert.ok(r.residual.length); }
});
test('oracle: uncovered second report is not silently ignored when declared', () => {
  const { candidate: c, evidence: e, alignment: a } = cases.get('p11-s');
  const candidate = structuredClone(c); candidate.facts = candidate.facts.slice(0, 1);
  candidate.coverage = candidate.coverage.map(x => ({ ...x, factIds: ['f0'], residualCode: 'other_family' }));
  assert.equal(compare(candidate, e, a).status, 'pending');
});
test('negative control: character coverage cannot prove semantic completeness', () => {
  const { candidate: c, evidence: e, alignment: a } = cases.get('p11-s');
  const candidate = structuredClone(c); candidate.facts = candidate.facts.slice(0, 1);
  candidate.coverage = candidate.coverage.map(x => ({ ...x, factIds: ['f0'], residualCode: 'none' }));
  const r = compare(candidate, e, a);
  assert.equal(r.status, 'pass'); assert.equal(r.semanticCoverageVerified, false);
  // Deliberate known blind spot: a converter falsely accounting for a whole sentence
  // can still omit a proposition. Only independent source review detects this.
});
test('oracle: unresolved or multiply aligned object never passes', () => {
  const { candidate: c, evidence: e, alignment: a } = cases.get('p12-s');
  const alignment = structuredClone(a); alignment.factPairs.push(alignment.factPairs[0]);
  assert.equal(compare(c, e, alignment).status, 'pending');
});
test('exact numeric normalization retains huge decimal precision', () => {
  assert.equal(canonicalDecimal('000,562.000'), '562');
  assert.equal(canonicalDecimal('9007199254740993.00100'), '9007199254740993.001');
  assert.notEqual(canonicalDecimal('9007199254740993'), canonicalDecimal('9007199254740992'));
  assert.throws(() => canonicalDecimal('56,2')); assert.throws(() => canonicalDecimal('5e2'));
});
