import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicWriteJson, chatJson } from './probe.mjs';
import { schemaFor, validOutput, cleanQuoteEllipses } from './risk-spike.mjs';

const GOLD = new URL('../../gold/practice-risk-v1/', import.meta.url);
const OUT = new URL('../../out/atomic-evidence/practice-v1/', import.meta.url).pathname;
const readRows = name => readFileSync(new URL(name, GOLD), 'utf8').trim().split('\n').map(JSON.parse);
export const KINDS = ['identity', 'named_object', 'action', 'attribution', 'time', 'quantity', 'modality', 'causality', 'whole_claim'];
export function slotSchema(count) {
  return { type: 'object', additionalProperties: false, required: ['results'], properties: {
    results: { type: 'array', minItems: count, maxItems: count, items: {
      type: 'object', additionalProperties: false, required: ['id', 'slots'], properties: {
        id: { type: 'string' }, slots: { type: 'array', minItems: 1, maxItems: 12, items: {
          type: 'object', additionalProperties: false, required: ['kind', 'span'], properties: {
            kind: { type: 'string', enum: KINDS }, span: { type: 'string', minLength: 1 },
          },
        } },
      },
    } },
  } };
}
export function slotsOk(plan, cases) {
  return plan?.results?.length === cases.length && plan.results.every((r, i) =>
    r.id === cases[i].id && Array.isArray(r.slots) && r.slots.length > 0 && r.slots.length <= 12 &&
    new Set(r.slots.map(s => `${s.kind}:${s.span}`)).size === r.slots.length &&
    r.slots.every(s => KINDS.includes(s.kind) && typeof s.span === 'string' && s.span.length > 0 && cases[i].text.includes(s.span)));
}
const templates = {
  whole_claim: 'Check complete support for every factual detail of the entire original claim. Unsupported detail must veto this check, even if the main topic matches.',
  identity: 'Check the exact actor, reporting speaker and role identified by the anchored text.',
  named_object: 'Check that evidence identifies this exact named person, object or place in the claimed role; a generic object does not establish its name.',
  action: 'Check this exact action, negation, exclusivity and completion strength; partial progress does not imply completion.',
  attribution: 'Check who asserted this exact proposition. Preserve the reporting scope: X said P does not require P itself to be independently true.',
  time: 'Check only the asserted date, event pair and temporal direction. Do not add causality or infer deployment time from announcement time.',
  quantity: 'Check this quantity with its exact owner, unit, bound and reference period; a matching number belonging to another population is insufficient.',
  modality: 'Check whether the anchored content is a plan, hope, possibility, warning, claim or completed fact. Do not strengthen its epistemic status.',
  causality: 'Check only the explicitly asserted cause and effect; do not turn mere temporal order into a cause.',
};
export function questionOf(slot) { return `${templates[slot.kind]} Anchor: ${JSON.stringify(slot.span)}. Interpret this anchor in the full original claim, without rewriting it.`; }
export function ruleSlots(text) {
  // Explicit lexical cues only. No label, evidence, cluster id or fixture entity lookup.
  // One question per dimension audits all matching details under full-clause scope.
  const patterns = [
    ['attribution', /\b(?:said|says|claimed|reported|told|according to|warned|confirmed|showed)\b/i],
    ['time', /\b(?:after|before|later|previous|next|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|morning|April|February|GMT|pm|am)\b/i],
    ['quantity', /\d[\d,.]*|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|tens|thousands|million|percent|all)\b/i],
    ['modality', /\b(?:will|would|could|can|hoped|hope|planned|plans|projected|warned|confirmed|already|had|expected|to be presented|exit poll)\b/i],
    ['action', /\b(?:completed|complete|permanently|cancelled|destroyed|damaged|rescued|ended|passed|under way|only|not|no|declined)\b/i],
    ['causality', /\b(?:because|caused|due to|driven|detonated when|airstrike)\b/i],
  ];
  const slots=[{kind:'whole_claim',span:text}];
  for(const [kind,pattern] of patterns) { const match=pattern.exec(text); if(match) slots.push({kind,span:match[0]}); }
  return slots;
}
export function plannerPrompt(cases) {
  return `Locate factual risk slots in each CLAIM. You cannot see evidence and must not judge truth, invent content or repair wording. Return only kind and exact span; never generate questions. Each slot has one factual anchor. Separate named objects from reporting speakers. Enumerate distinct quantities and distinct actions, including negative actions. Preserve attributed proposition scope. Time means the asserted time relation, NEVER a cause. Add causality only when a causal relation is explicitly asserted. No quotas: omit absent dimensions, no duplicate slots. A compound claim may need several slots of the same kind.\n${cases.map(c => `ID ${c.id}\nCLAIM ${c.text}`).join('\n\n')}`;
}
export function gatePrompt(route, cases, plan) {
  const instructions = route === 'baseline'
    ? 'Return exactly ONE check per claim: dimension=whole_claim, claimSpan=the full CLAIM verbatim. Decide whether EVERY factual detail is supported. If any detail lacks support, use unsupported or uncertain and identify the specific bad detail in a concise reason. Audit identity, named objects, action strength, attribution, time, quantity, modality and causality when present, without inventing absent dimensions.'
    : 'Audit exactly the supplied risk slots using their deterministic questions. Return one check per slot, in slot order, with claimSpan exactly equal to its anchor and dimension equal to its kind. Do not add dimensions. Interpret every anchor under the full claim’s attribution scope.';
  return `${instructions}\nThis is a tested evidence-gate function, not an independent evaluator. Do not rewrite claims. Unsupported and uncertain veto admission. A supported check requires exact source quotes that actually entail the claim. Keep X said P separate from whether P is true; denial of P does not erase the reporting act. For each quote use only a short exact substring (at most 150 characters) and the correct sourceIndex from THAT claim. No ellipses. Reason at most 100 characters.\n${cases.map((c,i) => `ID ${c.id}\nCLAIM ${c.text}${plan ? '\nSLOTS\n'+plan.results[i].slots.map(s=>`${s.kind}: ${questionOf(s)}`).join('\n'):''}\nEVIDENCE\n${c.evidence.map((e,j)=>`${j+1}: ${e.text}`).join('\n')}`).join('\n\n')}`;
}
export function outputOk(raw, cases, plan) {
  const evidence = cases.map(c=>c.evidence.map(e=>e.text));
  const result = cleanQuoteEllipses(raw,evidence);
  if (!validOutput(result,cases,evidence)) return false;
  if (!plan) return result.results.every((r,i)=>r.checks.length === 1 && r.checks[0].dimension === 'whole_claim' && r.checks[0].claimSpan === cases[i].text);
  return result.results.every((r,i)=>r.checks.length === plan.results[i].slots.length && r.checks.every((c,j)=>c.dimension === plan.results[i].slots[j].kind && c.claimSpan === plan.results[i].slots[j].span));
}
async function main() {
  mkdirSync(OUT,{recursive:true});
  const route = process.argv.includes('--rules') ? 'rules' : process.argv.includes('--slots') ? 'slots' : 'baseline';
  const cases = readRows('inputs.jsonl').sort((a,b)=>createHash('sha256').update(a.text).digest('hex').localeCompare(createHash('sha256').update(b.text).digest('hex'))).map((c,i)=>({...c,originalId:c.id,id:`item${String(i+1).padStart(2,'0')}`}));
  const limit = Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1] ?? cases.length);
  atomicWriteJson(`${OUT}/mapping.json`,cases.map(({id,originalId})=>({id,originalId})));
  for(let start=0;start<Math.min(limit,cases.length);start+=4) {
    const batch=cases.slice(start,Math.min(start+4,limit));
    const tag=`${route}-b${start/4+1}`, path=`${OUT}/${tag}.json`;
    let plan;
    if(route==='rules') { plan={results:batch.map(c=>({id:c.id,slots:ruleSlots(c.text)}))};atomicWriteJson(`${OUT}/rules-plan-b${start/4+1}.json`,plan); }
    if(route==='slots') {
      const pp=`${OUT}/slots-plan-b${start/4+1}.json`;
      if(existsSync(pp)) { plan=JSON.parse(readFileSync(pp,'utf8')); if(!slotsOk(plan,batch))throw Error('invalid cached plan'); }
      else { const schema=slotSchema(batch.length); plan=await chatJson(`${tag}-plan`,plannerPrompt(batch)+'\nReturn JSON matching '+JSON.stringify(schema),schema,p=>slotsOk(p,batch),`${OUT}/calls.jsonl`); atomicWriteJson(pp,plan); }
    }
    if(existsSync(path)) { const cache=JSON.parse(readFileSync(path,'utf8')); if(!cache.failure && !outputOk(cache,batch,plan))throw Error('invalid cached gate'); console.log(`reused ${tag}`); continue; }
    const schema=schemaFor(batch.length);
    schema.properties.results.items.properties.checks.maxItems=plan ? 12 : 1;
    let raw;
    try { raw=await chatJson(tag,gatePrompt(route,batch,plan)+'\nReturn JSON matching '+JSON.stringify(schema),schema,r=>outputOk(r,batch,plan),`${OUT}/calls.jsonl`); }
    catch(error) {
      const logs=readFileSync(`${OUT}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.tag===tag);
      const last=logs.at(-1);
      if(last?.http !== 200) throw error; // stop on infrastructure failure, no endless retries
      let parsed;try{parsed=JSON.parse(last.invalid_output);}catch{parsed={results:[]};}
      const normalized=cleanQuoteEllipses(parsed,batch.map(c=>c.evidence.map(e=>e.text)));
      const kept=(normalized.results??[]).filter(r=>{
        const i=batch.findIndex(c=>c.id===r.id);
        return i>=0 && outputOk({results:[r]},[batch[i]],plan?{results:[plan.results[i]]}:undefined);
      });
      atomicWriteJson(path,{results:kept,raw:parsed,failure:'output_contract',failedIds:batch.filter(c=>!kept.some(r=>r.id===c.id)).map(c=>c.id)});
      console.log(`${tag}: contract failure, ${kept.length}/${batch.length} usable; continuing without further retries`);
      continue;
    }
    const normalized=cleanQuoteEllipses(raw,batch.map(c=>c.evidence.map(e=>e.text)));
    atomicWriteJson(path,{...normalized,raw});
    console.log(`${tag}: ${normalized.results.map(r=>`${r.id}=${r.checks.every(c=>c.status==='supported')?'accept':'reject'}`).join(' ')}`);
  }
  // Labels are loaded only after the tested model calls, never interpolated into prompts.
  const labels=new Map(readRows('labels.jsonl').map(l=>[l.id,l]));
  const details=[];
  for(let start=0;start<Math.min(limit,cases.length);start+=4) {
    const batch=cases.slice(start,Math.min(start+4,limit)), result=JSON.parse(readFileSync(`${OUT}/${route}-b${start/4+1}.json`,'utf8'));
    batch.forEach(c=>{const r=result.results.find(r=>r.id===c.id);details.push({id:c.originalId,text:c.text,evidence:c.evidence,label:labels.get(c.originalId),contractValid:!!r,checks:r?.checks??[],admitted:r ? r.checks.every(c=>c.status==='supported') : null});});
  }
  const good=details.filter(d=>d.contractValid && d.label.expected==='supported'),bad=details.filter(d=>d.contractValid && d.label.expected==='unsupported');
  const log=readFileSync(`${OUT}/calls.jsonl`,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.tag.startsWith(route+'-'));
  atomicWriteJson(`${OUT}/${route}-summary.json`,{route,cases:details.length,contractFailures:details.filter(d=>!d.contractValid).map(d=>d.id),parentFalseAccept:{n:bad.filter(d=>d.admitted).length,total:bad.length},normalRejected:{n:good.filter(d=>!d.admitted).length,total:good.length},perErrorRecall:'requires local Codex review; parent rejection is not per-error detection',cost:{calls:log.length,inTok:log.reduce((n,c)=>n+(c.in_tok??0),0),outTok:log.reduce((n,c)=>n+(c.out_tok??0),0),wallS:log.reduce((n,c)=>n+c.wall_s,0)},details});
  console.log(JSON.stringify({route,parentFalseAccept:bad.filter(d=>d.admitted).map(d=>d.id),normalRejected:good.filter(d=>!d.admitted).map(d=>d.id)}));
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) main().catch(e=>{console.error(e);process.exitCode=1;});
