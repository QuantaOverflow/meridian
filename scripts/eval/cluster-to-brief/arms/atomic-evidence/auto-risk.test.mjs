import assert from 'node:assert/strict';
import { CASES, planOk, tasksOf } from './auto-risk.mjs';
const plan = {
  results: CASES.map(c => ({
    id: c.id,
    questions: [{ claimSpan: c.text, question: 'Does the evidence support this assertion?' }],
  })),
};
assert.equal(planOk(plan), true);
assert.equal(tasksOf(plan).length, 4);
plan.results[0].questions[0].claimSpan = 'invented span';
assert.equal(planOk(plan), false);
console.log('auto-risk contract tests passed');
