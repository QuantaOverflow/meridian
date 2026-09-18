import test from 'node:test';
import assert from 'node:assert/strict';
import {binomialUpper95,scoreHeldout} from './heldout-score.mjs';
import {hash} from './context-store.mjs';
test('exact binomial upper endpoint is descriptive iid hypothetical, not zero after no misses',()=>{
  assert.ok(Math.abs(binomialUpper95(0,30)-(1-.025**(1/30)))<1e-12);
  assert.ok(binomialUpper95(0,30)>.1);assert.ok(binomialUpper95(1,30)>binomialUpper95(0,30));
  assert.equal(binomialUpper95(30,30),1);assert.throws(()=>binomialUpper95(0,0));
});
test('heldout keeps unknown in error denominator; blocked is not synonymous with faithful diagnosis',()=>{
  const plan={precommitHash:'p',precommit:{target:{directDiagnosticMissRateBelow:.1,normalFalseBlockRateAtMost:.1,normalAllowAtLeast:.75,reviewRateAtMost:.25}}};
  const refs=Array.from({length:60},(_,i)=>({id:`i${i}`,articleId:Math.floor(i/2),cluster:i<30?28:51,expected:i%2?'unsupported':'supported',errors:i%2?[{span:'bad'}]:[]}));
  const results={planHash:hash(plan),results:refs.map(ref=>{const route=ref.id==='i1'?'review':ref.expected==='unsupported'?'block':'allow';return{id:ref.id,raw:{status:route},route,contractValid:route!=='review',errors:[],baseline:{route},factorGuard:{diagnoses:[]}};})};
  const audit={resultsHash:hash(results),evaluator:'main_codex_local_nonblind',cases:results.results.map(r=>({id:r.id,rawHash:hash(r.raw),referenceReviewed:true,injectedErrorIdentified:r.id!=='i1'&&r.id!=='i3'}))};
  const s=scoreHeldout(results,refs,audit,plan);assert.equal(s.directErrorDiagnosticMissRate.n,2);assert.equal(s.directErrorDiagnosticMissRate.total,30);assert.equal(s.releasedErrorRate.n,0);assert.equal(s.reviewRate.n,1);
  assert.throws(()=>scoreHeldout({...results,results:results.results.slice(1)},refs,audit,plan));
});
