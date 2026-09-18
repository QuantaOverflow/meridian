import test from 'node:test';
import assert from 'node:assert/strict';
import {chunks,choiceCatalog,processChoices} from './choice-gate.mjs';
const c={id:'test',text:'A false claim.',packet:{candidate:{sourceId:'candidate',text:'A false claim.'}},evidence:[{sourceId:'source1',text:'A different supported statement.'}]};
test('code creates bounded exact original spans with full text covered',()=>{
  const d={sourceId:'s',text:'A long original text with spaces. '.repeat(20)},r=chunks(d);
  assert.ok(r.length>1);for(const s of r){assert.equal(d.text.slice(s.start,s.end),s.exactText);assert.ok(s.exactText.length<=140);}
  for(let i=0;i<d.text.length;i++)if(!/\s/.test(d.text[i]))assert.ok(r.some(s=>s.start<=i&&s.end>i));
});
test('integer choices produce receipts, reject invalid indices and isolate siblings',()=>{
  const good={slot:2,status:'unsupported',errorChoice:1,evidenceChoices:[1],reason:'The detail is not established.'};
  const result=processChoices({results:[{...good,slot:1,evidenceChoices:[999]},good]},[c,{...c,id:'other'}]);
  assert.equal(result.results[0].route,'review');assert.match(result.results[0].errors[0],/999/);
  assert.equal(result.results[1].route,'block');assert.equal(result.results[1].quotes[0].exactText,c.evidence[0].text);
  assert.equal(result.results[1].semanticCertification,false);assert.equal(choiceCatalog(c).errors.length,1);
});
