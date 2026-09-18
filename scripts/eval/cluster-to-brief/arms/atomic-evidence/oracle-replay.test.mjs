import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOracleReplay } from './oracle-replay.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const result = buildOracleReplay(
  JSON.parse(readFileSync(`${ROOT}out/direct-raw/c36.json`, 'utf8')),
  JSON.parse(readFileSync(`${ROOT}out/direct-raw/verdict-c36.json`, 'utf8')),
  JSON.parse(readFileSync(`${ROOT}out/atomic-evidence/c36-probe-score-v6.json`, 'utf8'))
);

assert.equal(result.summary.oldCoreHit, 6);
assert.equal(result.summary.conservativeCoreHit, 6);
assert.deepEqual(result.summary.replacementCounts, {
  b2s4: 1,
  b2s6: 1,
  b2s8: 3,
  b3s10: 0,
});
const texts = result.brief.blocks.flatMap(b => b.sentences.map(s => s.text));
assert.ok(!texts.some(x => x.includes('about 35 million barrels')));
assert.ok(!texts.some(x => x.includes('originating from Iraq')));
assert.ok(!texts.some(x => x.includes('tanker El Gaia struck a sea mine')));

console.log('atomic-evidence oracle replay tests passed');
