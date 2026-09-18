import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {splitSentences} from '../../../lib.mjs';
import {atomicWriteJson} from '../probe.mjs';
import {ContextStore,inputRows,hash} from './context-store.mjs';
import {BoundedClient} from './runner.mjs';
import {createRESTTransport} from './rest-transport.mjs';
import {choiceRequest,processChoices} from './choice-gate.mjs';
import {compareSurfaceFactors,overlayFactors} from './surface-factors.mjs';
import {factorSeeds} from './factor-seeds.mjs';
export const FACTOR_DEV_VERSION='factor-dev-v0.17';
const ROOT=new URL('../../../',import.meta.url),OUT=new URL(`out/atomic-evidence/${FACTOR_DEV_VERSION}/`,ROOT).pathname;
export function freezeFactor(out=OUT){
  mkdirSync(out,{recursive:true});const used=new Set(inputRows().flatMap(r=>r.sources.map(s=>s.articleId)));
  for(const version of ['fresh-dev-v0.15','expanded-dev-v0.16.1']){
    const p=JSON.parse(readFileSync(new URL(`out/atomic-evidence/${version}/plan.json`,ROOT)));
    for(const c of p.items)for(const d of c.evidence)used.add(d.coordinate.articleId);
  }
  const clusters=JSON.parse(readFileSync(new URL('fixtures/clusters.json',ROOT))),dev=new Set([1,7,36,37,43].flatMap(k=>clusters[k]));
  const items=[],refs=[];
  for(const s of factorSeeds){
    if(!dev.has(s.articleId)||used.has(s.articleId))throw Error('not_new_development_article');
    const exact=splitSentences(readFileSync(new URL(`fixtures/content/${s.articleId}.txt`,ROOT),'utf8'))[s.sentence-1];
    for(const kind of ['normal','bad']){
      const text=s[kind],id=`item-${hash(text).slice(0,12)}`,packet=new ContextStore({id,text,sources:[{articleId:s.articleId,sentence:s.sentence}],evidence:[{articleId:s.articleId,sentence:s.sentence,text:exact,sha256:hash(exact)}]}).packet();
      items.push({id,text,evidence:packet.evidence,packet});refs.push({id,group:s.group,articleId:s.articleId,expected:kind==='normal'?'supported':'unsupported',errors:kind==='bad'?[{span:s.error,reason:s.reason}]:[]});
    }
  }
  items.sort((a,b)=>hash(a.text).localeCompare(hash(b.text)));const batches=[];
  for(let i=0;i<items.length;i+=2){const cases=items.slice(i,i+2);batches.push({tag:`batch-${i/2+1}`,cases,request:choiceRequest(cases)});}
  const plan={version:FACTOR_DEV_VERSION,items,batches,limits:{logicalCalls:25,httpAttempts:50,knownTokens:90000,timeoutMs:60000},maxRepairs:5,
    target:{directDiagnosticMissRateBelow:0.10,normalAllowAtLeast:0.75,reviewRateAtMost:0.25,unknownNotDetection:true},
    codeHashes:Object.fromEntries(['factor-dev.mjs','factor-seeds.mjs','surface-factors.mjs','choice-gate.mjs','contracts.mjs','runner.mjs','context-store.mjs','rest-transport.mjs'].map(f=>[f,hash(readFileSync(new URL(f,import.meta.url),'utf8'))])),
    boundary:'nonblind authored development controls; new articles but related event overlap possible; full decomposition/production not validated; heldout unread; no remote judge'};
  if(existsSync(`${out}/plan.json`)&&hash(JSON.parse(readFileSync(`${out}/plan.json`)))!==hash(plan))throw Error('frozen_plan_drift');
  atomicWriteJson(`${out}/plan.json`,plan);atomicWriteJson(`${out}/references.json`,refs);return plan;
}
export async function runFactor({remote=false,out=OUT}={}){
  const plan=freezeFactor(out);if(!remote)return{cases:plan.items.length,requests:plan.batches.length,planHash:hash(plan),out};
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,plan.limits,undefined,createRESTTransport()),results=[],batches=[];let repairs=0;
  const save=()=>atomicWriteJson(`${out}/results.json`,{version:FACTOR_DEV_VERSION,planHash:hash(plan),results,batches,repairs,cost:client.totals(),semanticReview:'not_performed'});
  try{
    for(const b of plan.batches){
      const initial=await client.request(b.tag,b.request,raw=>processChoices(raw,b.cases));batches.push({tag:b.tag,result:initial});
      for(const [i,c] of b.cases.entries()){
        let result=initial.failure?{id:c.id,route:'review',contractValid:false,raw:null,errors:['container failure']}:initial.results[i];
        if(!result.contractValid&&repairs<plan.maxRepairs){
          repairs++;const first=result;
          const repair=await client.request(`${b.tag}-repair-${i+1}`,choiceRequest([c],{raw:result.raw,errors:result.errors}),raw=>{const p=processChoices(raw,[c]);if(!p.results[0].contractValid)throw Error(JSON.stringify(p.results[0].errors));return p;});
          if(!repair.failure)result={...repair.results[0],initialFailure:first};
        }
        const guard=compareSurfaceFactors(c.packet.candidate,c.evidence);
        results.push({...overlayFactors(result,guard),baseline:result});save();
      }
      console.log(`${b.tag}: ${results.slice(-b.cases.length).map(r=>r.route).join(' ')}; total=${results.length}`);
    }
  }catch(error){save();atomicWriteJson(`${out}/run-state.json`,{status:'stopped',reason:error.message,completed:results.length,cost:client.totals()});throw error;}
  atomicWriteJson(`${out}/run-state.json`,{status:'completed',completed:results.length,cost:client.totals()});return{cases:results.length,cost:client.totals(),out};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runFactor({remote:process.argv.includes('--remote')}).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
