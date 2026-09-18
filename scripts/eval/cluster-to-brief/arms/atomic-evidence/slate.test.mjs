import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVerifiedSlate, loadSlateCases } from './slate.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const cases = loadSlateCases();
assert.equal(cases.length, 30);
assert.equal(cases.filter(x => x.expected === 'mixed').length, 4);

const score = {
  results: cases.map(c => ({
    ref: c.ref,
    atoms: [{ text: c.text, sources: c.sources, verdict: 'supported' }],
  })),
};
const original = JSON.parse(readFileSync(`${ROOT}out/direct-raw/c36.json`, 'utf8'));
assert.deepEqual(buildVerifiedSlate(original, score), original);

console.log('atomic-evidence slate tests passed');
