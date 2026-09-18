import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {splitSentences} from '../../../lib.mjs';
import {atomicWriteJson} from '../probe.mjs';
import {gatePrompt,outputOk} from '../practice-iterate.mjs';
import {schemaFor,cleanQuoteEllipses} from '../risk-spike.mjs';
import {ContextStore,hash,inputRows} from './context-store.mjs';
import {BoundedClient} from './runner.mjs';
import {createRESTTransport} from './rest-transport.mjs';
import {compareQuantities} from './quantity-binding.mjs';
import {targetOnlyRequest,processTargetOnlyRoles} from './isolated-roles.mjs';

export const VERSION='fresh-dev-v0.15';
const ROOT=new URL('../../../',import.meta.url);
const OUT=new URL(`out/atomic-evidence/${VERSION}/`,ROOT).pathname;
const frozenFiles=['../practice-iterate.mjs','../risk-spike.mjs','runner.mjs','rest-transport.mjs','context-store.mjs','quantity-binding.mjs','numeric.mjs','isolated-roles.mjs','mechanical-fields.mjs','contracts.mjs','argument-router.mjs','event-kernel.mjs','relation-chain.mjs','relation-review.mjs'];
// Four new event groups, one normal control and one single-error variant each.
// Authored locally: a fresh development probe, NOT independent/blind reliability evidence.
const seeds=[
  {group:'japan-merger',articleId:1000985,sentence:2,
    normal:'After nearly seven months of negotiations, the CRA, CDP and Komeito concluded that a complete merger would not proceed.',
    bad:'After nearly seven months of negotiations, the CRA, CDP and Komeito completed a complete merger.',
    error:'completed a complete merger',reason:'The parties concluded that a complete merger would not proceed, not that it had been completed.'},
  {group:'monsoon-forecast',articleId:1003362,sentence:2,
    normal:"IMD predicted Monday that conditions are becoming favourable for monsoon's withdrawal around Sept 19.",
    bad:"IMD confirmed Monday that the monsoon had already withdrawn around Sept 19.",
    error:'confirmed Monday that the monsoon had already withdrawn',reason:'Favourable conditions and a forecast do not establish confirmed, completed withdrawal.'},
  {group:'panama-daily-plan',articleId:1004976,sentence:3,
    normal:"From October, an average of 29.5 vessels will be allowed to transit the Panama canal daily, according to a draft plan submitted to Panama’s parliament.",
    bad:"From October, an average of 32 vessels will be allowed to transit the Panama canal daily, according to a draft plan submitted to Panama’s parliament.",
    error:'32 vessels',reason:'October draft average is 29.5; 32 describes September daily transits, a different period.'},
  {group:'sudan-aid-warning',articleId:1001409,sentence:2,
    normal:'The IOM warned that Sudan’s aid network is at risk of collapse.',
    bad:'The IOM confirmed that Sudan’s aid network had already collapsed.',
    error:'confirmed that Sudan’s aid network had already collapsed',reason:'The source warns of a risk, rather than confirming an already-completed collapse.'},
];
export function freezeFresh(out=OUT){
  mkdirSync(out,{recursive:true});
  const used=new Set(inputRows().flatMap(r=>r.sources.map(s=>s.articleId)));
  const clusters=JSON.parse(readFileSync(new URL('fixtures/clusters.json',ROOT)));
  const dev=new Set([1,7,36,37,43].flatMap(k=>clusters[k]));
  const references=[],items=[];
  for(const seed of seeds){
    if(used.has(seed.articleId)||!dev.has(seed.articleId))throw Error('not_new_dev_article');
    const sentences=splitSentences(readFileSync(new URL(`fixtures/content/${seed.articleId}.txt`,ROOT),'utf8'));
    const text=sentences[seed.sentence-1];
    for(const kind of ['normal','bad']){
      const row={id:`local-${seed.group}-${kind}`,text:seed[kind],sources:[{articleId:seed.articleId,sentence:seed.sentence}],evidence:[{articleId:seed.articleId,sentence:seed.sentence,text,sha256:hash(text)}]};
      const packet=new ContextStore(row).packet();
      items.push({id:`item-${hash(row.text).slice(0,12)}`,text:row.text,evidence:packet.evidence,packet});
      references.push({id:items.at(-1).id,group:seed.group,expected:kind==='normal'?'supported':'unsupported',errors:kind==='bad'?[{span:seed.error,reason:seed.reason}]:[]});
    }
  }
  items.sort((a,b)=>hash(a.text).localeCompare(hash(b.text)));
  const sudan=items.filter(c=>c.packet.evidence.some(d=>d.coordinate.articleId===1001409));
  const source=sudan[0].packet.evidence.find(d=>d.coordinate.sentence===2);
  const roles=[source,...sudan.map(c=>({...c.packet.candidate,sourceId:c.id}))];
  const requests=[];
  for(let i=0;i<items.length;i+=4){
    const cases=items.slice(i,i+4),schema=schemaFor(cases.length);
    schema.properties.results.items.properties.checks.maxItems=1;
    requests.push({tag:`gate-${i/4+1}`,kind:'legacy_whole_gate',cases,request:{workflowVersion:VERSION,selfHeal:true,schema,prompt:gatePrompt('baseline',cases)+'\nReturn JSON matching '+JSON.stringify(schema)}});
  }
  for(const target of roles)requests.push({tag:`roles-${target.sourceId}`,kind:'role_conversion_diagnostic',target,request:targetOnlyRequest(target)});
  const plan={version:VERSION,items,requests,limits:{logicalCalls:5,httpAttempts:10,knownTokens:18000,timeoutMs:60000},
    codeHashes:Object.fromEntries(frozenFiles.map(f=>[f,hash(readFileSync(new URL(f,import.meta.url),'utf8'))])),
    boundaries:{heldoutLoaded:false,remoteJudge:false,labelsInPrompts:false,freshArticles:true,independent:false,context:'radius2; untruncated; local sufficiency review required',
      policy:'Legacy whole-gate + unchanged quantity guard; fresh report conversion diagnostic only. No automatic fresh relation-pairing/coverage certificate. Do not claim a full decomposed end-to-end run.'}};
  const path=`${out}/plan.json`;
  if(existsSync(path)&&hash(JSON.parse(readFileSync(path)))!==hash(plan))throw Error('frozen_plan_drift');
  atomicWriteJson(path,plan);atomicWriteJson(`${out}/references.json`,references);
  return plan;
}
export async function runFresh({remote=false,out=OUT}={}){
  const plan=freezeFresh(out);
  if(!remote)return{mode:'frozen_dry_run',cases:plan.items.length,requests:plan.requests.length,out,planHash:hash(plan)};
  if(process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED!=='yes')throw Error('remote_authorization_required');
  const client=new BoundedClient(out,plan.limits,undefined,createRESTTransport());
  const gates=[],roles=[];
  try{
    for(const r of plan.requests){
      const result=await client.request(r.tag,r.request,raw=>{
        if(r.kind==='role_conversion_diagnostic'){
          const converted=processTargetOnlyRoles(raw,r.target);
          if(converted.errors.length)throw Error(JSON.stringify(converted.errors));
          return converted;
        }
        if(!outputOk(raw,r.cases))throw Error('whole-gate contract: exact ordered IDs/full claim/one whole_claim check/source quote/status required');
        return cleanQuoteEllipses(raw,r.cases.map(c=>c.evidence.map(d=>d.text)));
      });
      if(r.kind==='legacy_whole_gate')gates.push({tag:r.tag,ids:r.cases.map(c=>c.id),result});
      else roles.push({target:r.target,result});
      atomicWriteJson(`${out}/results.json`,{version:VERSION,planHash:hash(plan),gates,roles,quantities:plan.items.map(c=>({id:c.id,result:compareQuantities(c.packet.candidate,c.packet.evidence)})),cost:client.totals(),semanticReview:'not_performed'});
      console.log(`${r.tag}: ${result.failure??'contract_valid'}`);
    }
  }catch(error){atomicWriteJson(`${out}/run-state.json`,{status:'stopped',reason:error.message,cost:client.totals()});throw error;}
  atomicWriteJson(`${out}/run-state.json`,{status:'completed',cost:client.totals()});
  return{mode:'remote_completed',cases:plan.items.length,cost:client.totals(),out};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runFresh({remote:process.argv.includes('--remote')}).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
