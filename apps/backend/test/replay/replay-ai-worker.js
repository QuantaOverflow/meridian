// 重放用的 Workers AI 替身（只在 wrangler dev 里跑，永不部署）。
//
// ai-worker 的重放配置把 `AI` 从 Workers AI binding 换成指向本 worker 的 service binding，
// ai-worker 里 `env.AI.run(model, inputs, options)` 就成了对下面 run() 的 RPC 调用。
// 本 worker 不做匹配：把 (model, inputs) 原样转给 runner 起的本地 HTTP 服务（REPLAY_SERVER），
// 匹配 / miss 诊断 / 计数都在 Node 侧（能读写文件）。
//
// 另有 PUT /__seed/<key>：把文章正文写进本地 R2。它和 backend / ai-worker 在同一个
// wrangler dev 进程里、绑同一个 bucket_name，所以写进去的对象对 workflow 可见。
// GET /__r2/<key> 读本地 R2（runner 取产出的观测文件用）。
import { WorkerEntrypoint } from 'cloudflare:workers';

export class ReplayAI extends WorkerEntrypoint {
  async run(model, inputs, options) {
    const res = await fetch(`${this.env.REPLAY_SERVER}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, inputs, options: options ?? null }),
    });
    const text = await res.text();
    if (!res.ok) {
      // 与真 binding 失败同形：抛错，让 ai-worker 自己的错误处理接管（它会包成 "Workers AI binding failed: ..."）
      throw new Error(`REPLAY_MISS ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'PUT' && url.pathname.startsWith('/__seed/')) {
      const key = decodeURIComponent(url.pathname.slice('/__seed/'.length));
      await env.ARTICLES_BUCKET.put(key, await request.arrayBuffer());
      return new Response('ok');
    }
    if (request.method === 'GET' && url.pathname.startsWith('/__r2/')) {
      const key = decodeURIComponent(url.pathname.slice('/__r2/'.length));
      const obj = await env.ARTICLES_BUCKET.get(key);
      return obj ? new Response(obj.body) : new Response('not found', { status: 404 });
    }
    // /__aiw/<path>：直接打 ai-worker 的端点（单条调用的纵向切片验证用）
    if (url.pathname.startsWith('/__aiw/') && env.AIW) {
      const target = new URL(url.pathname.slice('/__aiw'.length) + url.search, 'https://meridian-ai-worker');
      return env.AIW.fetch(new Request(target, request));
    }
    // 多 -c 的 wrangler dev 只把第一个 config 暴露成 HTTP。本 worker 排第一，
    // 其余请求原样转给 backend（service binding），runner 触发 workflow / 查状态都走这里。
    if (env.BACKEND) return env.BACKEND.fetch(request);
    return new Response('replay-ai', { status: 200 });
  },
};
