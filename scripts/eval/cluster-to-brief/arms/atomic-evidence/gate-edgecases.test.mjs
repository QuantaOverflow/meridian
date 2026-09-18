import assert from 'node:assert/strict';
import { EDGE_CASES, buildEdgeAtoms, scoreEdgeCases } from './gate-edgecases.mjs';

const atoms = buildEdgeAtoms();
assert.equal(atoms.items.length, EDGE_CASES.length);

const gated = {
  results: EDGE_CASES.map(c => ({
    atomId: `${c.ref}a1`,
    checks: {
      identity: 'supported',
      action: c.expected === 'supported' ? 'supported' : 'unsupported',
      object: 'not_applicable',
      number: 'not_applicable',
      time: 'not_applicable',
      place: 'not_applicable',
      causality: 'not_applicable',
      modality: 'not_applicable',
      attribution: 'not_applicable',
    },
    unsupportedSpans: c.expected === 'supported' ? [] : [c.text.split(' ').slice(0, 2).join(' ')],
    uncertainSpans: [],
    supportingSourceIndexes: c.expected === 'supported' ? [1] : [],
    reason: 'synthetic result',
  })),
};
assert.equal(scoreEdgeCases(gated).pass, true);

gated.results.find(x => x.atomId === 'wrong-attributiona1').unsupportedSpans = [];
gated.results.find(x => x.atomId === 'wrong-attributiona1').checks.action = 'supported';
gated.results.find(x => x.atomId === 'wrong-attributiona1').supportingSourceIndexes = [1];
assert.equal(scoreEdgeCases(gated).pass, false);

console.log('atomic-evidence edge-case tests passed');
