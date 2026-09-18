import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtures,requestFor,deterministicFields } from './minimal-fields.mjs';
test('minimal: source clauses and frozen verbs are grounded, synthetic is explicit',()=>{
  const data=fixtures();for(const f of data.slice(0,3)){assert.ok(f.text.includes(f.verb));assert.ok(f.text.includes(f.proposition));}
  assert.equal(data[3].origin,'synthetic-negation-control');
});
test('minimal: single-field prompt/schema do not ask for other outputs; repeat has identical model input',()=>{
  const f=fixtures()[0];const r=requestFor(f,['polarity']);assert.deepEqual(r.schema.required,['polarity']);assert.equal(r.prompt,requestFor(f,['polarity'],1).prompt);
  assert.ok(!r.prompt.includes('Classify ONLY the frozen explicit reporting verb'));
});
test('minimal: narrow code controls preserve negative consequence vs negation',()=>{
  assert.deepEqual(fixtures().map(deterministicFields),[
    {reportMode:'warn',eventState:'future',polarity:'positive'},
    {reportMode:'confirm',eventState:'completed',polarity:'positive'},
    {reportMode:'say',eventState:'future',polarity:'positive'},
    {reportMode:'say',eventState:'completed',polarity:'negative'}]);
});
