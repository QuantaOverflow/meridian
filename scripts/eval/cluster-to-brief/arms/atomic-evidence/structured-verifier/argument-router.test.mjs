import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freezeKernelPlan,pairByKernel} from './event-kernel.mjs';
import {routeArguments} from './argument-router.mjs';
const plan=freezeKernelPlan(),normal=plan.base.cases.find(c=>c.id==='p12-s'),bad=plan.base.cases.find(c=>c.id==='p12-u');
const action=q=>({actionQuote:q,lemma:q==='deployed'?'deploy':'accelerate'});
const build=c=>Object.fromEntries(plan.tasks.map(t=>[t.act.id,{action:action(t.act.propositionQuote.includes('deployed')?'deployed':t.act.propositionQuote.includes('accelerated')?'accelerated':'accelerate'),participants:routeArguments(t.act,t.target,action(t.act.propositionQuote.includes('deployed')?'deployed':t.act.propositionQuote.includes('accelerated')?'accelerated':'accelerate'))}]));
test('argument router: explicit event subjects cannot become reporting speakers',()=>{
  const t=plan.tasks.find(t=>t.act.id===normal.candidate.result.acts[0].id),r=routeArguments(t.act,t.target,action('accelerate'));
  assert.equal(r.agentQuote,'announcement');assert.equal(r.patientQuote,'a high-risk arms race');assert.equal(r.semanticIdentityVerified,false);assert.equal(r.receipt.qualifiersVerified,false);
});
test('argument router: exact relative antecedent copied, not first actor in source sentence',()=>{
  const t=plan.tasks.find(t=>t.act.verbQuote==='warn'),r=routeArguments(t.act,t.target,action('accelerate'));
  assert.equal(r.agentQuote,'announcement');assert.equal(r.agentFullQuote,'an extraordinary public announcement');assert.equal(r.receipt.rule,'exact_relative_antecedent_report_overlay');assert.equal(t.target.text.slice(r.spans.agent.start,r.spans.agent.end),'announcement');
  assert.equal(routeArguments({...t.act,speakerQuote:'military'},t.target,action('accelerate')).status,'unresolved');
});
test('argument router: normal/incorrect align to same underlying event, not same tense',()=>{
  const kernels=build();
  for(const c of [normal,bad]){const e=c.sources.flatMap(s=>s.result.acts),p=pairByKernel(c.candidate.result.acts[0],e,kernels);assert.equal(p.status,'proposed');assert.equal(p.evidenceActId,e.find(a=>a.verbQuote==='warn').id);assert.equal(p.semanticCorrespondenceVerified,false);}
  assert.notEqual(normal.candidate.result.acts[0].fields.fields.eventState.value,bad.candidate.result.acts[0].fields.fields.eventState.value);
});
test('argument router: unsupported grammar/negated actors/duplicated references stay unresolved',()=>{
  const target={sourceId:'synthetic',text:'An announcement would accelerate a competition with rivals.'},act={speakerQuote:'analysts',verbQuote:'warn',propositionQuote:target.text};
  assert.equal(routeArguments(act,target,action('accelerate')).patientQuote,'a competition');
  assert.equal(routeArguments({...act,propositionQuote:target.text.replace('would','may')},target,action('accelerate')).status,'unresolved');
  const neg={...target,text:target.text.replace('An announcement','No announcement')};assert.equal(routeArguments({...act,propositionQuote:neg.text},neg,action('accelerate')).status,'unresolved');
  assert.equal(routeArguments(act,{...target,text:target.text+' An announcement.'},action('accelerate')).status,'unresolved');
  const embedded={...target,text:'Analysts said an announcement would accelerate a competition.'};assert.equal(routeArguments({...act,propositionQuote:embedded.text},embedded,action('accelerate')).status,'unresolved');
});
