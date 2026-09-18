import {readFileSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
const out=new URL('../../../out/atomic-evidence/expanded-dev-v0.16.1/',import.meta.url).pathname;
export function scoreExpanded(results,references,audit){
  if(audit.resultsHash!==hash(results)||audit.evaluator!=='main_codex_local_nonblind')throw Error('current local semantic review required');
  const rows=references.map(ref=>{
    const result=results.results.find(r=>r.id===ref.id),review=audit.cases.find(r=>r.id===ref.id);
    if(!result||!review||review.rawHash!==hash(result.raw)||!review.referenceReviewed)throw Error('missing/drifted per-case local review');
    return{...ref,result,review};
  });
  if(rows.length!==40||new Set(rows.map(r=>r.id)).size!==40)throw Error('all40 required');
  const bad=rows.filter(r=>r.expected==='unsupported'),good=rows.filter(r=>r.expected==='supported');
  const released=bad.filter(r=>r.result.route==='allow'),reviewErrors=bad.filter(r=>r.result.route==='review');
  const missedDiagnostic=bad.filter(r=>!r.review.injectedErrorIdentified),normalBlocked=good.filter(r=>r.result.route==='block');
  return{version:results.version,evaluation:'main_codex_local_nonblind_authored_development_controls',independent:false,heldoutLoaded:false,
    cases:rows.length,eventGroups:new Set(rows.map(r=>r.group)).size,errorSpans:bad.reduce((n,r)=>n+r.errors.length,0),
    releasedErrorRate:{n:released.length,total:bad.length,ids:released.map(r=>r.id)},
    directErrorDiagnosticMissRate:{n:missedDiagnostic.length,total:bad.length,ids:missedDiagnostic.map(r=>r.id),definition:'local review of error anchor and reason; review cases can diagnose but are not operational blocks'},
    erroneousCasesNotClearlyBlocked:{n:released.length+reviewErrors.length,total:bad.length},
    normalFalseBlockRate:{n:normalBlocked.length,total:good.length,ids:normalBlocked.map(r=>r.id)},
    normalReviewRate:{n:good.filter(r=>r.result.route==='review').length,total:good.length},
    reviewRate:{n:rows.filter(r=>r.result.route==='review').length,total:rows.length},
    routes:{allow:rows.filter(r=>r.result.route==='allow').length,block:rows.filter(r=>r.result.route==='block').length,review:rows.filter(r=>r.result.route==='review').length},
    finalContractFailures:rows.filter(r=>!r.result.contractValid).map(r=>({id:r.id,group:r.group,errors:r.result.errors})),
    repairs:results.repairs,cost:results.cost,
    resultsHash:hash(results),auditHash:hash(audit),perError:bad.map(r=>({id:r.id,group:r.group,risk:r.risk,errors:r.errors,route:r.result.route,identified:r.review.injectedErrorIdentified,note:r.review.note})),
    notes:['20 authored error cases, not population reliability or blind heldout evidence','single injected error phrase per event; not comparable to old multi-error32 denominators','model whole-claim gate remains semantic decision maker; no claim of complete decomposed-code semantic verification']};
}
if(process.argv[1]?.endsWith('/expanded-score.mjs')){
  const read=name=>JSON.parse(readFileSync(`${out}/${name}.json`));
  const score=scoreExpanded(read('results'),read('references'),read('local-audit'));
  atomicWriteJson(`${out}/scores.json`,score);console.log(JSON.stringify(score));
}
