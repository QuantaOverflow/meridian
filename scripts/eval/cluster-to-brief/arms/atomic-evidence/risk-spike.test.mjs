import assert from 'node:assert/strict';
import { cleanQuoteEllipses, validOutput } from './risk-spike.mjs';
const cases = [{ id: 'x', text: 'A tanker sank.' }];
const evidence = [['A tanker sank yesterday.']];
const result = {
  results: [
    { id: 'x', checks: [{ claimSpan: 'tanker', status: 'supported', quotes: [{ sourceIndex: 1, text: 'tanker' }] }] },
  ],
};
assert.equal(validOutput(result, cases, evidence), true);
const bad = structuredClone(result);
bad.results[0].checks[0].quotes[0].text = 'El Gaia';
assert.equal(validOutput(bad, cases, evidence), false);
const empty = structuredClone(result);
empty.results[0].checks[0].quotes = [];
assert.equal(validOutput(empty, cases, evidence), false);
const dots = structuredClone(result);
dots.results[0].checks[0].quotes[0].text = '...tanker';
assert.equal(validOutput(cleanQuoteEllipses(dots, evidence), cases, evidence), true);
assert.equal(validOutput(cleanQuoteEllipses(bad, evidence), cases, evidence), false);
console.log('risk-spike contract tests passed');
