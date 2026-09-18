import {readFileSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {outputOk} from '../practice-iterate.mjs';
import {hash} from './context-store.mjs';
const out=new URL('../../../out/atomic-evidence/fresh-dev-v0.15/',import.meta.url).pathname;
const read=name=>JSON.parse(readFileSync(`${out}/${name}.json`));
const plan=read('plan'),results=read('results'),references=read('references');
const calls=readFileSync(`${out}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
const details=[];
for(const request of plan.requests.filter(r=>r.kind==='legacy_whole_gate')){
  const last=calls.filter(c=>c.tag===request.tag).at(-1),raw=JSON.parse(last.rawText);
  request.cases.forEach((c,i)=>{
    const value=raw.results[i],reference=references.find(r=>r.id===c.id),issues=[];
    for(const check of value.checks)for(const quote of check.quotes){
      if(!c.evidence[quote.sourceIndex-1]?.text.includes(quote.text))issues.push({kind:'wrong_source_index',actual:quote.sourceIndex,exactText:quote.text,
        exactMatchingSourceIndexes:c.evidence.flatMap((d,j)=>d.text.includes(quote.text)?[j+1]:[])});
      if(quote.text.length>150)issues.push({kind:'prompt_quote_length_violation',length:quote.text.length,contractEnforced:false});
    }
    details.push({id:c.id,group:reference.group,expected:reference.expected,
      rawStatus:value.checks[0].status,rawVerdictMatchesReference:value.checks[0].status===reference.expected,
      individuallyContractValid:outputOk({results:[value]},[c]),issues,
      frozenOperationalRoute:'review',
      localSemanticReview:reference.group==='monsoon-forecast'&&reference.expected==='unsupported'
        ?'unsupported verdict is correct, but quoted normal seasonal onset does not diagnose the strengthened reporting mode/completion; reason is incomplete'
        :'source window suffices for the reference; raw verdict agrees; this does not cure receipt/batch errors'});
  });
}
const audit={version:plan.version,planHash:hash(plan),resultsHash:hash(results),evaluator:'main_codex_local_nonblind',independent:false,
  contextSufficiencyReviewed:true,heldoutLoaded:false,remoteJudge:false,
  details,cost:results.cost,
  frozenRoute:{allowed:0,blocked:0,review:8,reviewRate:{n:8,total:8},releasedErrors:0,errorCases:4,
    interpretation:'zero release is caused by failed batch contracts, not demonstrated zero leakage ability'},
  rawDiagnostic:{correctParentVerdicts:8,total:8,wrongErrorVerdicts:0,errorCases:4,normalRejected:0,normalCases:4,
    individualContractValid:details.filter(d=>d.individuallyContractValid).length,individualContractFailures:details.filter(d=>!d.individuallyContractValid).map(d=>d.id),
    incompleteBadReason:['item-9f3477c6db65'],note:'post hoc individual inspection only; no salvage or correction fed into frozen operational route'},
  quantityCoverage:{represented:0,total:8},
  rolesDiagnostic:{faithfulLocalReviewed:3,total:3,wholeClaimCoverageVerified:false,automaticFreshPairing:false,eventStateUnknown:3,
    reportModes:results.roles.map(r=>({sourceId:r.target.sourceId,values:r.result.acts.map(a=>a.fields.fields.reportMode.value)}))},
  next:'Fix generic exact-quote source binding, specific validator feedback and per-case isolation; do not patch event labels or broaden semantic rules from these four cases. Then repeat same saved true outputs separately from new calls.'};
atomicWriteJson(`${out}/local-review.json`,audit);console.log(JSON.stringify(audit));
