import {hash} from './context-store.mjs';
import {canonicalDecimal} from './numeric.mjs';
export const FACTOR_VERSION='surface-factors-v0.17';
const norm=s=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}' ]/gu,' ').replace(/\s+/g,' ').trim();
const category=s=>norm(s).split(' ').map(t=>t.endsWith('s')?t.slice(0,-1):t).join(' ');
function fact(doc,m,family,key,value,extra={}){
  return{family,key,value,...extra,receipt:{sourceId:doc.sourceId,start:m.index,end:m.index+m[0].length,exactText:m[0],sourceHash:hash(doc.text)}};
}
function scoped(text,index){
  const prefix=text.slice(Math.max(0,index-100),index).split(/[.;!?]/).at(-1);
  return /\b(?:if|unless|might|could|may|not|never|denied|refused)\b/i.test(prefix);
}
export function extractSurfaceFactors(doc){
  const facts=[],obligations=[];
  const add=(m,family,key,value,extra)=>{
    if(scoped(doc.text,m.index)){obligations.push({family,reason:'scope_requires_review',quote:m[0]});return;}
    facts.push(fact(doc,m,family,key,value,extra));
  };
  // Fully bound report/action+destination, not an independent already/to-be keyword hit.
  for(const m of doc.text.matchAll(/\breport (?<stage>to be|already) (?<action>presented|submitted|published|released) to (?<destination>[^,.;!?]{5,160})/gi)){
    add(m,'stage',`report:${norm(m.groups.action)}:${norm(m.groups.destination)}`,m.groups.stage.toLowerCase()==='to be'?'planned':'completed');
  }
  for(const m of doc.text.matchAll(/\b(?<stage>(?:is |was )?scheduled to|has already|had already) (?<action>appear|appeared) (?<destination>before [^.;!?]{8,240})/gi)){
    const destination=m.groups.destination.split(/,\s*according to\b/i)[0];
    add(m,'stage',`appear:${norm(destination)}`,/scheduled/i.test(m.groups.stage)?'planned':'completed',{actorIdentityVerified:false,alignmentRule:'unique_complete_appointment_destination'});
  }
  const roots={meet:'meet',met:'meet',acquire:'acquire',acquired:'acquire',reimburse:'reimburse',reimbursed:'reimburse',receive:'receive',received:'receive',build:'build',built:'build',produce:'produce',produced:'produce',develop:'develop',developed:'develop'};
  for(const m of doc.text.matchAll(/\b(?<stage>will|(?:is |are )?set to|(?:is |are )?scheduled to|(?:is |are )?expected to|is exploring plans to|has already|had already|have already) (?<action>meet|met|acquire|acquired|reimburse|reimbursed|receive|received|build|built|produce|produced|develop|developed) (?<object>[^.;!?]{4,250})/gi)){
    const future=!/already/i.test(m.groups.stage),verb=m.groups.action.toLowerCase();
    if(future&&verb!==roots[verb]||!future&&verb===roots[verb]){obligations.push({family:'stage',reason:'unsupported_inflection_or_scope',quote:m[0]});continue;}
    const object=m.groups.object.split(/,\s*(?:amid|according to|as)\b|\s+and\s+[A-Z][\p{L}]+\s+(?:is|are|was|were|eager)\b/u)[0];
    add(m,'stage',`${roots[verb]}:${norm(object)}`,future?'planned':'completed',{actorIdentityVerified:false,alignmentRule:'unique_full_predicate_object_surface'});
  }
  // Explicit bound + same count/population/action/context; number alone never aligns populations.
  for(const m of doc.text.matchAll(/\b(?<bound>at least|at most|more than|less than|exactly) (?<number>\d[\d,]*(?:\.\d+)?) (?<population>people) (?:(?:have|has) been|were|are) (?<action>injured|killed|displaced|arrested) (?<context>[^.;!?]{8,250})/gi)){
    let value;try{value=canonicalDecimal(m.groups.number);}catch{obligations.push({family:'bound',reason:'invalid_number',quote:m[0]});continue;}
    const context=m.groups.context.split(',')[0];
    add(m,'bound',`${value}:${norm(m.groups.population)}:${norm(m.groups.action)}:${norm(context)}`,m.groups.bound.toLowerCase());
  }
  // Narrow explicit personal reporting clause; no pronoun/name guessing.
  for(const m of doc.text.matchAll(/\b(?<actor>(?:President|Prime Minister|Governor|Minister) [\p{L}'’ -]{3,90}?) (?:(?:says|insists|said) (?:that )?he )?(?<operator>does not want|does want|wants|want) (?<object>[^.!?]{5,180})/giu)){
    add(m,'polarity',`want:${norm(m.groups.actor)}:${norm(m.groups.object)}`,/not/i.test(m.groups.operator)?'negative':'positive');
  }
  for(const m of doc.text.matchAll(/\b(?<action>has given|have given|had given) (?<negative>no )?(?<object>[^,.!?]{3,120}?)(?= and (?:appeared|given|published)|[,.!?]|$)/gi)){
    add(m,'polarity',`given:${norm(m.groups.object)}`,m.groups.negative?'negative':'positive',{actorIdentityVerified:false,alignmentRule:'unique_complete_verb_object_surface'});
  }
  // Complete office-change event key binds predicate/person/office. Only actor-type mismatch
  // is established here; two different spellings of personal names are NOT assumed distinct.
  for(const m of doc.text.matchAll(/\b(?<actor>(?:President|Prime Minister|Governor|Minister) [\p{L}'’ -]{3,90}?|[\p{L} -]{1,40}['’]s parliament) (?:(?:abruptly|formally) )?(?<action>removed|appointed|dismissed) (?<patient>[A-Z][\p{L}'’ -]{1,60}?) (?:as|to be) (?<role>[^,.;!?]{3,90}?)(?= on | and | in |[,.]|$)/giu)){
    const role=m.groups.role.replace(/^[\p{L} -]+['’]s\s+/u,'');
    add(m,'actor_type',`${norm(m.groups.action)}:${norm(m.groups.patient)}:${norm(role)}`,/parliament$/i.test(m.groups.actor)?'legislative_body':'named_officeholder',{actorQuote:m.groups.actor,roleQuote:m.groups.role});
  }
  // Explicit class exclusion with exact listed examples, not nearest-noun membership inference.
  for(const m of doc.text.matchAll(/(?<category>[\p{L} ]{3,50}) in this context are standalone businesses, as opposed to (?<excluded>[^,.]{5,120}) (?:like|such as) (?<examples>[^.]{3,200})/giu)){
    for(const example of m.groups.examples.split(/\s+(?:or|and)\s+/i))add(m,'membership',`${norm(example)}:${category(m.groups.category)}`,'excluded',{exampleQuote:example,categoryQuote:m.groups.category});
  }
  for(const m of doc.text.matchAll(/\b(?<example>[A-Z][\p{L} ]{2,80}?) is (?:a|an) standalone (?<category>[\p{L} ]{3,50}?)(?= rather than| in this|[,.]|$)/giu)){
    add(m,'membership',`${norm(m.groups.example)}:${category(m.groups.category)}`,'member');
  }
  return{version:FACTOR_VERSION,facts,obligations,coverageVerified:false};
}
function incompatible(c,e){
  if(c.family==='bound'){
    if(c.value===e.value)return false;
    // Source exactlyN entails weak >=N/<=N, but not strict >N/<N.
    if(e.value==='exactly'&&['at least','at most'].includes(c.value))return false;
    return true;
  }
  return c.value!==e.value;
}
export function compareSurfaceFactors(candidate,evidence){
  const c=extractSurfaceFactors(candidate),e=evidence.map(extractSurfaceFactors),source=e.flatMap(x=>x.facts),diagnoses=[],pending=[];
  for(const f of c.facts){
    const matches=source.filter(s=>s.family===f.family&&s.key===f.key);
    if(!matches.length)continue; // No representation is not a diagnosis or coverage certificate.
    const values=new Set(matches.map(m=>m.value));
    if(values.size!==1){pending.push({candidate:f,evidence:matches,reason:'conflicting_registered_factor_values'});continue;}
    if(incompatible(f,matches[0]))diagnoses.push({kind:'factor_not_established',family:f.family,key:f.key,candidate:f,evidence:matches,
      semanticCertification:false,scope:'registered_narrow_explicit_grammar_only'});
  }
  return{version:FACTOR_VERSION,diagnoses,pending,candidate:c,evidence:e,coverageVerified:false};
}
export function overlayFactors(result,guard){
  if(guard.diagnoses.length)return{...result,route:'block',factorGuard:guard,decisionOrigin:'explicit_bound_factor_mismatch'};
  if(guard.pending.length&&result.route==='allow')return{...result,route:'review',factorGuard:guard,decisionOrigin:'ambiguous_factor_alignment'};
  return{...result,factorGuard:guard};
}
