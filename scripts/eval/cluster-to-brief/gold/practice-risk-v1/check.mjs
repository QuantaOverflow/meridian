import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCluster, sentenceOf } from '../../lib.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const rows = name => read(name).trim().split('\n').map(line => JSON.parse(line));
const inputs = rows('inputs.jsonl');
const labels = rows('labels.jsonl');
const manifest = JSON.parse(read('manifest.json'));
const dev = [1, 7, 36, 37, 43];
assert.equal(inputs.length, 60);
assert.equal(labels.length, 60);
assert.equal(new Set(inputs.map(x => x.id)).size, 60);
assert.equal(new Set(inputs.map(x => x.text)).size, 60);
assert.equal(new Set(labels.map(x => x.id)).size, 60);
const clusters = new Map(dev.map(id => [id, loadCluster(id)]));
const byId = new Map(labels.map(x => [x.id, x]));
for (const input of inputs) {
  const label = byId.get(input.id);
  assert.ok(label);
  assert.ok(dev.includes(label.clusterId));
  assert.equal(label.split, 'practice');
  assert.ok(input.text.length);
  assert.equal(input.sources.length, input.evidence.length);
  assert.equal(label.expected === 'supported', label.errors.length === 0);
  for (const error of label.errors) {
    assert.ok(input.text.includes(error.claimSpan), `${input.id}: error span`);
    assert.ok(error.reason.length);
  }
  for (const [i, evidence] of input.evidence.entries()) {
    assert.deepEqual(input.sources[i], { articleId: evidence.articleId, sentence: evidence.sentence });
    assert.equal(sentenceOf(clusters.get(label.clusterId), evidence.articleId, evidence.sentence), evidence.text);
    assert.equal(createHash('sha256').update(evidence.text).digest('hex'), evidence.sha256);
  }
}
const pairIds = new Set(labels.map(x => x.pairId));
assert.equal(pairIds.size, 30);
for (const pairId of pairIds) {
  const pair = labels.filter(x => x.pairId === pairId);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map(x => x.expected).sort(), ['supported', 'unsupported']);
  assert.equal(pair[0].eventGroupId, pair[1].eventGroupId);
  const [a, b] = pair.map(l => inputs.find(x => x.id === l.id));
  assert.deepEqual(a.evidence, b.evidence);
}
const byCluster = Object.fromEntries(dev.map(id => [id, labels.filter(x => x.clusterId === id).length]));
for (const n of Object.values(byCluster)) assert.equal(n, 12);
assert.equal(manifest.cases, inputs.length);
assert.equal(manifest.eventGroups, new Set(labels.map(x => x.eventGroupId)).size);
assert.equal(manifest.errorSpans, labels.reduce((n, l) => n + l.errors.length, 0));
console.log(JSON.stringify({ structuralCheck: 'passed', cases: 60, pairs: 30, byCluster,
  eventGroups: manifest.eventGroups, errorSpans: manifest.errorSpans,
  semanticAccuracyMeasured: false, heldoutLoaded: false }, null, 2));
