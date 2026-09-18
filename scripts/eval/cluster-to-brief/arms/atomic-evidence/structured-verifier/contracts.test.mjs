import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, VERSION, ContextStore, freezePlan } from './context-store.mjs';
import { validateExtraction, validateAlignment, resolveQuote } from './contracts.mjs';
import { extractionRequest } from './interfaces.mjs';
const docs = [{ sourceId: 'candidate', text: 'A warned of risk.' }];
const anchor = { sourceId: 'candidate', exactText: docs[0].text, occurrence: 0 };
function raw() {
  return structuredClone({ version: VERSION, family: 'speech', sourceHash: hash(docs), nodes: [{ id: 'a', kind: 'entity', label: 'A', anchors: [anchor], ambiguous: false }, { id: 'p', kind: 'event', label: 'risk', anchors: [anchor], ambiguous: false }], facts: [{ id: 'f', speaker: 'a', recipient: '', proposition: 'p', reportMode: 'warn', polarity: 'positive', eventState: 'future', anchors: [anchor], ambiguous: false }], coverage: [{ span: anchor, factIds: ['f'], residualCode: 'none' }], needsContext: [] });
}
test('contracts: source hash, kind references and outside quotes are checked', () => {
  assert.ok(validateExtraction(raw(), 'speech', docs));
  for (const mutate of [r => { r.sourceHash = 'wrong'; }, r => { r.facts[0].speaker = 'p'; }, r => { r.nodes[0].anchors = [{ ...anchor, sourceId: 'outside' }]; }]) {
    const r = raw(); mutate(r); assert.throws(() => validateExtraction(r, 'speech', docs));
  }
});
test('contracts: unsupported fields/verdicts and undeclared context requests are rejected', () => {
  const r = raw(); r.status = 'supported'; assert.throws(() => validateExtraction(r, 'speech', docs));
  const q = raw(); q.needsContext = [{ sourceId: 'outside', reasonCode: 'coreference' }]; assert.throws(() => validateExtraction(q, 'speech', docs));
});
test('contracts: coverage gaps and overlaps fail without pretending semantic certification', () => {
  const r = raw(); r.coverage[0].span.exactText = 'A'; assert.throws(() => validateExtraction(r, 'speech', docs));
  const q = raw(); q.coverage.push(q.coverage[0]); assert.throws(() => validateExtraction(q, 'speech', docs));
  assert.equal(validateExtraction(raw(), 'speech', docs).semanticCoverageVerified, false);
});
test('contracts: alignment cannot edit graph fields or reference absent nodes', () => {
  const c = validateExtraction(raw(), 'speech', docs);
  const a = { nodeLinks: [], factPairs: [] };
  assert.ok(validateAlignment(a, c, c, docs));
  assert.throws(() => validateAlignment({ ...a, repairedCandidate: c }, c, c, docs));
  assert.throws(() => validateAlignment({ ...a, nodeLinks: [{ candidateNodeId: 'missing', evidenceNodeId: 'p', relation: 'equivalent', anchors: [anchor] }] }, c, c, docs));
});
test('context: registered source tools reject arbitrary targets and over-budget text', () => {
  const plan = freezePlan(); const s = plan.inventory[0];
  const row = { text: s.context.candidate.text, sources: s.context.evidence.filter(x => x.coordinate).map(x => x.coordinate), evidence: s.context.evidence.map(x => ({ ...x.coordinate, text: x.text, sha256: x.sha256 })) };
  const store = new ContextStore(row);
  assert.throws(() => store.getSourceWindow(123, 1, 1));
  const id = row.sources[0].articleId;
  assert.throws(() => store.getSourceWindow(id, 0, 1));
  assert.throws(() => new ContextStore(row, { maxChars: 1 }).packet(), /context_overflow/);
  const drift = structuredClone(row); drift.evidence[0].sha256 = 'wrong'; assert.throws(() => new ContextStore(drift));
});
test('requests: independently extracted sides contain neither references nor sibling candidate', () => {
  const plan = freezePlan();
  for (const item of plan.smoke) {
    const c = extractionRequest(item.family, [item.packet.candidate], 'candidate').prompt;
    const e = extractionRequest(item.family, item.packet.evidence, 'evidence').prompt;
    assert.ok(!c.includes('EVIDENCE_GRAPH')); assert.ok(!e.includes(item.packet.candidate.text));
    for (const req of [c, e]) for (const forbidden of ['p11-s', 'p11-u', 'p12-s', 'p12-u', 'p20-s', 'p20-u', 'referenceReason', 'expected', 'registeredResidual']) assert.ok(!req.includes(forbidden), forbidden);
  }
});
test('quote: offsets mechanically resolve exact unique substrings', () => { assert.deepEqual(resolveQuote({ sourceId: 'candidate', exactText: 'warned', occurrence: 0 }, docs).start, 2); });
