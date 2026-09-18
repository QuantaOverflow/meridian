import {readFileSync,existsSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {splitSentences} from '../../../lib.mjs';
import {ContextStore,hash,inputRows} from './context-store.mjs';
import {heldoutSeeds} from './heldout-seeds.mjs';
import {choiceRequest,processChoices} from './choice-gate.mjs';
import {overlayFactors} from './surface-factors.mjs';
import {compareBindingFactors} from './binding-factors.mjs';
import {BoundedClient} from './runner.mjs';
import {createRESTTransport} from './rest-transport.mjs';
const root=new URL('../../../',import.meta.url),out=new URL('../../../out/atomic-evidence/heldout-v0.19.1/',import.meta.url).pathname;
const precommit=JSON.parse(readFileSync(`${out}/precommit.json`));
for(const [f,h] of Object.entries(precommit.codeHashes))if(hash(readFileSync(new URL(f,import.meta.url),'utf8'))!==h)throw Error('heldout verifier drift');
const used=new Set(inputRows().flatMap(r=>r.sources.map(s=>s.articleId)));
for(const v of ['fresh-dev-v0.15','expanded-dev-v0.16.1','factor-dev-v0.17','confirm-dev-v0.18']){
  const p=JSON.parse(readFileSync(new URL(`out/atomic-evidence/${v}/plan.json`,root)));for(const c of p.items)for(const d of c.evidence)used.add(d.coordinate.articleId);
}
const items=[],references=[],sourceReviews=[];
for(const s of heldoutSeeds){
  if(used.has(s.articleId)||!precommit.articleOrder[s.cluster]?.slice(0,15).includes(s.articleId))throw Error('article leakage or selection drift');
  const sentences=splitSentences(readFileSync(new URL(`fixtures/content/${s.articleId}.txt`,root),'utf8'));
  const exact=sentences[s.sentence-1];if(!exact||!s.bad.includes(s.error))throw Error('coordinate or error anchor missing');
  for(const kind of ['normal','bad']){
    const text=s[kind],id=`item-${hash(text).slice(0,12)}`;
    const packet=new ContextStore({id,text,sources:[{articleId:s.articleId,sentence:s.sentence}],evidence:[{articleId:s.articleId,sentence:s.sentence,text:exact,sha256:hash(exact)}]}).packet();
    items.push({id,text,evidence:packet.evidence,packet});
    references.push({id,cluster:s.cluster,group:`article-${s.articleId}`,articleId:s.articleId,risk:s.risk,plannedRisk:s.plannedRisk??s.risk,selectionDeviation:s.selectionDeviation??null,expected:kind==='normal'?'supported':'unsupported',errors:kind==='bad'?[{span:s.error,reason:s.reason}]:[]});
  }
  sourceReviews.push({articleId:s.articleId,cluster:s.cluster,sourceWindowStart:Math.max(1,s.sentence-2),sourceWindowEnd:Math.min(sentences.length,s.sentence+2),sourceHash:hash(sentences),normal:s.normal,bad:s.bad,reference:s.reason});
}
if(items.length!==60||new Set(heldoutSeeds.map(s=>s.articleId)).size!==30)throw Error('full preregistered denominator required');
items.sort((a,b)=>hash(a.text).localeCompare(hash(b.text)));const batches=[];
for(let i=0;i<items.length;i+=2){const cases=items.slice(i,i+2);batches.push({tag:`batch-${i/2+1}`,cases,request:choiceRequest(cases)});}
const plan={version:precommit.version,precommitHash:hash(precommit),precommit,codeHashes:precommit.codeHashes,driverHash:hash(readFileSync(new URL('heldout-eval.mjs',import.meta.url),'utf8')),seedsHash:hash(readFileSync(new URL('heldout-seeds.mjs',import.meta.url),'utf8')),items,batches};
if(existsSync(`${out}/plan.json`)&&hash(JSON.parse(readFileSync(`${out}/plan.json`)))!==hash(plan))throw Error('frozen heldout plan drift');
atomicWriteJson(`${out}/plan.json`,plan);atomicWriteJson(`${out}/references.json`,references);atomicWriteJson(`${out}/source-review-inventory.json`,sourceReviews);
if(!process.argv.includes('--remote'))console.log({cases:items.length,planHash:hash(plan),risks:Object.fromEntries([...new Set(heldoutSeeds.map(s=>s.risk))].map(r=>[r,heldoutSeeds.filter(s=>s.risk===r).length])),out});
else{
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,precommit.limits,undefined,createRESTTransport()),results=[],batchesRun=[];let repairs=0;
  const save=()=>atomicWriteJson(`${out}/results.json`,{version:plan.version,planHash:hash(plan),results,batches:batchesRun,repairs,cost:client.totals(),semanticReview:'not_performed'});
  try{
    for(const b of batches){
      const initial=await client.request(b.tag,b.request,raw=>processChoices(raw,b.cases));batchesRun.push({tag:b.tag,result:initial});
      for(const [i,c] of b.cases.entries()){
        let r=initial.failure?{id:c.id,route:'review',contractValid:false,raw:null,errors:['container failure']}:initial.results[i];
        if(!r.contractValid&&repairs<precommit.maxRepairs){repairs++;const first=r;
          const fixed=await client.request(`${b.tag}-repair-${i+1}`,choiceRequest([c],{raw:r.raw,errors:r.errors}),raw=>{const p=processChoices(raw,[c]);if(!p.results[0].contractValid)throw Error(JSON.stringify(p.results[0].errors));return p;});
          if(!fixed.failure)r={...fixed.results[0],initialFailure:first};
        }
        results.push({...overlayFactors(r,compareBindingFactors(c.packet.candidate,c.evidence)),baseline:r});save();
      }
      console.log(`${b.tag}: ${results.slice(-2).map(r=>r.route).join(' ')}; total=${results.length}`);
    }
    atomicWriteJson(`${out}/run-state.json`,{status:'completed',completed:results.length,cost:client.totals()});console.log({cases:results.length,cost:client.totals()});
  }catch(e){save();atomicWriteJson(`${out}/run-state.json`,{status:'stopped',reason:e.message,completed:results.length,cost:client.totals()});throw e;}
}
