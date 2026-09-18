import {readFileSync} from 'node:fs';
import {processIsolatedRoles,processTargetOnlyRoles,WORKFLOW_VERSION,TARGET_ONLY_VERSION} from './isolated-roles.mjs';
import {atomicWriteJson} from '../probe.mjs';
const targetOnly=process.argv.includes('--target-only');
const root=new URL(`../../../out/atomic-evidence/${targetOnly?'target-only-roles-v0.9':'isolated-roles-v0.6'}/`,import.meta.url);
const plan=JSON.parse(readFileSync(new URL('plan.json',root),'utf8'));
const records=readFileSync(new URL('calls.jsonl',root),'utf8').trim().split('\n').map(JSON.parse);
const results=plan.tasks.map(t=>{
  const r=records.filter(r=>r.tag===t.target.sourceId&&r.rawText).at(-1);
  try{return{target:t.target,attempt:r.attempt,result:targetOnly?processTargetOnlyRoles(JSON.parse(r.rawText),t.target):processIsolatedRoles(JSON.parse(r.rawText),t.target,t.context)};}catch(e){return{target:t.target,failure:e.message};}
});
const version=targetOnly?TARGET_ONLY_VERSION:WORKFLOW_VERSION;
const result={version,mode:'offline_replay_unmodified_real_model_outputs',additionalRemoteCalls:0,semanticCoverageVerified:false,wholeClaimVerdict:'not_implemented',results};
atomicWriteJson(new URL(`replay-${version}.json`,root).pathname,result);
console.log(JSON.stringify(results.map(r=>({id:r.target.sourceId,acts:r.result?.acts.length,obligations:r.result?.obligations.map(o=>o.kind),errors:r.result?.errors,failure:r.failure})),null,2));
