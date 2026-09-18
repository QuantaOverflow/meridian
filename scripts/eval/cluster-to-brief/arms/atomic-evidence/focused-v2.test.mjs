import assert from 'node:assert/strict';
import { assignAtomIds, normalizeAtoms } from './probe.mjs';
import { loadFocusedCases, makeAtomUnits } from './focused-v2.mjs';

const cases = loadFocusedCases();
assert.equal(cases.length, 8);
assert.equal(cases.filter(item => item.expected === 'mixed').length, 4);

const raw = {
  items: cases.map(item => ({
    parentRef: item.ref,
    atoms: [
      { text: item.text, sourceIndexes: [1] },
      { text: item.text, sourceIndexes: [1] },
    ],
  })),
};
const normalized = assignAtomIds(normalizeAtoms(raw, cases));
assert.ok(normalized.items.every(item => item.atoms.length === 1));
assert.deepEqual(
  normalized.items.map(item => item.atoms[0].sourceIndexes),
  cases.map(item => item.sources.map((_, i) => i + 1))
);
assert.equal(makeAtomUnits(cases, normalized).length, 8);

console.log('atomic-evidence focused-v2 tests passed');
