import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mechanicalFields,lexicalSpan,reportField,mechanicalRoleErrors} from './mechanical-fields.mjs';
import {fixtures} from './minimal-fields.mjs';
import {validateMechanicalRoles,runSplit} from './split-heal.mjs';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const values=r=>Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,v.value]));
test('mechanical: original frozen controls correct; would temporal ambiguity preserved',()=>{
  assert.deepEqual(fixtures().map(f=>values(mechanicalFields(f.verb,f.proposition))),[
    {reportMode:'warn',eventState:'future',polarity:'positive'},
    {reportMode:'confirm',eventState:'completed',polarity:'positive'},
    {reportMode:'say',eventState:'unknown',polarity:'positive'},
    {reportMode:'say',eventState:'completed',polarity:'negative'}]);
});
test('mechanical: non-reporting action and whole clause cannot masquerade as reporting verbs',()=>{
  assert.equal(reportField('has confirmed').value,'confirm');
  for(const verb of ['had already accelerated','said the wording was chosen','fabricated'])assert.equal(reportField(verb).value,'unknown');
});
test('mechanical: ambiguous scope and malformed grammar never default to positive',()=>{
  for(const clause of ['If it happens, it would undermine deterrence','It did not say that it would undermine deterrence','It will accelerate and undermine deterrence','It has never undermined deterrence','It could undermine deterrence','No weapons were deployed','It will accelerated deterrence','It has undermine deterrence','It is harmless']){
    const r=mechanicalFields('said',clause);assert.equal(r.fields.polarity.value,'unknown',clause);assert.equal(r.fields.eventState.value,'unknown',clause);
  }
});
test('mechanical: normal and negated supported auxiliary pairs preserve tense',()=>{
  for(const clause of ['It will accelerate the race','It will not accelerate the race','It had already accelerated the race','It had already not accelerated the race','It did undermine deterrence','It did not undermine deterrence']){
    const r=mechanicalFields('said',clause);assert.equal(r.fields.polarity.value,clause.includes('not')?'negative':'positive');assert.equal(r.fields.eventState.value,clause.includes('will')?'future':'completed');
  }
});
test('mechanical: unique word-bounded spans reject he inside the and repeated mentions',()=>{
  assert.equal(lexicalSpan('the weapon','he'),null);assert.equal(lexicalSpan('Meink said Meink','Meink'),null);assert.deepEqual(lexicalSpan('He said it','He'),{start:0,end:2,exactText:'He'});
});
test('mechanical: all detected role errors are feedback, not just first error',()=>{
  const target={text:'the announcement accelerated the race',sourceId:'source:x'};
  const raw={acts:[{speakerQuote:'he',speakerResolved:'Analysts',recipientQuote:'reporters',verbQuote:'accelerated',propositionQuote:'invented'}]};
  assert.equal(mechanicalRoleErrors(raw,target,[]).length,5);assert.throws(()=>validateMechanicalRoles(raw,target,[]),/speakerQuote.*propositionQuote.*recipientQuote.*speakerResolved.*verbQuote/);
});
test('mechanical runner dry-run remains offline and separate from historical outputs',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('must not call');});
  const r=await runSplit({mechanical:true,out:mkdtempSync(join(tmpdir(),'meridian-mechanical-'))});assert.equal(r.remoteCalls,0);
});
test('mechanical runner calls only role conversion, never LLM field classification',async t=>{
  const old=process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED;process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED='yes';
  t.after(()=>{if(old===undefined)delete process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED;else process.env.STRUCTURED_VERIFIER_REMOTE_AUTHORIZED=old;});
  const sent=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    const prompt=body.messages[0].content;
    const acts=prompt.includes('candidate:p12-s')?[{speakerQuote:'Analysts',speakerResolved:'Analysts',recipientQuote:'',verbQuote:'warned',propositionQuote:'the announcement would accelerate a high-risk arms race with Russia and China in orbit'}]:[];
    return {status:200,json:async()=>({success:true,data:{usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify({acts})}}]}})};
  });
  const out=mkdtempSync(join(tmpdir(),'meridian-mechanical-mock-'));
  await runSplit({remote:true,mechanical:true,out});assert.equal(sent.length,7);
  const result=JSON.parse(readFileSync(`${out}/results.json`));
  const state=result.results.find(r=>r.tag==='candidate:p12-s').states[0].result;
  assert.equal(state.fields.reportMode.value,'warn');assert.equal(state.fields.polarity.value,'positive');assert.equal(state.fields.eventState.value,'unknown');
});
