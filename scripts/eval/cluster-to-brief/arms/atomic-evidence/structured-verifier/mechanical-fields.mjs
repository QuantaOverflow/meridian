// Conservative, English-only lexical controls. Not a general semantic parser.
export const MECHANICAL_VERSION = 'mechanical-v0.5';
const modes = { say:'say',says:'say',said:'say',tell:'say',tells:'say',told:'say',warn:'warn',warns:'warn',warned:'warn',confirm:'confirm',confirms:'confirm',confirmed:'confirm',deny:'deny',denies:'deny',denied:'deny',claim:'claim',claims:'claim',claimed:'claim',announce:'other',announced:'other' };
export function lexicalSpans(text, quote) {
  if (!quote) return [];
  let at = text.indexOf(quote);
  const valid = [];
  while(at >= 0) {
    const startOK = !/[\p{L}\p{N}_]/u.test(quote[0]) || at === 0 || !/[\p{L}\p{N}_]/u.test(text[at-1]);
    const end = at + quote.length;
    const endOK = !/[\p{L}\p{N}_]/u.test(quote.at(-1)) || end === text.length || !/[\p{L}\p{N}_]/u.test(text[end]);
    if(startOK && endOK) valid.push({start:at,end,exactText:quote});
    at=text.indexOf(quote,at+1);
  }
  return valid;
}
export function lexicalSpan(text,quote){const spans=lexicalSpans(text,quote);return spans.length===1?spans[0]:null;}
export function reportField(verb) {
  const match=/^(?:(?:has|have|had)\s+)?([a-z]+)$/i.exec(verb);
  const value=match ? modes[match[1].toLowerCase()] : undefined;
  return value ? {value,rule:'explicit-report-verb',cue:verb} : {value:'unknown',rule:null,cue:'',reason:'unsupported_reporting_verb_or_nonatomic_span'};
}
const unknown = reason => ({value:'unknown',rule:null,cue:'',reason});
export function mechanicalFields(verb, proposition) {
  const fields={reportMode:reportField(verb),eventState:unknown('unsupported_clause'),polarity:unknown('unsupported_clause')};
  const clause=proposition.replace(/^that\s+/i,'');
  // Named conjunctions (Russia and China) are not coordinated predicates.
  const guards=clause.replace(/\b[A-Z][a-z]+ and [A-Z][a-z]+\b/g,'NAMED_PAIR');
  if(/["“”]/.test(clause) || /\b(if|unless|whether|because|although|that|which|who|and|or|but|never|without|no|only|may|might|could)\b/i.test(guards)) {
    fields.eventState=unknown('scope_or_modal_requires_semantic_resolution');fields.polarity=unknown('scope_or_modal_requires_semantic_resolution');return {version:MECHANICAL_VERSION,fields,semanticCoverageVerified:false};
  }
  const matches=[...clause.matchAll(/\b(will|would|did|had already|had been|was|has)\s+(not\s+)?(accelerate(?:d)?|undermine(?:d)?|worded|(?:carefully\s+)?chosen|deployed)\b/gi)];
  if(matches.length!==1) return {version:MECHANICAL_VERSION,fields,semanticCoverageVerified:false};
  const m=matches[0],aux=m[1].toLowerCase();
  const predicate=m[3].toLowerCase();
  const grammatical=['will','would','did'].includes(aux)?['accelerate','undermine'].includes(predicate):['accelerated','undermined','worded','chosen','carefully chosen','deployed'].includes(predicate);
  if(!grammatical)return {version:MECHANICAL_VERSION,fields,semanticCoverageVerified:false};
  const rest=clause.slice(0,m.index)+clause.slice(m.index+m[0].length);
  if(/\b(not|is|are|was|were|has|have|had|will|would|did|said|told|warn|confirmed)\b/i.test(rest)) {
    fields.eventState=unknown('multiple_predicates_or_external_negation');fields.polarity=unknown('multiple_predicates_or_external_negation');return {version:MECHANICAL_VERSION,fields,semanticCoverageVerified:false};
  }
  fields.polarity={value:m[2]?'negative':'positive',rule:'single-supported-auxiliary-predicate',cue:m[0]};
  // would is prediction OR hypothetical; lexical cue alone cannot decide.
  if(aux==='would') fields.eventState=unknown('would_prediction_vs_conditional');
  else fields.eventState={value:aux==='will'?'future':'completed',rule:'explicit-supported-auxiliary',cue:m[0]};
  return {version:MECHANICAL_VERSION,fields,semanticCoverageVerified:false};
}
export function mechanicalRoleErrors(raw,target,context) {
  const errors=[];const seen=new Set();
  for(const [i,a] of raw.acts.entries()) {
    for(const k of ['speakerQuote','verbQuote','propositionQuote']) if(!lexicalSpan(target.text,a[k])) errors.push({field:`acts[${i}].${k}`,actual:a[k],reason:'unique exact TARGET span with lexical boundaries required'});
    if(a.recipientQuote&&!lexicalSpan(target.text,a.recipientQuote))errors.push({field:`acts[${i}].recipientQuote`,actual:a.recipientQuote,reason:'unique exact TARGET span or empty required'});
    if(![target,...context].some(d=>lexicalSpan(d.text,a.speakerResolved)))errors.push({field:`acts[${i}].speakerResolved`,actual:a.speakerResolved,reason:'exact referent span in TARGET/CONTEXT required'});
    if(reportField(a.verbQuote).value==='unknown')errors.push({field:`acts[${i}].verbQuote`,actual:a.verbQuote,reason:'unsupported explicit reporting verb; do not use action predicates or whole clauses'});
    const key=JSON.stringify(a);if(seen.has(key))errors.push({field:`acts[${i}]`,reason:'duplicate act'});seen.add(key);
  }
  return errors;
}
