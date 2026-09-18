import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { atomicWriteJson, chatJson } from './probe.mjs';
import { gatePrompt, outputOk } from './practice-iterate.mjs';
import { schemaFor } from './risk-spike.mjs';

const GOLD = new URL('../../gold/practice-risk-v1/', import.meta.url);
const OUT = new URL('../../out/atomic-evidence/relation-v1/', import.meta.url).pathname;
const rows = name => readFileSync(new URL(name, GOLD), 'utf8').trim().split('\n').map(JSON.parse);
const SELECT = new Set(['p08','p11','p12','p14','p20','p21','p29']);
const INSTRUCTION = `Compare relational meaning, not the occurrence of words. Independently identify the claim's relations and the evidence's relations before deciding support. Bind each speaker to their proposition and distinguish the listener; bind temporal direction to the two events; bind quantities to their population and damage state; bind negation and epistemic/completion state to the proposition; bind identities to roles and actions to objects and degree/scope. Only include dimensions actually asserted. Preserve reporting scope: evidence that X said P supports the reporting act without independently proving P. Topic overlap and matching words are insufficient. Missing evidence is uncertain, explicit conflict unsupported. Do not repair the original claim.`;
export function bindingSchema(n) {
  const str = {type:'string',minLength:1};
  return {type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:n,maxItems:n,items:{type:'object',additionalProperties:false,required:['id','pairs'],properties:{id:str,pairs:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['candidateSpan','candidateRelation','evidenceRelation','sourceIndex','quote','status'],properties:{candidateSpan:str,candidateRelation:str,evidenceRelation:str,sourceIndex:{type:'integer',minimum:0},quote:{type:'string'},status:{type:'string',enum:['supported','unsupported','uncertain']}}}}}}}}};
}
export function bindingsOk(obj, cases) {
  return Array.isArray(obj?.results) && obj.results.length===cases.length && obj.results.every((r,i)=>r.id===cases[i].id && Array.isArray(r.pairs) && r.pairs.length>0 && r.pairs.length<=10 && r.pairs.every(p=>
    typeof p.candidateSpan==='string' && p.candidateSpan.length>0 && cases[i].text.includes(p.candidateSpan) &&
    typeof p.candidateRelation==='string' && p.candidateRelation.trim() && typeof p.evidenceRelation==='string' && p.evidenceRelation.trim() &&
    ['supported','unsupported','uncertain'].includes(p.status) && Number.isInteger(p.sourceIndex) &&
    (p.sourceIndex===0 ? p.status==='uncertain' && p.quote==='' : p.sourceIndex>0 && p.sourceIndex<=cases[i].evidence.length && typeof p.quote==='string' && p.quote.length>0 && cases[i].evidence[p.sourceIndex-1].text.includes(p.quote))));
}
export function bindingPrompt(cases) {
  return `${INSTRUCTION}\nOutput explicit candidate/evidence relation pairs covering EVERY factual assertion, including all qualifiers. candidateSpan must be an exact substring of CLAIM. candidateRelation and evidenceRelation are short self-contained descriptions of their respective meaning, not verdicts. Do not copy the candidate into evidenceRelation unless the evidence actually states it. Each pair gets a status. quote must be an exact source substring, sourceIndex 1-based within that item's evidence. If no relevant evidence exists use sourceIndex=0, quote="", status=uncertain. Do not output a separate overall verdict; code rejects if any pair is not supported.\n${cases.map(c=>`ID ${c.id}\nCLAIM ${c.text}\nEVIDENCE\n${c.evidence.map((e,j)=>`${j+1}: ${e.text}`).join('\n')}`).join('\n\n')}`;
}
async function main() {
  mkdirSync(OUT,{recursive:true});
  const cases=rows('inputs.jsonl').filter(c=>SELECT.has(c.id.slice(0,3))).sort((a,b)=>createHash('sha256').update(a.text).digest('hex').localeCompare(createHash('sha256').update(b.text).digest('hex'))).map((c,i)=>({...c,originalId:c.id,id:`item${i+1}`}));
  atomicWriteJson(`${OUT}/mapping.json`,cases.map(({id,originalId})=>({id,originalId})));
  for(let start=0;start<cases.length;start+=2) {
    const batch=cases.slice(start,start+2);
    for(const route of ['replay','contrast','bindings']) {
      const tag=`${route}-b${start/2+1}`,path=`${OUT}/${tag}.json`;
      const ok = x=>route==='bindings'?bindingsOk(x,batch):outputOk(x,batch);
      if(existsSync(path)) {const old=JSON.parse(readFileSync(path));if(!old.failure&&!ok(old))throw Error('invalid cache');continue;}
      const schema=route==='bindings'?bindingSchema(batch.length):schemaFor(batch.length);
      if(route!=='bindings')schema.properties.results.items.properties.checks.maxItems=1;
      const prompt=route==='bindings'?bindingPrompt(batch):gatePrompt('baseline',batch)+(route==='contrast'?'\n'+INSTRUCTION:'');
      atomicWriteJson(`${OUT}/${tag}-request.json`,{prompt,schema});
      try {atomicWriteJson(path,await chatJson(tag,prompt+'\nReturn JSON matching '+JSON.stringify(schema),schema,ok,`${OUT}/calls.jsonl`));}
      catch(error) {
        const logs=readFileSync(`${OUT}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse).filter(x=>x.tag===tag);
        if(logs.at(-1)?.http!==200)throw error;
        atomicWriteJson(path,{failure:'output_contract',results:[]});
      }
    }
  }
  const labels=new Map(rows('labels.jsonl').map(x=>[x.id,x]));
  const summaries=[];
  for(const route of ['replay','contrast','bindings']) {
    const details=cases.map((c,i)=>{const o=JSON.parse(readFileSync(`${OUT}/${route}-b${Math.floor(i/2)+1}.json`));const r=o.results?.find(r=>r.id===c.id);return {id:c.originalId,text:c.text,evidence:c.evidence,expected:labels.get(c.originalId).expected,admitted:r?(route==='bindings'?r.pairs:r.checks).every(p=>p.status==='supported'):null,result:r};});
    const summary={route,contractFailures:details.filter(x=>x.admitted===null).map(x=>x.id),falseAccept:details.filter(x=>x.expected==='unsupported'&&x.admitted===true).map(x=>x.id),normalReject:details.filter(x=>x.expected==='supported'&&x.admitted===false).map(x=>x.id),details};
    atomicWriteJson(`${OUT}/${route}-summary.json`,summary);summaries.push(summary);
  }
  const calls=readFileSync(`${OUT}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
  atomicWriteJson(`${OUT}/summary.json`,{routes:summaries.map(({details,...s})=>s),cost:calls.reduce((s,c)=>({calls:s.calls+1,inTok:s.inTok+(c.in_tok??0),outTok:s.outTok+(c.out_tok??0),requestSeconds:s.requestSeconds+c.wall_s}),{calls:0,inTok:0,outTok:0,requestSeconds:0})});
  console.log(readFileSync(`${OUT}/summary.json`,'utf8'));
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error(e);process.exitCode=1;});
