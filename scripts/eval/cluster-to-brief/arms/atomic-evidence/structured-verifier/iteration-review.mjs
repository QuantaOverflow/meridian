import {readFileSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
import {scoreExpanded} from './expanded-score.mjs';
const observed={
  'factor-dev-v0.17':{hash:'b8b05c918ac70bb7f7b4a836b3219fa3943799cd189e949285c27aca0254cbf3',misses:{
    'maritime-area':'Supported despite km2/mi2 amount binding mutation.',
    'asean-negotiation':'Supported despite preferred multilateral/bilateral branch reversal.',
    'uk-sanction-scope':'Correct all-goods rejection but falsely says Ed Miliband absent from selected source; conservative faithful-diagnosis metric rejects this explanation.'}},
  'confirm-dev-v0.18':{hash:'047e9a4fd3575a4cac16cd8a3b8d56ed6862f614bc0fb55ec9eaffe063c69307',misses:{
    'coalition-damage-population':'Supported while reason repeats seven homes/two vehicles opposite candidate.',
    'maritime-agreement-actor':'Supported while reason repeats Thailand opposite candidate actor Cambodia.',
    'iran-assets-accounts':'Blocked but reason reverses correct240people/182accounts; does not faithfully diagnose candidate reversal.',
    'gulf-commitment-delivery':'Correctly rejects delivered stage, but falsely denies stated4trillion amount; conservative faithful-diagnosis metric rejects this explanation.'}},
  'binding-retest-v0.19.1':{hash:'90108a75742981d87c196eb5ecb66ecf6153198b38e16a455042f5d037aea861',regression:true,misses:{
    'gulf-commitment-delivery':'Delivery stage correctly rejected but stated total value falsely denied; remains an unfaithful explanation under conservative metric.'}},
};
export function saveReview(version,snapshot,misses,{regression=false}={}){
  const out=new URL(`../../../out/atomic-evidence/${version}/`,import.meta.url).pathname;
  const read=n=>JSON.parse(readFileSync(`${out}/${n}.json`));
  const results=read('results'),refs=read('references');
  if(hash(results)!==snapshot)throw Error('reviewed snapshot drift; fresh LOCAL review required');
  const audit={version,resultsHash:snapshot,evaluator:'main_codex_local_nonblind',independent:false,regression,
    contextSufficiencyReviewed:true,heldoutLoaded:false,remoteJudge:false,
    definition:'Conservative faithful diagnostic: correct injected-error diagnosis without contradictory factual explanation. Reviewed explicit narrow factor mismatch may independently diagnose, even if model reason fails. This is not independent semantic certification.',
    cases:refs.map(ref=>{const r=results.results.find(x=>x.id===ref.id);if(!r)throw Error('missing result');
      return{id:r.id,rawHash:hash(r.raw),referenceReviewed:true,injectedErrorIdentified:ref.expected==='unsupported'?!Object.hasOwn(misses,ref.group):null,
        note:ref.expected==='supported'?'Main Codex reviewed normal reference, source context and retained model output; no labels fed to tested route.':misses[ref.group]??'Main Codex read original context and retained diagnosis; identifies the registered error faithfully. Narrow factor receipts, when present, independently compared against original source.'};}),
  };
  const score=scoreExpanded(results,refs,audit);score.regression=regression;
  score.notes.push(audit.definition);
  atomicWriteJson(`${out}/local-audit.json`,audit);atomicWriteJson(`${out}/scores.json`,score);return score;
}
for(const [version,o] of Object.entries(observed)){
  const s=saveReview(version,o.hash,o.misses,{regression:o.regression??false});
  console.log({version,leak:s.releasedErrorRate,strictMiss:s.directErrorDiagnosticMissRate,normalBlocked:s.normalFalseBlockRate,review:s.reviewRate,cost:s.cost});
}
