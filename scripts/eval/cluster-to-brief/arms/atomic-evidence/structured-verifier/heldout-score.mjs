import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
export function binomialUpper95(k,n){
  if(!Number.isInteger(k)||!Number.isInteger(n)||n<1||k<0||k>n)throw Error('invalid denominator');
  if(k===n)return 1;
  // Upper endpoint of exact two-sided95% interval; illustrative iid assumption ONLY.
  const cdf=p=>{if(p===1)return 0;let term=(1-p)**n,sum=term;
    for(let i=1;i<=k;i++){term*=((n-i+1)/i)*p/(1-p);sum+=term;}return sum;};
  let lo=0,hi=1;for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(cdf(mid)>.025)lo=mid;else hi=mid;}return(lo+hi)/2;
}
export function scoreHeldout(results,refs,audit,plan){
  if(results.planHash!==hash(plan)||audit.resultsHash!==hash(results)||audit.evaluator!=='main_codex_local_nonblind')throw Error('frozen plan and current LOCAL semantic audit required');
  if(results.results.length!==60||refs.length!==60||audit.cases.length!==60||new Set(refs.map(r=>r.id)).size!==60||new Set(results.results.map(r=>r.id)).size!==60)throw Error('retain entire60 denominator');
  const rows=refs.map(ref=>{
    const r=results.results.find(x=>x.id===ref.id),a=audit.cases.find(x=>x.id===ref.id);
    if(!r||!a||!a.referenceReviewed||a.rawHash!==hash(r.raw))throw Error('missing or stale per-case review');
    if(ref.expected==='unsupported'&&typeof a.injectedErrorIdentified!=='boolean')throw Error('unknown does not count as detection');
    return{ref,r,a};
  });
  const bad=rows.filter(x=>x.ref.expected==='unsupported'),normal=rows.filter(x=>x.ref.expected==='supported');
  if(bad.length!==30||normal.length!==30||new Set(refs.map(r=>r.articleId)).size!==30||[28,51].some(k=>refs.filter(r=>r.cluster===k).length!==30))throw Error('preregistered composition changed');
  const rate=(selected,total)=>({n:selected.length,total,rate:selected.length/total,ids:selected.map(x=>x.ref.id)});
  const missed=bad.filter(x=>!x.a.injectedErrorIdentified),released=bad.filter(x=>x.r.route==='allow'),falseBlocked=normal.filter(x=>x.r.route==='block'),reviews=rows.filter(x=>x.r.route==='review');
  const target=plan.precommit.target;
  return{version:results.version,heldoutSourceLoaded:true,heldoutClusters:[28,51],sourcePreviouslyReserved:true,fullyIndependent:false,naturalErrorDistribution:false,
    evaluation:'main_codex_local_nonblind_authored_controls_from_heldout_sources',cases:60,articles:30,groups:30,independentEventCount:'unknown; only two source clusters, related events may overlap development',
    releasedErrorRate:rate(released,30),directErrorDiagnosticMissRate:rate(missed,30),normalFalseBlockRate:rate(falseBlocked,30),normalAllowRate:rate(normal.filter(x=>x.r.route==='allow'),30),reviewRate:rate(reviews,60),
    finalContractFailures:rows.filter(x=>!x.r.contractValid).map(x=>({id:x.ref.id,errors:x.r.errors})),
    modelBaselineWithoutFactors:{releasedErrorRate:rate(bad.filter(x=>x.r.baseline.route==='allow'),30),normalFalseBlockRate:rate(normal.filter(x=>x.r.baseline.route==='block'),30)},
    factorDiagnoses:rows.filter(x=>x.r.factorGuard.diagnoses.length).map(x=>({id:x.ref.id,expected:x.ref.expected,families:x.r.factorGuard.diagnoses.map(d=>d.family),routeBefore:x.r.baseline.route,routeAfter:x.r.route})),
    observedTargetMet:missed.length/30<target.directDiagnosticMissRateBelow&&falseBlocked.length/30<=target.normalFalseBlockRateAtMost&&normal.filter(x=>x.r.route==='allow').length/30>=target.normalAllowAtLeast&&reviews.length/60<=target.reviewRateAtMost,
    illustrativeIidUpperEndpoint95:{directMiss:binomialUpper95(missed.length,30),leak:binomialUpper95(released.length,30),scope:'exact two-sided binomial upper endpoint if30 trials were independent; NOT valid project population confidence because events/articles are related'},
    repairs:results.repairs,cost:results.cost,precommitHash:plan.precommitHash,planHash:hash(plan),resultsHash:hash(results),auditHash:hash(audit),
    perError:bad.map(x=>({id:x.ref.id,cluster:x.ref.cluster,articleId:x.ref.articleId,risk:x.ref.risk,errors:x.ref.errors,route:x.r.route,identified:x.a.injectedErrorIdentified,note:x.a.note})),
    byCluster:[28,51].map(cluster=>{const e=bad.filter(x=>x.ref.cluster===cluster),g=normal.filter(x=>x.ref.cluster===cluster);return{cluster,errors:e.length,misses:e.filter(x=>!x.a.injectedErrorIdentified).length,leaks:e.filter(x=>x.r.route==='allow').length,normalBlocks:g.filter(x=>x.r.route==='block').length,normalReviews:g.filter(x=>x.r.route==='review').length};}),
    notes:['Verifier matched frozen v0.19.1 before source reveal; no tuning or semantic retries after reveal','All60 retained including contract/review failures; labels excluded from requests; no remote judge','Labels authored locally after source reveal, so not independent blind evaluation or natural-error benchmark','No identical previous-version run on these heldout items; cannot causally attribute rate change to architecture or factor rules','c28/c51 consumed: never reuse as untouched heldout after any tuning on these results']};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const out=new URL('../../../out/atomic-evidence/heldout-v0.19.1/',import.meta.url).pathname,read=n=>JSON.parse(readFileSync(`${out}/${n}.json`));
  const s=scoreHeldout(read('results'),read('references'),read('local-audit'),read('plan'));atomicWriteJson(`${out}/scores.json`,s);
  console.log(JSON.stringify(s));
}
