import assert from 'node:assert/strict';
import { loadCluster } from '../../lib.mjs';
import {
  atomCoverage,
  CASES,
  loadProbeCases,
  makeGateUnits,
  normalizeAtoms,
  sanitizeGateOutput,
  scoreProbe,
} from './probe.mjs';

const cases = loadProbeCases();
assert.deepEqual(
  cases.map(x => x.ref),
  CASES.map(x => x.ref)
);
assert.equal(cases.length, 8);
assert.ok(cases.every(x => x.sources.length > 0));

const atomized = {
  items: cases.map(x => ({
    parentRef: x.ref,
    atoms:
      x.expected === 'mixed'
        ? [
            { atomId: `${x.ref}a1`, text: 'Oil prices rose 2 percent.', sourceIndexes: [1] },
            { atomId: `${x.ref}a2`, text: 'An unsupported assertion.', sourceIndexes: [1] },
          ]
        : [{ atomId: `${x.ref}a1`, text: 'A supported assertion.', sourceIndexes: [1] }],
  })),
};
const gated = {
  results: atomized.items.flatMap(item =>
    item.atoms.map((a, i) => ({
      atomId: a.atomId,
      checks: {
        identity: 'supported',
        action: i === 0 ? 'supported' : 'unsupported',
        object: 'not_applicable',
        number: 'not_applicable',
        time: 'not_applicable',
        place: 'not_applicable',
        causality: 'not_applicable',
        modality: 'not_applicable',
        attribution: 'not_applicable',
      },
      unsupportedSpans: i === 0 ? [] : ['unsupported'],
      uncertainSpans: [],
      supportingSourceIndexes: i === 0 ? [1] : [],
      reason: i === 0 ? 'supported by the source' : 'not in the source',
    }))
  ),
};

const units = makeGateUnits(cases, atomized);
assert.ok(units.length >= cases.length);
assert.ok(
  units.every(u => {
    const keys = new Set(u.atomized.items[0].atoms.map(a => [...a.sourceIndexes].sort((a, b) => a - b).join(',')));
    return keys.size === 1 && keys.has(u.evidenceKey);
  })
);

// Avoid number grounding in this synthetic test: the number-bearing atom is only used when its
// source happens to contain 2. Replace it with source text wording when it does not.
for (const item of atomized.items) {
  if (item.atoms[0].text.includes('2 percent')) item.atoms[0].text = 'A supported assertion.';
}

const score = scoreProbe(cases, atomized, gated, loadCluster(36));
assert.equal(score.pass, true);
assert.equal(score.criteria.mixedAllRejectSomething, true);
assert.equal(score.criteria.controlsAllAccepted, true);

const broken = structuredClone(gated);
const bad = broken.results.find(x => x.atomId === 'b2s4a2');
bad.unsupportedSpans = [];
bad.checks.action = 'supported';
bad.supportingSourceIndexes = [1];
const brokenScore = scoreProbe(cases, atomized, broken, loadCluster(36));
assert.equal(brokenScore.pass, false);
assert.equal(brokenScore.results.find(x => x.ref === 'b2s4').pass, false);

const noisy = structuredClone(gated);
noisy.results[1].unsupportedSpans.push('text copied only from evidence');
const sanitized = sanitizeGateOutput(noisy, atomized);
assert.deepEqual(sanitized.results[1].unsupportedSpans, ['unsupported']);

const onlyNoise = structuredClone(gated);
onlyNoise.results[1].unsupportedSpans = ['text copied only from evidence'];
assert.deepEqual(sanitizeGateOutput(onlyNoise, atomized).results[1].unsupportedSpans, []);

const duplicateAtoms = {
  items: [
    {
      parentRef: 'x',
      atoms: [
        { text: 'A tanker struck a mine.', sourceIndexes: [1] },
        { text: '  A tanker struck a mine.  ', sourceIndexes: [2] },
      ],
    },
  ],
};
assert.deepEqual(normalizeAtoms(duplicateAtoms, [{ sources: [{}, {}] }]), {
  items: [{ parentRef: 'x', atoms: [{ text: 'A tanker struck a mine.', sourceIndexes: [1, 2] }] }],
});
assert.deepEqual(atomCoverage('A tanker struck a mine in Hormuz.', duplicateAtoms.items[0].atoms).missing, ['hormuz']);

console.log('atomic-evidence probe tests passed');
