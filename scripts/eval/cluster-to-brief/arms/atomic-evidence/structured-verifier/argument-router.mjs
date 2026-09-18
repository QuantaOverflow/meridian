import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {freezeKernelPlan,pairByKernel} from './event-kernel.mjs';
import {hash} from './context-store.mjs';
import {compareReports} from './relation-chain.mjs';
import {lexicalSpans} from './mechanical-fields.mjs';
import {atomicWriteJson} from '../probe.mjs';
export const ARGUMENT_VERSION='argument-router-v0.13';
const ROOT=new URL('../../../out/atomic-evidence/',import.meta.url);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const unique=(text,quote)=>{const spans=lexicalSpans(text,quote);return spans.length===1?spans[0]:null;};
const unresolved=reason=>({status:'unresolved',reason,agentQuote:'',patientQuote:'',spans:{agent:null,patient:null}});
export function routeArguments(act,target,action){
  if(!['accelerate','deploy'].includes(action?.lemma)||!unique(act.propositionQuote,action.actionQuote))return unresolved('unsupported_or_unanchored_action');
  const verb=escape(action.actionQuote),prop=act.propositionQuote;
  let agentFullQuote='',tail='',rule='';
  const explicit=new RegExp(`^(?:that\\s+)?(.+?)\\s+(?:will|would|has|have|had(?: already)?)\\s+${verb}\\s+(.+)$`).exec(prop);
  if(explicit){agentFullQuote=explicit[1];tail=explicit[2];rule='explicit_subject_auxiliary_action_object';}
  else{
    const omitted=new RegExp(`^(?:will|would)\\s+${verb}\\s+(.+)$`).exec(prop),propSpan=unique(target.text,prop);
    if(!omitted||!propSpan)return unresolved('unsupported_clause_form');
    // Exact, bounded relative construction; no nearest-noun inference.
    const prefix=target.text.slice(0,propSpan.start),fragment=prefix.slice(prefix.lastIndexOf(',')+1);
    const relative=new RegExp(`^\\s*in\\s+((?:a|an|the)\\s+[^,;.!?]{1,160})\\s+that\\s+${escape(act.speakerQuote)}\\s+${escape(act.verbQuote)}\\s+$`).exec(fragment);
    if(!relative)return unresolved('inherited_subject_requires_resolution');
    agentFullQuote=relative[1];tail=omitted[1];rule='exact_relative_antecedent_report_overlay';
  }
  const patientQuote=tail.split(/\s+(?:with|in)\s+/)[0].replace(/[.,;]+$/,'').trim();
  if(!agentFullQuote||!patientQuote||/["“”]/.test(agentFullQuote+patientQuote)||/\b(?:and|or|but|that|which|who|not|never|only|no|said|told|warn|warned|confirmed|claimed)\b/i.test(agentFullQuote+' '+patientQuote))return unresolved('coordinated_or_qualified_argument_scope');
  const fullSpan=unique(target.text,agentFullQuote),patientSpan=unique(target.text,patientQuote);
  if(!fullSpan||!patientSpan)return unresolved('argument_anchor_ambiguous_or_absent');
  // Head is only an alignment proposal, not proof that two referents coincide.
  const words=agentFullQuote.match(/[\p{L}\p{N}_]+/gu),agentQuote=words?.at(-1);
  if(!agentQuote)return unresolved('unsupported_nominal_head');
  const localHead=unique(agentFullQuote,agentQuote);
  if(!localHead)return unresolved('ambiguous_nominal_head');
  const agentSpan={sourceId:target.sourceId,start:fullSpan.start+localHead.start,end:fullSpan.start+localHead.end,exactText:agentQuote};
  return{status:'represented',agentQuote,patientQuote,agentFullQuote,spans:{agent:agentSpan,patient:{sourceId:target.sourceId,...patientSpan}},receipt:{rule,fullAgentSpan:{sourceId:target.sourceId,...fullSpan},actionQuote:action.actionQuote,uncomparedObjectSuffix:tail.slice(patientQuote.length),qualifiersVerified:false},semanticIdentityVerified:false};
}
export function replayArguments({out=new URL(`${ARGUMENT_VERSION}/`,ROOT).pathname}={}){
  const plan=freezeKernelPlan(),old=JSON.parse(readFileSync(new URL('event-kernel-v0.12/results.json',ROOT))),kernels={};
  mkdirSync(out,{recursive:true});
  atomicWriteJson(`${out}/plan.json`,{version:ARGUMENT_VERSION,inputHash:hash(old),tasks:plan.tasks,scope:'finite syntax router over unmodified real action outputs; no new LLM or semantic acceptance',remoteCalls:0});
  for(const t of plan.tasks){const action=old.kernels[t.act.id].action;kernels[t.act.id]={action,participants:routeArguments(t.act,t.target,action)};}
  const results=plan.base.cases.map(c=>{
    const evidence=c.sources.flatMap(s=>s.result.acts),previous=old.results.find(r=>r.id===c.id);
    return{id:c.id,reports:c.candidate.result.acts.map(a=>{
      const pair=c.id.startsWith('p12-')?pairByKernel(a,evidence,kernels):previous.reports.find(r=>r.candidate.id===a.id).pair;
      return{candidate:a,pair,comparison:compareReports(a,evidence,pair,old.resolutions),pairOrigin:c.id.startsWith('p12-')?ARGUMENT_VERSION:'reuse_real_v0.11'};
    }),sourceObligations:c.sources.flatMap(s=>s.result.obligations),candidateObligations:c.candidate.result.obligations};
  });
  const result={version:ARGUMENT_VERSION,resolutions:old.resolutions,results,kernels,cost:{additionalRemoteCalls:0,inheritedActionExtractionCost:old.cost},semanticReview:'not_performed',wholeClaimVerdict:'not_implemented',resolutionOrigin:'reuse_real_v0.11'};
  atomicWriteJson(`${out}/results.json`,result);console.log(JSON.stringify({out,kernels,artifactHash:hash(result),pairs:results.flatMap(c=>c.reports.map(r=>({id:r.candidate.id,pairId:r.pair.evidenceActId,status:r.pair.status,proposalHash:r.pair.proposalHash})))},null,2));return result;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)replayArguments();
