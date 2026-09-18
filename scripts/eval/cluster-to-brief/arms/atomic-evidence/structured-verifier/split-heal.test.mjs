import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRoles, validateState, runSplit } from './split-heal.mjs';
import { BoundedClient } from './runner.mjs';
const target={sourceId:'candidate:x',text:'Analysts warned that it would accelerate.'};
const act={speakerQuote:'Analysts',speakerResolved:'Analysts',recipientQuote:'',verbQuote:'warned',propositionQuote:'it would accelerate'};
test('split: code assigns namespaced IDs; absent spans include field and actual value',()=>{
  assert.equal(validateRoles({acts:[act]},target,[target]).acts[0].id,'candidate:x:report:0');
  assert.throws(()=>validateRoles({acts:[{...act,verbQuote:'confirmed'}]},target,[target]),/verbQuote.*confirmed/);
});
test('split: state may not borrow another reporting verb or temporal cue',()=>{
  const state={reportMode:'warn',reportVerbQuote:'warned',eventState:'future',stateQuote:'would',polarity:'positive',polarityQuote:''};
  assert.deepEqual(validateState(state,target,act),state);
  assert.throws(()=>validateState({...state,reportVerbQuote:'confirmed'},target,act),/frozen verbQuote/);
  assert.throws(()=>validateState({...state,stateQuote:'already'},target,act),/stateQuote/);
});
test('split: dry-run does not call network',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected');});
  assert.equal((await runSplit({out:mkdtempSync(join(tmpdir(),'meridian-split-'))})).remoteCalls,0);
});
test('heal: second attempt receives actual failed output and validator error',async t=>{
  const sent=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    sent.push(JSON.parse(options.body));
    return {status:200,json:async()=>({success:true,data:{usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({value:sent.length===1?'bad':'good'})}}]}})};
  });
  const client=new BoundedClient(mkdtempSync(join(tmpdir(),'meridian-heal-')),{logicalCalls:2,httpAttempts:4,knownTokens:100,timeoutMs:1000});
  await client.request('test',{prompt:'original source',schema:{type:'object'},selfHeal:true},r=>{if(r.value!=='good')throw Error('value: expected good');return r;});
  assert.equal(sent[0].messages.length,1);assert.equal(sent[1].messages.length,3);
  assert.match(sent[1].messages[1].content,/bad/);assert.match(sent[1].messages[2].content,/value: expected good/);
});
