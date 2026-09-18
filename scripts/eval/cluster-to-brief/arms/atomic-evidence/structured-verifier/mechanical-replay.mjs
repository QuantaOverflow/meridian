import { readFileSync,mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atomicWriteJson } from '../probe.mjs';
import { mechanicalFields,mechanicalRoleErrors } from './mechanical-fields.mjs';
import { fixtures } from './minimal-fields.mjs';
export function replay(out=new URL('../../../out/atomic-evidence/mechanical-v0.5/',import.meta.url).pathname){
  mkdirSync(out,{recursive:true});
  const root=new URL('../../../out/atomic-evidence/',import.meta.url);
  const minimal=JSON.parse(readFileSync(new URL('minimal-fields-v0.4/results.json',root),'utf8'));
  const split=JSON.parse(readFileSync(new URL('split-heal-v0.3/results.json',root),'utf8'));
  const plan=JSON.parse(readFileSync(new URL('split-heal-v0.3/plan.json',root),'utf8'));
  const fixed=fixtures().map(f=>({id:f.id,origin:f.origin,mechanical:mechanicalFields(f.verb,f.proposition),previous:minimal.results.filter(r=>r.id===f.id)}));
  const extracted=split.results.map(r=>{
    const task=plan.tasks.find(t=>t.tag===r.tag);
    if(r.roles.failure)return {tag:r.tag,status:'previous_contract_failure_not_recovered'};
    const errors=mechanicalRoleErrors(r.roles,r.target,task.context);
    return {tag:r.tag,status:errors.length?'role_contract_error':'role_contract_pass_not_semantic_certification',errors,states:errors.length?[]:r.roles.acts.map(a=>({id:a.id,result:mechanicalFields(a.verbQuote,a.propositionQuote)}))};
  });
  const result={version:'mechanical-v0.5',mode:'offline_replay_of_actual_model_outputs',remoteCalls:0,fixed,extracted,semanticReview:'requires_local_review',wholeClaimVerdict:'not_implemented',notes:['Historical inputs/raw answers unchanged. New code results stored separately.','No code guess for would time or unsupported clause grammar.','Cannot repair missing/wrong extracted propositions from lexical rules.']};
  atomicWriteJson(`${out}/replay.json`,result);return result;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){const r=replay();console.log(JSON.stringify({fixed:r.fixed.map(f=>({id:f.id,fields:Object.fromEntries(Object.entries(f.mechanical.fields).map(([k,v])=>[k,v.value]))})),extracted:r.extracted.map(r=>({tag:r.tag,status:r.status,errorCount:r.errors?.length??0})),remoteCalls:0},null,2));}
