import { readFileSync } from 'node:fs';
import { atomicWriteJson } from './probe.mjs';

const OUT=new URL('../../out/atomic-evidence/practice-v1/',import.meta.url).pathname;
const read=route=>JSON.parse(readFileSync(`${OUT}/${route}-summary.json`,'utf8'));
const baseline=read('baseline'),rules=read('rules');
const b=new Map(baseline.details.map(d=>[d.id,d]));
const r=new Map(rules.details.map(d=>[d.id,d]));
const common=baseline.details.filter(d=>d.contractValid && r.get(d.id)?.contractValid);
const counts=rows=>{
  const errors=rows.filter(d=>d.label.expected==='unsupported');
  const normals=rows.filter(d=>d.label.expected==='supported');
  return {cases:rows.length,originalErrorsRetained:{n:errors.filter(d=>d.admitted).reduce((n,d)=>n+d.label.errors.length,0),total:errors.reduce((n,d)=>n+d.label.errors.length,0)},
    badParentsAdmitted:{n:errors.filter(d=>d.admitted).length,total:errors.length},normalRejected:{n:normals.filter(d=>!d.admitted).length,total:normals.length}};
};
const changes=common.filter(d=>d.admitted!==r.get(d.id).admitted).map(d=>({id:d.id,expected:d.label.expected,baselineAdmitted:d.admitted,rulesAdmitted:r.get(d.id).admitted}));
const review={
  origin:'Codex local review of reference error spans and frozen evidence; calculations are mechanical',
  scope:'original whole candidates are admitted or rejected, no atom salvage or rewriting; rejection removes every original error in that candidate',
  baseline:{...counts(baseline.details.filter(d=>d.contractValid)),contractFailures:baseline.contractFailures,cost:baseline.cost},
  rules:{...counts(rules.details.filter(d=>d.contractValid)),contractFailures:rules.contractFailures,cost:rules.cost},
  pairedCommon:{baseline:counts(common),rules:counts(common.map(d=>r.get(d.id))),changes},
  perError:baseline.details.flatMap(d=>d.label.errors.map((e,i)=>({id:`${d.id}:e${i+1}`,caseId:d.id,risk:e.risk,claimSpan:e.claimSpan,referenceReason:e.reason,
    baselineRetained:d.contractValid?d.admitted:null,rulesRetained:r.get(d.id)?.contractValid?r.get(d.id).admitted:null,
    interpretation:'retained original error, not whether the model explanation diagnosed the correct mechanism'}))),
  caveats:['practice only; no significance or generalization claim','all labels are single non-blind Codex annotations','contract-invalid cases are unavailable, not silently excluded from operational cost or yield','the rule route was motivated by observed baseline failures, so these are development results','source quote entailment is not established by exact substring validation','baseline cost includes early failed long-output diagnostic and resumed duplicate contract failures'],
};
atomicWriteJson(`${OUT}/local-review.json`,review);
console.log(JSON.stringify({...review,perError:undefined},null,2));
