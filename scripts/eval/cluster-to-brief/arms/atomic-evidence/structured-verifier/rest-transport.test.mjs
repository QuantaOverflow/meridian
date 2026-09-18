import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRESTTransport} from './rest-transport.mjs';
const creds={token:'SECRET_FAKE',account:'account',gateway:'gateway'};
const options={provider:'workers-ai',model:'@cf/zai-org/glm-4.7-flash',temperature:0,max_tokens:5000,response_format:{type:'json_schema',json_schema:{type:'object'}}};
test('REST adapter preserves model/schema/thinking-off and normalizes envelope/usage',async()=>{
  let sent;const transport=createRESTTransport(creds,async(url,o)=>{sent={url,...o};return{ok:true,status:200,json:async()=>({success:true,result:{response:'{}',usage:{prompt_tokens:5,completion_tokens:2}}})};});
  const r=await transport('http://localhost:8787',{body:JSON.stringify({messages:[{role:'user',content:'source'}],options})});
  assert.equal((await r.json()).data.choices[0].message.content,'{}');assert.equal((await r.json()).data.usage.prompt_tokens,5);
  assert.equal(sent.headers['cf-aig-gateway-id'],'gateway');assert.deepEqual(JSON.parse(sent.body).response_format,options.response_format);assert.equal(JSON.parse(sent.body).chat_template_kwargs.enable_thinking,false);
});
test('REST adapter authentication failure is sanitized and not automatically retried',async()=>{
  let calls=0;const transport=createRESTTransport(creds,async()=>{calls++;return{ok:false,status:401,json:async()=>({success:false,errors:[{code:10000,message:'SECRET_FAKE'}]})};});
  const r=await transport('',{body:JSON.stringify({options})});assert.equal(r.status,401);assert.ok(!JSON.stringify(await r.json()).includes('SECRET_FAKE'));assert.equal(calls,1);
});
