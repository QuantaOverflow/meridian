import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {probe} from './connection-probe.mjs';
function setup(t){
  t.mock.method(process,'loadEnvFile',()=>{});
  for(const [key,value] of Object.entries({CLOUDFLARE_API_TOKEN:'TEST_SECRET_DO_NOT_LOG',CLOUDFLARE_ACCOUNT_ID:'fake-account',CLOUDFLARE_GATEWAY_ID:'fake-gateway'})){
    const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
  return mkdtempSync(join(tmpdir(),'meridian-connection-'));
}
test('connection: correct fixed official host/gateway, five successes, no credentials in artifacts',async t=>{
  const out=setup(t);const sent=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{sent.push({url,options});return{ok:true,status:200,json:async()=>({success:true,result:{response:'OK',usage:{prompt_tokens:15,completion_tokens:2}}})};});
  const result=await probe({out,count:5});assert.equal(result.successes,5);
  assert.equal(sent[0].options.headers['cf-aig-gateway-id'],'fake-gateway');assert.match(sent[0].url,/^https:\/\/api.cloudflare.com\//);
  assert.ok(!readFileSync(`${out}/result.json`,'utf8').includes('TEST_SECRET_DO_NOT_LOG'));
});
test('connection: auth failure stops, no automatic retry and no fake usage',async t=>{
  const out=setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return{ok:false,status:401,json:async()=>({success:false,errors:[{code:10000}]})};});
  const r=await probe({out,count:5});assert.equal(calls,1);assert.equal(r.successes,0);assert.equal(r.records[0].usageKnown,false);
});
test('connection: successful response with unknown usage stops further calls',async t=>{
  const out=setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return{ok:true,status:200,json:async()=>({success:true,result:{response:'OK'}})};});
  const r=await probe({out,count:5});assert.equal(calls,1);assert.equal(r.records[0].usageKnown,false);
});
test('connection: invalid count blocks network',async()=>{await assert.rejects(probe({count:6}),/1..5/);});
