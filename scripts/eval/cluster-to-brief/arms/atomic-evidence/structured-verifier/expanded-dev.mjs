import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {splitSentences} from '../../../lib.mjs';
import {atomicWriteJson} from '../probe.mjs';
import {ContextStore,inputRows,hash} from './context-store.mjs';
import {BoundedClient} from './runner.mjs';
import {createRESTTransport} from './rest-transport.mjs';
import {quoteGateRequest,processGateBatch,replayLegacyBinding} from './quote-gate.mjs';
import {compareQuantities} from './quantity-binding.mjs';
import {expandedSeeds} from './expanded-seeds.mjs';
export const EXPANDED_VERSION='expanded-dev-v0.16.1';
const ROOT=new URL('../../../',import.meta.url),OUT=new URL(`out/atomic-evidence/${EXPANDED_VERSION}/`,ROOT).pathname;
export function freezeExpanded(out=OUT){
  mkdirSync(out,{recursive:true});
  const original=inputRows();
  const previous=JSON.parse(readFileSync(new URL('out/atomic-evidence/fresh-dev-v0.15/plan.json',ROOT)));
  const used=new Set([...original.flatMap(r=>r.sources.map(s=>s.articleId)),...previous.items.flatMap(c=>c.packet.evidence.map(d=>d.coordinate.articleId))]);
  const clusters=JSON.parse(readFileSync(new URL('fixtures/clusters.json',ROOT)));
  const dev=new Set([1,7,36,37,43].flatMap(k=>clusters[k]));
  const items=[],references=[];
  for(const s of expandedSeeds){
    if(used.has(s.articleId)||!dev.has(s.articleId))throw Error('article_not_new_dev');
    const exact=splitSentences(readFileSync(new URL(`fixtures/content/${s.articleId}.txt`,ROOT),'utf8'))[s.sentence-1];
    for(const kind of ['normal','bad']){
      const text=s[kind],id=`item-${hash(text).slice(0,12)}`;
      const packet=new ContextStore({id,text,sources:[{articleId:s.articleId,sentence:s.sentence}],evidence:[{articleId:s.articleId,sentence:s.sentence,text:exact,sha256:hash(exact)}]}).packet();
      items.push({id,text,evidence:packet.evidence,packet});
      references.push({id,group:s.group,risk:s.risk,articleId:s.articleId,expected:kind==='normal'?'supported':'unsupported',errors:kind==='bad'?[{span:s.error,reason:s.reason}]:[]});
    }
  }
  items.sort((a,b)=>hash(a.text).localeCompare(hash(b.text)));
  const batches=[];for(let i=0;i<items.length;i+=4){const cases=items.slice(i,i+4);batches.push({tag:`batch-${i/4+1}`,cases,request:quoteGateRequest(cases)});}
  const plan={version:EXPANDED_VERSION,items,batches,limits:{logicalCalls:20,httpAttempts:40,knownTokens:60000,timeoutMs:60000},maxSingleItemRepairs:10,
    codeHashes:Object.fromEntries(['expanded-dev.mjs','expanded-seeds.mjs','quote-gate.mjs','contracts.mjs','runner.mjs','rest-transport.mjs','context-store.mjs','quantity-binding.mjs','numeric.mjs'].map(f=>[f,hash(readFileSync(new URL(f,import.meta.url),'utf8'))])),
    boundaries:{heldoutLoaded:false,remoteJudge:false,independent:false,development:true,authoredControls:true,referenceInPrompts:false,
      coverage:'whole-claim model gate with repaired mechanical interface and unchanged narrow quantity guard; NOT full decomposed semantic-code verifier',context:'radius2 untruncated; local sufficiency review before calls'}};
  if(existsSync(`${out}/plan.json`)&&hash(JSON.parse(readFileSync(`${out}/plan.json`)))!==hash(plan))throw Error('frozen_plan_drift');
  atomicWriteJson(`${out}/plan.json`,plan);atomicWriteJson(`${out}/references.json`,references);return plan;
}
export function replayOld(out=OUT){
  mkdirSync(out,{recursive:true});const old=new URL('out/atomic-evidence/fresh-dev-v0.15/',ROOT);
  const p=JSON.parse(readFileSync(new URL('plan.json',old))),calls=readFileSync(new URL('calls.jsonl',old),'utf8').trim().split('\n').map(JSON.parse);
  const results=p.requests.filter(r=>r.kind==='legacy_whole_gate').flatMap(r=>replayLegacyBinding(JSON.parse(calls.filter(c=>c.tag===r.tag).at(-1).rawText),r.cases));
  const artifact={mode:'saved_true_outputs_offline_regression',remoteCalls:0,results,valid:results.filter(r=>r.contractValid).length,total:results.length,
    note:'old prompt-only length rule not retroactively enforced; source binding fix only, not semantic repair or new true call'};
  atomicWriteJson(`${out}/old-binding-replay.json`,artifact);return artifact;
}
export async function runExpanded({remote=false,out=OUT}={}){
  const plan=freezeExpanded(out);replayOld(out);
  if(!remote)return{mode:'frozen_dry_run',cases:plan.items.length,batches:plan.batches.length,planHash:hash(plan),out};
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,plan.limits,undefined,createRESTTransport()),results=[],batches=[];let repairs=0;
  const save=()=>atomicWriteJson(`${out}/results.json`,{version:EXPANDED_VERSION,planHash:hash(plan),results,batches,repairs,
    quantities:plan.items.map(c=>({id:c.id,result:compareQuantities(c.packet.candidate,c.evidence)})),cost:client.totals(),semanticReview:'not_performed'});
  const validate=cases=>raw=>processGateBatch(raw,cases);
  try{
    for(const b of plan.batches){
      const first=await client.request(b.tag,b.request,validate(b.cases));batches.push({tag:b.tag,result:first});
      for(const [i,c] of b.cases.entries()){
        let result=first.failure?{id:c.id,route:'review',contractValid:false,status:'contract_error',errors:['container_contract_failure'],raw:null}:first.results[i];
        const initial=result;
        if(!result.contractValid&&repairs<plan.maxSingleItemRepairs){
          repairs++;
          const repaired=await client.request(`${b.tag}-repair-${i+1}`,quoteGateRequest([c],{errors:result.errors,raw:result.raw}),raw=>{
            const p=processGateBatch(raw,[c]);if(!p.results[0].contractValid)throw Error(JSON.stringify(p.results[0].errors));return p;
          });
          if(!repaired.failure)result={...repaired.results[0],initialFailure:initial};else result={...initial,repairFailure:repaired};
        }
        const quantity=compareQuantities(c.packet.candidate,c.evidence);
        if(quantity.status==='requires_local_review'&&result.route==='allow')result={...result,route:'review',quantityGuard:'unreviewed_state_mismatch'};
        results.push(result);save();
      }
      console.log(`${b.tag}: ${results.slice(-b.cases.length).map(r=>r.route).join(' ')}; total=${results.length}`);
    }
  }catch(error){save();atomicWriteJson(`${out}/run-state.json`,{status:'stopped',reason:error.message,completed:results.length,cost:client.totals()});throw error;}
  atomicWriteJson(`${out}/run-state.json`,{status:'completed',completed:results.length,cost:client.totals()});return{cases:results.length,cost:client.totals(),out};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runExpanded({remote:process.argv.includes('--remote')}).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
