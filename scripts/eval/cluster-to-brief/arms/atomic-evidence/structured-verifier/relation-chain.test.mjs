import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadChain,resolutionRequest,validateResolution,pairingRequest,validatePair,compareReports,choicePairRequest,validateChoicePair,validateChoiceResolution} from './relation-chain.mjs';
import {finalizeLocalReview} from './relation-review.mjs';
import {hash} from './context-store.mjs';
const plan=loadChain(),get=id=>plan.cases.find(c=>c.id===id);
test('chain: cached real conversions reused and independent-stage prompts omit verdict/labels',()=>{
  assert.equal(plan.cases.length,4);
  const c=get('p11-u'),a=c.candidate.result.acts[0],e=c.sources.flatMap(s=>s.result.acts),request=pairingRequest(a,e);
  assert.ok(!request.prompt.includes(a.speakerQuote));assert.ok(!request.prompt.includes('reportMode'));assert.ok(!request.prompt.includes(c.id));assert.ok(!JSON.stringify(request.schema).includes('supported'));
});
test('chain: exact antecedent contract rejects absent IDs and invented mention',()=>{
  const c=get('p11-s'),e=c.sources.flatMap(s=>s.result.acts),he=e.find(a=>a.speakerQuote==='He'),meink=e.find(a=>a.speakerQuote==='Meink');
  assert.ok(resolutionRequest(he,e,c.context).prompt.includes(c.context[0].text));
  assert.equal(validateResolution({antecedentActId:meink.id,antecedentQuote:'Meink'},e).identity,'meink');
  assert.throws(()=>validateResolution({antecedentActId:meink.id,antecedentQuote:'invented person'},e));
  assert.throws(()=>validateResolution({antecedentActId:he.id,antecedentQuote:'He'},e));
});
test('chain: pair selection alone never bypasses independent semantic review',()=>{
  const c=get('p12-u'),a=c.candidate.result.acts[0],e=c.sources.flatMap(s=>s.result.acts),warn=e.find(a=>a.verbQuote==='warn');
  const p=validatePair({evidenceActId:warn.id,candidateContentQuote:'arms race',evidenceContentQuote:'arms race'},a,e),r=compareReports(a,e,p);
  assert.equal(r.status,'requires_local_review');assert.equal(r.provisionalStatus,'not_supported');assert.ok(r.receipts.some(r=>r.field==='reportMode'&&r.status==='not_established'));assert.equal(r.wholeClaimVerdict,'not_implemented');
  assert.throws(()=>validatePair({evidenceActId:warn.id,candidateContentQuote:'invented phrase',evidenceContentQuote:'arms race'},a,e));
});
test('chain: wrong speaker visible, while missing pronoun resolution stays pending',()=>{
  const c=get('p11-u'),a=c.candidate.result.acts[1],e=c.sources.flatMap(s=>s.result.acts),he=e.find(a=>a.speakerQuote==='He'),meink=e.find(a=>a.speakerQuote==='Meink');
  const p=validatePair({evidenceActId:he.id,candidateContentQuote:'revealing more',evidenceContentQuote:'revealing more'},a,e);
  assert.equal(compareReports(a,e,p).receipts.find(r=>r.field==='speaker').status,'unresolved');
  const resolution=validateResolution({antecedentActId:meink.id,antecedentQuote:'Meink'},e);
  assert.equal(compareReports(a,e,p,{[he.id]:resolution}).receipts.find(r=>r.field==='speaker').status,'not_established');
});
test('chain: same normal mode and speaker do not turn unknown time into passed whole claim',()=>{
  const c=get('p12-s'),a=c.candidate.result.acts[0],e=c.sources.flatMap(s=>s.result.acts),warn=e.find(a=>a.verbQuote==='warn');
  const p=validatePair({evidenceActId:warn.id,candidateContentQuote:'arms race',evidenceContentQuote:'arms race'},a,e),r=compareReports(a,e,p);
  assert.equal(r.receipts.find(r=>r.field==='speaker').status,'consistent');assert.equal(r.provisionalStatus,'pending');
});
test('chain: integer choice eliminates copied IDs and rejects nonexistent choices',()=>{
  const c=get('p11-s'),a=c.candidate.result.acts[0],e=c.sources.flatMap(s=>s.result.acts);
  assert.ok(!choicePairRequest(a,e).prompt.includes(c.id));
  assert.equal(validateChoiceResolution({choice:1},e).identity,'meink');assert.throws(()=>validateChoiceResolution({choice:2},e));
  const p=validateChoicePair({choice:1,candidateContentQuote:'announcement',evidenceContentQuote:'announcement'},a,e);assert.equal(p.evidenceActId,e[0].id);
});
test('chain: rejected/absent semantic review cannot turn a mechanical mismatch into rejection',()=>{
  const c=get('p12-u'),a=c.candidate.result.acts[0],e=c.sources.flatMap(s=>s.result.acts),warn=e.find(a=>a.verbQuote==='warn');
  const pair=validatePair({evidenceActId:warn.id,candidateContentQuote:'arms race',evidenceContentQuote:'arms race'},a,e),comparison=compareReports(a,e,pair);
  const data={version:'unit',resolutions:{},results:[{id:c.id,reports:[{candidate:a,pair,comparison}]}]};
  const audit={artifactHash:hash(data),evaluator:'main_codex_local_nonblind',pairs:[],resolutions:[]};
  assert.equal(finalizeLocalReview(data,audit).results[0].wholeClaimVerdict,'pending');
  audit.pairs=[{candidateActId:a.id,proposalHash:pair.proposalHash,accepted:true,speakerIdentityReviewed:true}];
  assert.equal(finalizeLocalReview(data,audit).results[0].wholeClaimVerdict,'not_supported_in_registered_evidence');
  assert.throws(()=>finalizeLocalReview(data,{...audit,artifactHash:'stale'}));
});
