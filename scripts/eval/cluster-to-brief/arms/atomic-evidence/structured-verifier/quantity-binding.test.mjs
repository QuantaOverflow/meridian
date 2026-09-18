import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareQuantities,extractQuantities} from './quantity-binding.mjs';
import {inputRows} from './context-store.mjs';
const check=text=>compareQuantities({sourceId:'synthetic-c',text},[{sourceId:'synthetic-e',text:'Some architectural elements were completely destroyed; the report identified 917 damaged areas.'}]);
test('quantity: separate destroyed keyword cannot relabel contiguous damaged total',()=>{
  const r=check('The report identified 917 completely destroyed areas.');assert.equal(r.status,'requires_local_review');assert.equal(r.receipts[0].evidence[0].state,'damaged');assert.equal(r.receipts[0].semanticPopulationIdentityVerified,false);
  assert.equal(check('The report identified 917 damaged areas.').receipts[0].status,'consistent');
});
test('quantity: original real normal and error differ only in bound state',()=>{
  for(const row of inputRows().filter(r=>r.id.startsWith('p20-'))){const r=compareQuantities({sourceId:'c',text:row.text},row.evidence.map((e,i)=>({sourceId:`e${i}`,text:e.text})));assert.equal(r.receipts.length,1);assert.equal(r.receipts[0].status,row.id.endsWith('-s')?'consistent':'state_not_established');}
});
test('quantity: conflicting bindings, negation, conditionals and approximate counts stay unresolved',()=>{
  const c={sourceId:'c',text:'917 completely destroyed areas.'};
  assert.equal(compareQuantities(c,[{sourceId:'e',text:'917 damaged areas and 917 completely destroyed areas.'}]).receipts[0].status,'unresolved');
  for(const prefix of ['Not','If','Only','About','More than','At least'])assert.equal(extractQuantities({sourceId:'s',text:`${prefix} 917 destroyed areas.`}).facts.length,0);
});
test('quantity: unknown populations/units/counts cannot be paired',()=>{
  assert.equal(check('917 destroyed vehicles.').status,'not_covered');assert.equal(check('918 destroyed areas.').receipts[0].status,'unresolved');
  assert.equal(check('917 destroyed elements.').receipts[0].status,'unresolved');
  assert.equal(extractQuantities({sourceId:'s',text:'91,7 destroyed areas.'}).facts.length,0);assert.equal(extractQuantities({sourceId:'s',text:'-917 destroyed areas.'}).facts.length,0);
});
