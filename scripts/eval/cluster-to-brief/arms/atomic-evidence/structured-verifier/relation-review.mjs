import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {hash} from './context-store.mjs';
import {atomicWriteJson} from '../probe.mjs';
export function finalizeLocalReview(data,audit){
  if(audit.artifactHash!==hash(data)||audit.evaluator!=='main_codex_local_nonblind')throw Error('local review artifact/evaluator mismatch');
  const cases=data.results.map(c=>{
    const reports=c.reports.map(r=>{
      const review=audit.pairs.find(a=>a.candidateActId===r.candidate.id&&a.proposalHash===r.pair.proposalHash);
      const needed=Object.values(r.comparison.identityProvenance??{}).filter(i=>i.resolutionActId).map(i=>i.resolutionActId);
      const identitiesReviewed=needed.every(id=>audit.resolutions.some(a=>a.actId===id&&a.proposalHash===hash(data.resolutions[id])&&a.accepted===true));
      const reviewed=review?.accepted===true&&review.speakerIdentityReviewed===true&&identitiesReviewed;
      const status=reviewed?r.comparison.provisionalStatus:'pending';
      return{...r,comparison:{...r.comparison,status,localReview:{reviewed,pairAccepted:review?.accepted??null,identitiesReviewed},semanticCoverageVerified:false}};
    });
    const establishedMismatch=reports.some(r=>r.comparison.status==='not_supported');
    return{...c,reports,wholeClaimVerdict:establishedMismatch?'not_supported_in_registered_evidence':'pending',coverageVerified:false,reason:establishedMismatch?'reviewed_report_relation_not_established':'complete_semantic_coverage_or_fields_not_verified'};
  });
  return{version:data.version,evaluation:audit.evaluator,results:cases,cost:data.cost,coverageVerified:false,note:'Nonblind known-development diagnostic; local review is required for semantic pairing and identities. No independent reliability score or general truth verdict.'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const root=new URL(`../../../out/atomic-evidence/${process.argv.includes('--arguments')?'argument-router-v0.13':'relation-chain-v0.11'}/`,import.meta.url);
  const data=JSON.parse(readFileSync(new URL('results.json',root))),audit=JSON.parse(readFileSync(new URL('local-audit.json',root)));
  const result=finalizeLocalReview(data,audit);atomicWriteJson(new URL('reviewed-results.json',root).pathname,result);
  console.log(JSON.stringify(result.results.map(c=>({id:c.id,verdict:c.wholeClaimVerdict,reports:c.reports.map(r=>({id:r.candidate.id,status:r.comparison.status,review:r.comparison.localReview,receipts:r.comparison.receipts.map(a=>({field:a.field,status:a.status}))}))})),null,2));
}
