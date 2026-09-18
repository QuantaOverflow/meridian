import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inputRows,ContextStore,hash} from './context-store.mjs';
import {finalizeLocalReview} from './relation-review.mjs';
import {compareQuantities} from './quantity-binding.mjs';
import {atomicWriteJson} from '../probe.mjs';
export const SCORE_VERSION='full-practice-v0.14';
const ROOT=new URL('../../../',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,ROOT),'utf8'));
export function buildReplay(){
  const inputs=inputRows(),legacy=read('out/atomic-evidence/practice-v1/baseline-summary.json');
  const structuredRaw=read('out/atomic-evidence/argument-router-v0.13/results.json'),structuredAudit=read('out/atomic-evidence/argument-router-v0.13/local-audit.json');
  const structured=finalizeLocalReview(structuredRaw,structuredAudit),known=new Map(structured.results.map(c=>[c.id,c]));
  const cases=inputs.map(row=>{
    // No labels/risk fields enter the routing or quantity comparator.
    new ContextStore(row); // Verify registered fixture coordinates/hashes.
    const b=legacy.details.find(d=>d.id===row.id);
    if(!b||b.text!==row.text||hash(b.evidence)!==hash(row.evidence))throw Error('legacy_input_drift');
    const q=compareQuantities({sourceId:`candidate:${hash(row.text).slice(0,12)}`,text:row.text},row.evidence.map(e=>({sourceId:`source-${e.articleId}-${e.sentence}`,text:e.text})));
    const s=known.get(row.id);
    if(s){
      // Bind all reused report candidate spans to the exact current text.
      for(const r of s.reports)for(const [k,span] of Object.entries(r.candidate.spans).filter(([k])=>k!=='speakerResolved'))if(row.text.slice(span.start,span.end)!==span.exactText)throw Error('structured_candidate_drift');
    }
    const relationBlock=s?.wholeClaimVerdict==='not_supported_in_registered_evidence';
    const bindingPending=q.receipts.some(r=>r.status==='state_not_established');
    return{id:row.id,textHash:hash(row.text),evidenceHash:hash(row.evidence),legacy:{contractValid:b.contractValid,admitted:b.contractValid?b.admitted:null},structured:s??null,quantity:q,
      decision:relationBlock?'diagnosed_block':b.contractValid&&!b.admitted?'legacy_whole_block':bindingPending?'quantity_review':!b.contractValid?'contract_review':'coverage_review'};
  });
  return{version:SCORE_VERSION,cases,additionalRemoteCalls:0,scope:'replay historical real baseline plus limited reviewed relation modules; not a fresh whole-prototype run',inputHash:hash(inputs),structuredHash:hash(structuredRaw)};
}
export function scoreReplay(data,labels,quantityAudit=null){
  if(quantityAudit&&(quantityAudit.artifactHash!==hash(data)||quantityAudit.evaluator!=='main_codex_local_nonblind'))throw Error('quantity audit drift');
  const frozenInputs=new Map(inputRows().map(r=>[r.id,r]));
  if(new Set(data.cases.map(c=>c.id)).size!==data.cases.length||new Set(labels.map(l=>l.id)).size!==labels.length)throw Error('duplicate_case_or_label');
  const scored=data.cases.map(c=>{
    const label=labels.find(l=>l.id===c.id);if(!label||label.errors.some(e=>!frozenInputs.get(c.id)?.text.includes(e.claimSpan)))throw Error('label/claim drift');
    const qAudit=quantityAudit?.reviews.find(a=>a.caseId===c.id&&a.quantityHash===hash(c.quantity));
    const quantityBlock=qAudit?.accepted===true&&c.quantity.receipts.some(r=>r.status==='state_not_established');
    const decision=c.decision==='diagnosed_block'?'diagnosed_block':quantityBlock?'quantity_diagnosed_block':c.decision;
    const blocked=['diagnosed_block','quantity_diagnosed_block','legacy_whole_block'].includes(decision);
    const overlay=blocked?'block':!c.legacy.contractValid||decision==='quantity_review'?'review':'legacy_allow';
    const strict=blocked?'block':'review'; // No full semantic coverage certificate exists.
    return{...c,decision,overlay,strict,label};
  });
  const perError=scored.flatMap(c=>c.label.errors.map((e,i)=>({id:`${c.id}:e${i+1}`,caseId:c.id,claimSpan:e.claimSpan,risk:e.risk,legacy:c.legacy.admitted===true?'leaked':c.legacy.admitted===false?'whole_blocked':'contract_review',overlay:c.overlay==='legacy_allow'?'leaked':c.overlay==='review'?'review':c.decision==='legacy_whole_block'?'legacy_whole_blocked':'diagnosed_case_blocked',strict:c.strict==='review'?'review':c.decision==='legacy_whole_block'?'legacy_whole_blocked':'diagnosed_case_blocked',note:'Whole-case blocking removes the original span; not proof each span was independently diagnosed.'})));
  const policyCounts=policy=>({allowed:scored.filter(c=>c[policy]==='legacy_allow').length,blocked:scored.filter(c=>c[policy]==='block').length,review:scored.filter(c=>c[policy]==='review').length,errorsLeaked:perError.filter(e=>e[policy]==='leaked').length,errorsReview:perError.filter(e=>e[policy]==='review').length,normalsBlocked:scored.filter(c=>c.label.expected==='supported'&&c[policy]==='block').length});
  const decisions=Object.fromEntries([...new Set(scored.map(c=>c.decision))].map(d=>[d,scored.filter(c=>c.decision===d).length]));
  return{version:data.version,additionalRemoteCalls:0,cases:scored,perError,summary:{totalCases:scored.length,totalErrors:perError.length,blockOriginsAndReview:decisions,legacy:{errorsLeaked:perError.filter(e=>e.legacy==='leaked').length,errorContractReview:perError.filter(e=>e.legacy==='contract_review').length},overlay:policyCounts('overlay'),strict:policyCounts('strict')},caveats:['Known development replay; targeted repairs use observed errors, no independent reliability score.','Overlay inherits unverified legacy allowances outside new-module coverage; strict releases nobody.','Unknown/contract failures are review, not successful semantic error detection.','Whole-case blockage differs from per-error diagnosis; labels used only after routing.']};
}
export function runFullReplay(){
  const out=new URL(`out/atomic-evidence/${SCORE_VERSION}/`,ROOT).pathname;mkdirSync(out,{recursive:true});const data=buildReplay();atomicWriteJson(`${out}/routing.json`,data);
  const labels=readFileSync(new URL('gold/practice-risk-v1/labels.jsonl',ROOT),'utf8').trim().split('\n').map(JSON.parse);
  let audit=null;try{audit=JSON.parse(readFileSync(`${out}/quantity-audit.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
  const scored=scoreReplay(data,labels,audit);atomicWriteJson(`${out}/scores.json`,scored);
  console.log(JSON.stringify({routingHash:hash(data),summary:scored.summary,quantityCases:data.cases.filter(c=>c.quantity.receipts.length).map(c=>({id:c.id,hash:hash(c.quantity),receipts:c.quantity.receipts}))},null,2));return scored;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runFullReplay();
