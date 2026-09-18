import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from './context-store.mjs';
import {scoreExpanded} from './expanded-score.mjs';
test('score keeps all20 errors, separates review from release/block, and requires current per-case audit',()=>{
  const references=Array.from({length:40},(_,i)=>({id:`i${i}`,group:`g${i%20}`,expected:i<20?'unsupported':'supported',errors:i<20?[{span:'bad',reason:'test'}]:[]}));
  const results={version:'test_only',results:references.map((r,i)=>({id:r.id,raw:{status:r.expected},contractValid:i!==1&&i!==21,route:i===0?'allow':i===1||i===21?'review':i<20||i===20?'block':'allow'})),repairs:0,cost:{}};
  const audit={evaluator:'main_codex_local_nonblind',resultsHash:hash(results),cases:results.results.map((r,i)=>({id:r.id,rawHash:hash(r.raw),referenceReviewed:true, injectedErrorIdentified:i>1,note:'mock only'}))};
  const s=scoreExpanded(results,references,audit);
  assert.deepEqual([s.releasedErrorRate.n,s.releasedErrorRate.total],[1,20]);
  assert.deepEqual([s.directErrorDiagnosticMissRate.n,s.directErrorDiagnosticMissRate.total],[2,20]);
  assert.equal(s.erroneousCasesNotClearlyBlocked.n,2);assert.equal(s.normalFalseBlockRate.n,1);assert.equal(s.reviewRate.n,2);
  assert.throws(()=>scoreExpanded(results,references,{...audit,resultsHash:'old'}));
  assert.throws(()=>scoreExpanded(results,references,{...audit,cases:audit.cases.slice(1)}));
});
