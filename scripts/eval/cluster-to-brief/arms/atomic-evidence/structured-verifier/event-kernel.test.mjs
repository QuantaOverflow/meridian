import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freezeKernelPlan,actionRequest,participantRequest,validateAction,validateParticipants,kernelKey,pairByKernel} from './event-kernel.mjs';
const plan=freezeKernelPlan(),normal=plan.base.cases.find(c=>c.id==='p12-s'),candidate=normal.candidate.result.acts[0],evidence=normal.sources.flatMap(s=>s.result.acts),warn=evidence.find(a=>a.verbQuote==='warn');
const kernel=(action='accelerate',agent='announcement',patient='arms race')=>({action:{actionQuote:action,lemma:action==='accelerated'?'accelerate':action},participants:{agentQuote:agent,patientQuote:patient}});
test('kernel: four frozen events, two independent transformations, no labels/other candidate',()=>{
  assert.equal(plan.tasks.length,4);assert.equal(plan.limits.logicalCalls,8);
  assert.deepEqual(Object.keys(actionRequest(candidate).schema.properties),['actionQuote']);
  assert.deepEqual(Object.keys(participantRequest(candidate,normal.candidate.target).schema.properties),['agentQuote','patientQuote']);
  assert.ok(!actionRequest(candidate).prompt.includes('Analysts'));assert.ok(!actionRequest(candidate).prompt.includes('p12-s'));assert.ok(!participantRequest(candidate,normal.candidate.target).prompt.includes('had already'));
});
test('kernel: surface inflection handled mechanically, tense retained in independent report fields',()=>{
  const a=validateAction({actionQuote:'accelerate'},candidate);assert.equal(a.lemma,'accelerate');
  assert.throws(()=>validateAction({actionQuote:'accelerated'},candidate));
  assert.equal(kernelKey(kernel('accelerate')),kernelKey(kernel('accelerated')));
  assert.equal(kernelKey({...kernel(),action:{lemma:null}}),null);
});
test('kernel: inherited subject must exist exactly in original same sentence',()=>{
  const p=validateParticipants({agentQuote:'announcement',patientQuote:'arms race'},normal.sources[0].target);assert.ok(p.spans.agent);
  assert.throws(()=>validateParticipants({agentQuote:'Russia caused it',patientQuote:'arms race'},normal.sources[0].target));
});
test('kernel: action plus both participants required; ambiguity never becomes support',()=>{
  const kernels={[candidate.id]:kernel(),[warn.id]:kernel(),[evidence[0].id]:kernel('deploy','US','weapons')};
  const pair=pairByKernel(candidate,evidence,kernels);assert.equal(pair.evidenceActId,warn.id);assert.equal(pair.semanticCorrespondenceVerified,false);
  kernels[warn.id]=kernel('accelerate','military','arms race');assert.equal(pairByKernel(candidate,evidence,kernels).status,'unresolved');
  kernels[warn.id]=kernel();kernels[evidence[0].id]=kernel();assert.equal(pairByKernel(candidate,evidence,kernels).status,'unresolved');
  kernels[candidate.id].participants.patientQuote='';assert.equal(pairByKernel(candidate,evidence,kernels).status,'unresolved');
});
