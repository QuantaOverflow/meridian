import {hash} from './context-store.mjs';
import {canonicalDecimal} from './numeric.mjs';
import {compareRelationFactors} from './relation-factors.mjs';
export const BINDING_VERSION='binding-factors-v0.19.1';
const norm=s=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}' ]/gu,' ').replace(/\s+/g,' ').trim();
const number=s=>({one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',forty:'40'}[s.toLowerCase()]??canonicalDecimal(s));
const n='(?:\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|forty)';
export function extractBindingFactors(doc){
  const facts=[],obligations=[];
  const add=(m,family,key,value)=>{
    const prefix=doc.text.slice(Math.max(0,m.index-100),m.index).split(/[.;!?]/).at(-1);
    if(/\b(?:if|unless|might|could|may|not|never|denied|refused)\b/i.test(prefix)){obligations.push({family,reason:'scope_requires_review',quote:m[0]});return;}
    facts.push({family,key,value,receipt:{sourceId:doc.sourceId,start:m.index,end:m.index+m[0].length,exactText:m[0],sourceHash:hash(doc.text)},actorIdentityVerified:false});
  };
  // Paired typed quantities under a shared explicit damage predicate, not a number bag.
  for(const m of doc.text.matchAll(new RegExp(`\\b(?:damaged|damaging) (?<homes>${n}) homes and (?<vehicles>${n}) vehicles\\b`,'gi'))){
    const context=doc.text.slice(0,m.index).trimEnd().match(/Houthi attacks on (?<places>[^.!?]{3,100}?)(?: caused| damaged|, damaging|$)/i)?.groups.places;
    if(!context){obligations.push({family:'damage_population',reason:'location_event_binding_missing',quote:m[0]});continue;}
    for(const kind of ['homes','vehicles'])add(m,'damage_population',`houthi attacks:${norm(context)}:${kind}`,number(m.groups[kind]));
  }
  // Same seizure event: affected persons and bank accounts are separate typed slots.
  for(const m of doc.text.matchAll(/\bseized assets belonging to (?<people>\d[\d,]*) dissidents, journalists and public figures and (?<verb>froze|frozen) (?<accounts>\d[\d,]*) of their bank accounts\b/gi)){
    const prefix=doc.text.slice(Math.max(0,m.index-100),m.index);
    if(!/Iran['’]s judiciary/.test(prefix)){obligations.push({family:'seizure_population',reason:'named_actor_binding_missing',quote:m[0]});continue;}
    for(const kind of ['people','accounts'])add(m,'seizure_population',`iran judiciary:asset seizure:${kind}`,canonicalDecimal(m.groups[kind]));
  }
  // Complete unique agreement patient+purpose; do not align merely on 'terminated'.
  for(const m of doc.text.matchAll(/\b(?<actor>[A-Z][a-z]+(?: [A-Z][a-z]+){0,2}) terminated (?<patient>a \d+-year-old memorandum of understanding meant to resolve overlapping maritime claims)\b/g)){
    add(m,'agreement_actor',`terminated:${norm(m.groups.patient)}`,norm(m.groups.actor));
  }
  return{version:BINDING_VERSION,facts,obligations,coverageVerified:false};
}
export function compareBindingFactors(candidate,evidence){
  const base=compareRelationFactors(candidate,evidence),c=extractBindingFactors(candidate),e=evidence.map(extractBindingFactors),source=e.flatMap(x=>x.facts),diagnoses=[...base.diagnoses],pending=[...base.pending];
  for(const f of c.facts){
    const matches=source.filter(s=>s.family===f.family&&s.key===f.key);if(!matches.length)continue;
    if(new Set(matches.map(s=>s.value)).size!==1){pending.push({candidate:f,evidence:matches,reason:'conflicting_registered_factor_values'});continue;}
    if(f.value!==matches[0].value)diagnoses.push({kind:'factor_not_established',family:f.family,key:f.key,candidate:f,evidence:matches,semanticCertification:false,scope:'registered_narrow_explicit_grammar_only'});
  }
  return{version:BINDING_VERSION,diagnoses,pending,base,candidate:c,evidence:e,coverageVerified:false};
}
