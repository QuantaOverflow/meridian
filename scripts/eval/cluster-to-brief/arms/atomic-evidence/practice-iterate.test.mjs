import test from 'node:test';
import assert from 'node:assert/strict';
import { slotsOk, questionOf, plannerPrompt, gatePrompt, outputOk, ruleSlots } from './practice-iterate.mjs';

const cases=[{id:'item01',text:'Iran said prices rose after the attack.',evidence:[{text:'Iran said prices rose after the attack.'}]}];
const plan={results:[{id:'item01',slots:[{kind:'time',span:'after the attack'}]}]};
test('rejects invented anchors, unknown types and duplicates',()=>{
  assert.equal(slotsOk(plan,cases),true);
  for(const slots of [[{kind:'time',span:'because of the attack'}],[{kind:'truth',span:'Iran'}],[...plan.results[0].slots,...plan.results[0].slots],[]])
    assert.equal(slotsOk({results:[{id:'item01',slots}]},cases),false);
});
test('time template audits direction without requiring causal support',()=>{
  const q=questionOf(plan.results[0].slots[0]);
  assert.ok(q.includes('temporal direction'));
  assert.ok(q.includes('Do not add causality'));
  assert.ok(q.includes('after the attack'));
});
test('attribution template retains reported speech scope',()=>{
  assert.ok(questionOf({kind:'attribution',span:'Iran said'}).includes('does not require P itself to be independently true'));
  assert.ok(gatePrompt('slots',cases,plan).includes('full claim’s attribution scope'));
});
test('model prompts contain no training labels or answer-bearing ids',()=>{
  const example={...cases[0],originalId:'p01-u',label:{expected:'unsupported',reason:'SECRET_REFERENCE'}};
  for(const prompt of [plannerPrompt([example]),gatePrompt('baseline',[example]),gatePrompt('slots',[example],plan)]){
    assert.ok(!prompt.includes('p01-u'));assert.ok(!prompt.includes('SECRET_REFERENCE'));
  }
});
test('supported output requires exact evidence quotes and aligned slot coverage',()=>{
  const output={results:[{id:'item01',checks:[{dimension:'time',claimSpan:'after the attack',status:'supported',quotes:[{sourceIndex:1,text:'prices rose after the attack'}],reason:'explicit'}]}]};
  assert.equal(outputOk(output,cases,plan),true);
  const bad=structuredClone(output);bad.results[0].checks[0].quotes[0].text='prices rose because of the attack';
  assert.equal(outputOk(bad,cases,plan),false);
  const missing=structuredClone(output);missing.results[0].checks=[];
  assert.equal(outputOk(missing,cases,plan),false);
  const swapped=structuredClone(output);swapped.results[0].checks[0].dimension='causality';
  assert.equal(outputOk(swapped,cases,plan),false);
});
test('rule router retains whole claim and does not turn temporal order into cause',()=>{
  const text='Prices rose after the ship was attacked.';
  const slots=ruleSlots(text);
  assert.deepEqual(slots[0],{kind:'whole_claim',span:text});
  assert.ok(slots.some(s=>s.kind==='time'));
  assert.ok(!slots.some(s=>s.kind==='causality'));
  assert.ok(!slots.some(s=>s.kind==='attribution'));
});
test('rule router selects epistemic, attribution and quantity checks without labels',()=>{
  const text='Analysts confirmed that 562 areas had already been destroyed.';
  const slots=ruleSlots(text);
  for(const kind of ['modality','attribution','quantity','action']) assert.ok(slots.some(s=>s.kind===kind));
  assert.equal(slotsOk({results:[{id:'item01',slots}]},[{id:'item01',text}]),true);
});
