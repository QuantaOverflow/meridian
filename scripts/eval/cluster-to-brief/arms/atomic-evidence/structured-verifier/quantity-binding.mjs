import {canonicalDecimal} from './numeric.mjs';
export const QUANTITY_VERSION='quantity-binding-v0.14';
// Contiguous count/state/unit relations, never independent keyword hits.
// No fixture IDs, names, fixed counts or reference labels.
export function extractQuantities(doc){
  const facts=[],obligations=[];
  const pattern=/\b(\d[\d,]*(?:\.\d+)?)\s+(completely destroyed|heavily damaged|destroyed|damaged)\s+(areas|architectural elements|elements)\b/gi;
  for(const m of doc.text.matchAll(pattern)){
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(m[1])||doc.text[m.index-1]==='-'){obligations.push({reason:'invalid_or_signed_count',quote:m[0]});continue;}
    let value;try{value=canonicalDecimal(m[1].replaceAll(',',''));}catch{obligations.push({reason:'invalid_decimal',quote:m[0]});continue;}
    const before=doc.text.slice(Math.max(0,m.index-100),m.index).split(/[.;!?]/).at(-1);
    if(/\b(?:not|no|never|if|unless|would|could|might|may|only|less than|more than|about|approximately|at least|at most)\b/i.test(before)){
      obligations.push({reason:'quantity_scope_or_approximation',span:{sourceId:doc.sourceId,start:m.index,end:m.index+m[0].length,exactText:m[0]}});continue;
    }
    facts.push({value,state:m[2].toLowerCase(),unit:m[3].toLowerCase(),span:{sourceId:doc.sourceId,start:m.index,end:m.index+m[0].length,exactText:m[0]}});
  }
  return{version:QUANTITY_VERSION,facts,obligations,coverageVerified:false};
}
export function compareQuantities(candidate,documents){
  const c=extractQuantities(candidate),sources=documents.map(extractQuantities),e=sources.flatMap(s=>s.facts),receipts=[];
  for(const fact of c.facts){
    const matches=e.filter(f=>f.value===fact.value&&f.unit===fact.unit);
    const signatures=new Set(matches.map(f=>f.state));
    if(!matches.length||signatures.size!==1){receipts.push({status:'unresolved',reason:'unique_count_unit_state_binding_required',candidate:fact,evidence:matches});continue;}
    const equal=fact.state===matches[0].state;
    receipts.push({status:equal?'consistent':'state_not_established',reason:equal?'same_contiguous_count_unit_state':'same_contiguous_count_and_unit_different_state',candidate:fact,evidence:matches,semanticPopulationIdentityVerified:false});
  }
  return{version:QUANTITY_VERSION,receipts,obligations:c.obligations,sourceObligations:sources.flatMap(s=>s.obligations),status:receipts.some(r=>r.status==='state_not_established')?'requires_local_review':receipts.length?'represented':'not_covered',coverageVerified:false};
}
