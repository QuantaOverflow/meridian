import {loadCredentials} from './connection-probe.mjs';
export function createRESTTransport(credentials=loadCredentials(true),fetcher=fetch){
  const {token,account,gateway}=credentials;
  const transport=async(url,options)=>{
    const original=JSON.parse(options.body);const o=original.options;
    if(o?.provider!=='workers-ai'||o?.model!=='@cf/zai-org/glm-4.7-flash')throw Error('REST transport only supports frozen Workers AI model');
    const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${o.model}`,{method:'POST',signal:options.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','cf-aig-gateway-id':gateway,'cf-aig-skip-cache':'true'},body:JSON.stringify({messages:original.messages,max_tokens:o.max_tokens,temperature:o.temperature,response_format:o.response_format,chat_template_kwargs:{enable_thinking:false}})});
    const b=await r.json(),result=b.result??{};
    const data={...result,choices:result.choices??[{finish_reason:result.finish_reason??'stop',message:{content:result.response??''}}],usage:result.usage??b.usage};
    return {status:r.status,json:async()=>r.ok&&b.success!==false?{success:true,data}:{success:false,error:{kind:'REST_request_failed',codes:(b.errors??[]).map(e=>e.code)}}};
  };
  transport.kind='workers-ai-rest-session-v1';return transport;
}
