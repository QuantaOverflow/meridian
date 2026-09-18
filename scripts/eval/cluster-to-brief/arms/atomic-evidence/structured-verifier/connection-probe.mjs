import { mkdirSync, appendFileSync,readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { atomicWriteJson } from '../probe.mjs';
const OUT=new URL('../../../out/atomic-evidence/connection-rest-v1/',import.meta.url).pathname;
export function loadCredentials(session=false) {
  process.loadEnvFile(new URL('../../../../../../services/meridian-ai-worker/.dev.vars',import.meta.url));
  let token=process.env.CLOUDFLARE_API_TOKEN;
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,gateway=process.env.CLOUDFLARE_GATEWAY_ID;
  if(session){
    const env={...process.env};for(const k of ['CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[k];
    let auth;try{auth=JSON.parse(execFileSync(new URL('../../../../../../apps/backend/node_modules/.bin/wrangler',import.meta.url).pathname,['auth','token','--json'],{cwd:'/private/tmp',env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}));}catch{throw Error('existing session credentials unavailable; no new login attempted');}
    token=auth.token??auth.accessToken??auth.access_token??auth.apiToken;
    if(!token)throw Error(`session token field unavailable; metadata keys only: ${Object.keys(auth).join(',')}`);
  }
  if(!token||!account||!gateway)throw Error('missing required Cloudflare credentials; values never logged');
  return {token,account,gateway};
}
export async function probe({out=OUT,count=5,session=false,representative=false,paired=false}={}) {
  if(!Number.isInteger(count)||count<1||count>5)throw Error('count must be 1..5');
  mkdirSync(out,{recursive:true});
  const {token,account,gateway}=loadCredentials(session);
  const model='@cf/zai-org/glm-4.7-flash';
  const frozen=representative?JSON.parse(readFileSync(new URL('../../../out/atomic-evidence/mechanical-v0.5/cache/71a628c0efb15f9d5ff43e34b3d00b12d2855e43180c067a726b51eb5c360929-request.json',import.meta.url),'utf8')):null;
  const records=[];
  for(let i=0;i<count;i++) {
    const useRepresentative=representative&&(!paired||i>0);
    const started=Date.now();let record;
    try {
      const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','cf-aig-gateway-id':gateway,'cf-aig-skip-cache':'true'},signal:AbortSignal.timeout(useRepresentative?45000:30000),body:JSON.stringify({messages:[{role:'user',content:useRepresentative?frozen.prompt:`Connection test ${i+1}. Reply with only OK.`}],max_tokens:useRepresentative?5000:64,temperature:0,chat_template_kwargs:{enable_thinking:false},...(useRepresentative?{response_format:{type:'json_schema',json_schema:frozen.schema}}:{})})});
      const b=await r.json();const result=b.result??{};const content=result.response??result.choices?.[0]?.message?.content??'';
      const usage=result.usage??b.usage??{};
      let parsed=null;try{parsed=JSON.parse(content);}catch{}
      record={index:i+1,workload:useRepresentative?'frozen-role-schema':'short-OK',http:r.status,success:r.ok&&b.success!==false&&(useRepresentative?Array.isArray(parsed?.acts):String(content).trim()==='OK'),elapsedMs:Date.now()-started,errorCodes:(b.errors??[]).map(e=>e.code),output:useRepresentative?parsed:String(content).slice(0,40),inputTokens:usage.prompt_tokens??usage.input_tokens??null,outputTokens:usage.completion_tokens??usage.output_tokens??null,usageKnown:Number.isFinite(usage.prompt_tokens??usage.input_tokens)&&Number.isFinite(usage.completion_tokens??usage.output_tokens)};
    }catch(e){record={index:i+1,http:0,success:false,elapsedMs:Date.now()-started,errorKind:e.name,usageKnown:false};}
    records.push(record);appendFileSync(`${out}/calls.jsonl`,JSON.stringify(record)+'\n');
    atomicWriteJson(`${out}/result.json`,{route:'official REST via AI Gateway header, no wrangler remote binding',model,planned:count,representative,records,credentialsLogged:false,retry:false,semanticCertification:false});
    if(!record.success||!record.usageKnown||records.reduce((n,r)=>n+(r.inputTokens??0)+(r.outputTokens??0),0)>=8000)break;
  }
  return {completed:records.length,successes:records.filter(r=>r.success).length,records,out};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){const session=process.argv.includes('--session'),representative=process.argv.includes('--representative'),paired=process.argv.includes('--paired');probe({session,representative,paired,...(session?{out:OUT.replace('connection-rest-v1',paired?'connection-rest-paired-v1':representative?'connection-rest-representative-v1':'connection-rest-session-v1')}:{}) ,count:paired?2:representative?3:5}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});}
