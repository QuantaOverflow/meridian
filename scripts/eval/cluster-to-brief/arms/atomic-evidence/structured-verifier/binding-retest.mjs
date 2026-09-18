import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
import {choiceRequest,processChoices} from './choice-gate.mjs';
import {overlayFactors} from './surface-factors.mjs';
import {compareBindingFactors} from './binding-factors.mjs';
import {BoundedClient} from './runner.mjs';
import {createRESTTransport} from './rest-transport.mjs';
const root=new URL('../../../out/atomic-evidence/',import.meta.url).pathname;
const out=`${root}binding-retest-v0.19.1`;
const prior=JSON.parse(readFileSync(`${root}confirm-dev-v0.18/plan.json`));
mkdirSync(out,{recursive:true});
const plan={...prior,version:'binding-retest-v0.19.1',boundary:'NONBLIND REPAIR REGRESSION of previous40, NOT new materials or heldout; new uncached Workers AI execution; no remote judge',codeHashes:Object.fromEntries(['binding-retest.mjs','binding-factors.mjs','relation-factors.mjs','surface-factors.mjs','choice-gate.mjs','contracts.mjs','runner.mjs','context-store.mjs','rest-transport.mjs','numeric.mjs'].map(f=>[f,hash(readFileSync(new URL(f,import.meta.url),'utf8'))]))};
if(existsSync(`${out}/plan.json`)&&hash(JSON.parse(readFileSync(`${out}/plan.json`)))!==hash(plan))throw Error('frozen_plan_drift');
atomicWriteJson(`${out}/plan.json`,plan);atomicWriteJson(`${out}/references.json`,JSON.parse(readFileSync(`${root}confirm-dev-v0.18/references.json`)));
if(!process.argv.includes('--remote'))console.log({cases:plan.items.length,planHash:hash(plan),out});
else{
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,plan.limits,undefined,createRESTTransport()),results=[],batches=[];let repairs=0;
  const save=()=>atomicWriteJson(`${out}/results.json`,{version:plan.version,planHash:hash(plan),results,batches,repairs,cost:client.totals(),semanticReview:'not_performed'});
  try{
    for(const b of plan.batches){
      const initial=await client.request(b.tag,b.request,raw=>processChoices(raw,b.cases));batches.push({tag:b.tag,result:initial});
      for(const [i,c] of b.cases.entries()){
        let r=initial.failure?{id:c.id,route:'review',contractValid:false,raw:null,errors:['container failure']}:initial.results[i];
        if(!r.contractValid&&repairs<plan.maxRepairs){repairs++;const first=r;
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
