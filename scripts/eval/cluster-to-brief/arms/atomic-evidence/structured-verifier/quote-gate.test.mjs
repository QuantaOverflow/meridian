import test from 'node:test';
import assert from 'node:assert/strict';
import {bindQuote,processGateBatch,quoteGateRequest,replayLegacyBinding} from './quote-gate.mjs';
const cases=[{id:'a',text:'X completed work.',evidence:[{sourceId:'e1',text:'X planned work.'}]},{id:'b',text:'Y did work.',evidence:[{sourceId:'e2',text:'Y did work.'}]}];
const valid={slot:2,status:'supported',errorSpan:'',quotes:['Y did work.'],reason:'Exact report.'};
test('code binds exact quotes, preserves receipts and refuses absent/ambiguous sources',()=>{
  assert.equal(bindQuote('planned',cases[0].evidence).sourceIndex,1);
  assert.throws(()=>bindQuote('missing',cases[0].evidence),/matchingSourceIndexes/);
  assert.throws(()=>bindQuote('planned',[...cases[0].evidence,...cases[0].evidence]),/exactly one/);
  assert.throws(()=>bindQuote('x'.repeat(151),cases[0].evidence));
});
test('one bad item cannot discard sibling; errors contain actual bad quote',()=>{
  const r=processGateBatch({results:[{slot:1,status:'unsupported',errorSpan:'completed',quotes:['invented'],reason:'Bad.'},valid]},cases);
  assert.equal(r.results[0].route,'review');assert.match(r.results[0].errors[0],/invented/);assert.equal(r.results[1].route,'allow');
  assert.equal(r.results[1].semanticCertification,false);
});
test('slots handle reordering, isolate duplicates and omissions; error anchors must exist',()=>{
  assert.equal(processGateBatch({results:[valid]},cases).results[1].route,'allow');
  assert.equal(processGateBatch({results:[valid,valid]},cases).results[1].route,'review');
  const r=processGateBatch({results:[{slot:1,status:'unsupported',errorSpan:'foo',quotes:['planned'],reason:'Bad.'},valid]},cases);
  assert.match(r.results[0].errors[0],/foo/);
});
test('new interface omits generated source indices/claim copies; feedback includes actual failures',()=>{
  const r=quoteGateRequest(cases,{errors:['missing quote foo'],raw:{slot:1}});
  assert.ok(!Object.hasOwn(r.schema.properties.results.items.properties,'sourceIndex'));
  assert.match(r.prompt,/missing quote foo/);
});
test('historical wrong source index is mechanically corrected but not semantically certified',()=>{
  const r=replayLegacyBinding({results:[{id:'a',checks:[{dimension:'whole_claim',claimSpan:cases[0].text,status:'unsupported',quotes:[{sourceIndex:99,text:'planned'}]}]}]},[cases[0]]);
  assert.equal(r[0].contractValid,true);assert.equal(r[0].quotes[0].sourceIndex,1);assert.equal(r[0].quotes[0].modelSourceIndex,99);
});
