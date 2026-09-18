import {hash} from './context-store.mjs';
import {canonicalDecimal} from './numeric.mjs';
import {compareSurfaceFactors} from './surface-factors.mjs';
export const RELATION_VERSION='relation-factors-v0.18';
const norm=s=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}' ]/gu,' ').replace(/\s+/g,' ').trim();
const units={'sq km':'km2','square kilometres':'km2','square kilometers':'km2','square miles':'mi2','sq miles':'mi2'};
export function extractRelationFactors(doc){
  const facts=[],obligations=[];
  const add=(m,family,key,value,extra={})=>{
    const prefix=doc.text.slice(Math.max(0,m.index-100),m.index).split(/[.;!?]/).at(-1);
    if(/\b(?:if|unless|might|could|may|not|never|denied|refused)\b/i.test(prefix)){obligations.push({family,reason:'scope_requires_review',quote:m[0]});return;}
    facts.push({family,key,value,...extra,receipt:{sourceId:doc.sourceId,start:m.index,end:m.index+m[0].length,exactText:m[0],sourceHash:hash(doc.text)},actorIdentityVerified:false});
  };
  // Use explicitly supplied paired units; no inferred conversion or floating-point arithmetic.
  for(const m of doc.text.matchAll(/\b(?<a>\d[\d,]*) (?<au>sq km|square kilometres|square kilometers)\s*\((?<b>\d[\d,]*) (?<bu>square miles|sq miles)\) of (?<population>seabed|land|territory|forest)\b/gi)){
    try{for(const [number,unit] of [[m.groups.a,m.groups.au],[m.groups.b,m.groups.bu]])add(m,'unit_population',`${norm(m.groups.population)}:${units[unit.toLowerCase()]}`,canonicalDecimal(number));}catch{obligations.push({family:'unit_population',reason:'invalid_count',quote:m[0]});}
  }
  for(const m of doc.text.matchAll(/\b(?<number>\d[\d,]*) (?<unit>sq km|square kilometres|square kilometers|square miles|sq miles) of (?<population>seabed|land|territory|forest)\b/gi)){
    try{add(m,'unit_population',`${norm(m.groups.population)}:${units[m.groups.unit.toLowerCase()]}`,canonicalDecimal(m.groups.number));}catch{obligations.push({family:'unit_population',reason:'invalid_count',quote:m[0]});}
  }
  // Paired preference branches with the SAME explicitly named participant region.
  for(const m of doc.text.matchAll(/\bprefer to negotiate (?<preferred>[^.!?]{5,300}?)(?:,?\s*(?:rather than|as opposed to)) (?<other>[^.!?]{5,200})/gi)){
    const mode=s=>{const a=/\bmultilateral\b/i.test(s),b=/\bbilateral(?:ly)?\b/i.test(s);return a===b?null:a?'multilateral':'bilateral';};
    const first=mode(m.groups.preferred),other=mode(m.groups.other);
    const participants=/\bwith (?:each )?((?:[A-Z][\p{L}]+ ){1,3}(?:country|countries))\b/u.exec(m.groups.preferred)?.[1];
    if(!first||!other||first===other||!participants){obligations.push({family:'preference',reason:'paired_branch_participant_binding_required',quote:m[0]});continue;}
    add(m,'preference',`negotiate:${norm(participants).replace(/\bcountries\b/g,'country')}`,first,{preferredQuote:m.groups.preferred,otherQuote:m.groups.other});
  }
  // Actor+action+unique import-ban event, contrasting all national goods vs a restricted subset.
  // Does NOT map a nationality adjective to a country or conclude real-world legal facts.
  for(const m of doc.text.matchAll(/\b(?:(?:Foreign Secretary|Prime Minister|President|Minister) )?(?<actor>[A-Z][\p{L}]+(?: [A-Z][\p{L}]+){1,2}) (?:(?:last week|on [A-Z][a-z]+) )?(?<action>announced|imposed) an import ban on (?<scope>all goods from [^,.!?]{3,90}|goods from illegal [^,.!?]{3,90}? settlements[^,.!?]{0,60})/gu)){
    add(m,'trade_scope',`${norm(m.groups.actor)}:${norm(m.groups.action)}:import ban`,m.groups.scope.startsWith('all goods')?'all_national_goods':'restricted_settlement_goods',{actorIdentityVerified:true,scopeQuote:m.groups.scope});
  }
  for(const m of doc.text.matchAll(/(?:^|[.!?]\s+)(?<actor>[^,.;!?]{2,120}?) (?<verb>said|says|warned|confirmed|reported) (?<proposition>[^.!?]{6,300})/g)){
    if(/\b(?:not|never|if|unless)\b/i.test(m.groups.actor)||/\b(?:said|says|warned|confirmed|reported)\b/.test(m.groups.proposition))continue;
    const cleaned=m.groups.actor.replace(/^NewsFeed/,'').replace(/\b(?:US|U\.S\.|Vice President|President|Prime Minister|Foreign Secretary|Minister|The|the)\b/g,'');
    const actorTokens=(cleaned.match(/\b[A-Z][a-z]{2,}\b/g)??[]).map(s=>s.toLowerCase());
    if(!actorTokens.length)continue; // Pronouns, generic roles, and unmapped acronyms stay unknown.
    add(m,'report_actor',`${m.groups.verb==='says'?'said':m.groups.verb}:${norm(m.groups.proposition.replace(/^that /,''))}`,actorTokens.join(' '),{actorTokens,actorQuote:m.groups.actor});
  }
  return{version:RELATION_VERSION,facts,obligations,coverageVerified:false};
}
export function compareRelationFactors(candidate,evidence){
  const base=compareSurfaceFactors(candidate,evidence),c=extractRelationFactors(candidate),e=evidence.map(extractRelationFactors),source=e.flatMap(s=>s.facts),diagnoses=[...base.diagnoses],pending=[...base.pending];
  for(const f of c.facts){
    const matches=source.filter(s=>s.family===f.family&&s.key===f.key);if(!matches.length)continue;
    if(new Set(matches.map(s=>s.value)).size!==1){pending.push({candidate:f,evidence:matches,reason:'conflicting_registered_factor_values'});continue;}
    const different=f.family==='report_actor'?!f.actorTokens.some(t=>matches[0].actorTokens.includes(t)):f.value!==matches[0].value;
    if(different)diagnoses.push({kind:'factor_not_established',family:f.family,key:f.key,candidate:f,evidence:matches,semanticCertification:false,scope:'registered_narrow_explicit_grammar_only'});
  }
  return{version:RELATION_VERSION,diagnoses,pending,base,candidate:c,evidence:e,coverageVerified:false};
}
