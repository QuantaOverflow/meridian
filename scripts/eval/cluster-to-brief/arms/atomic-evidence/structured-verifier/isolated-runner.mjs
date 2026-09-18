import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inputRows,ContextStore} from './context-store.mjs';
import {BoundedClient} from './runner.mjs';
import {isolatedRequest,targetOnlyRequest,processIsolatedRoles,processTargetOnlyRoles,WORKFLOW_VERSION,TARGET_ONLY_VERSION} from './isolated-roles.mjs';
import {atomicWriteJson} from '../probe.mjs';
export async function runIsolated({remote=false,transport=null,targetOnly=false,out=new URL(`../../../out/atomic-evidence/${targetOnly?TARGET_ONLY_VERSION:WORKFLOW_VERSION}/`,import.meta.url).pathname}={}){
  mkdirSync(out,{recursive:true});const tasks=new Map();
  for(const row of inputRows().filter(r=>/^p1[12]-/.test(r.id))){
    const packet=new ContextStore(row).packet(),candidate={...packet.candidate,sourceId:`candidate:${row.id}`};
    tasks.set(candidate.sourceId,{target:candidate,context:[candidate]});
    for(const s of row.sources){const target=packet.evidence.find(d=>d.coordinate.articleId===s.articleId&&d.coordinate.sentence===s.sentence);tasks.set(target.sourceId,{target,context:packet.evidence});}
  }
  const limits={logicalCalls:7,httpAttempts:14,knownTokens:18000,timeoutMs:60000};
  atomicWriteJson(`${out}/plan.json`,{version:targetOnly?TARGET_ONLY_VERSION:WORKFLOW_VERSION,tasks:[...tasks.values()],limits,scope:'role extraction with occurrence and per-act isolation; no whole-claim verdict',targetOnly});
  if(!remote)return{remoteCalls:0,targets:tasks.size,out};
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,limits,undefined,transport),results=[];
  try{for(const task of tasks.values()){
    const request=targetOnly?targetOnlyRequest(task.target):isolatedRequest(task.target,task.context);if(transport)request.transportVersion=transport.kind;
    const processRaw=raw=>targetOnly?processTargetOnlyRoles(raw,task.target):processIsolatedRoles(raw,task.target,task.context);
    let result=await client.request(task.target.sourceId,request,raw=>{
      const partial=processRaw(raw);
      if(partial.errors.length)throw Error(`isolated_role_errors: ${JSON.stringify(partial.errors)}`);
      return partial;
    });
    const attempts=client.records.filter(r=>r.tag===task.target.sourceId).map(r=>{
      try{return{attempt:r.attempt,partial:processRaw(JSON.parse(r.rawText))};}catch{return{attempt:r.attempt,unparseable:true};}
    });
    if(result.failure){const latest=attempts.filter(a=>a.partial).at(-1);if(latest)result={...latest.partial,repairExhausted:true};}
    results.push({target:task.target,result,attempts,repairHistoryRequiresReview:attempts.some(a=>a.unparseable||a.partial?.errors.length),...(targetOnly?{resolutionStatus:'not_performed',resolutionTasks:result.acts?.map(a=>({id:a.id,speakerQuote:a.speakerQuote,speakerSpan:a.spans.speakerQuote,contextSourceIds:task.context.map(d=>d.sourceId)}))??[]}: {})});
    atomicWriteJson(`${out}/results.json`,{results,cost:client.totals(),semanticReview:'not_performed',wholeClaimVerdict:'not_implemented'});
  }atomicWriteJson(`${out}/run-state.json`,{status:'completed',cost:client.totals(),completedTargets:results.length});}
  catch(e){atomicWriteJson(`${out}/run-state.json`,{status:'stopped',reason:e.message,cost:client.totals(),completedTargets:results.length});throw e;}
  return{targets:results.length,cost:client.totals(),out};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runIsolated().then(console.log).catch(e=>{console.error(e.message);process.exitCode=1;});
