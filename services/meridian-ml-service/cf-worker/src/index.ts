import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  ML_CONTAINER: DurableObjectNamespace<MeridianMLContainer>;
  CF_VERSION_METADATA: WorkerVersionMetadata;
}

// 不注入任何环境变量：模型路径由 Dockerfile 的 ENV EMBEDDING_MODEL_NAME 指向烤进镜像的本地模型；
// 不再有 API_TOKEN——唯一入口是 backend 的 service binding（见 wrangler.jsonc 的 workers_dev）。
export class MeridianMLContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.ML_CONTAINER, 'singleton');
    const response = await container.fetch(request);
    // 运维台要的 Cloudflare 版本 id 只有壳知道（容器里只有镜像的构建戳与提交），/health 上用响应头带出去；
    // 消费方：apps/backend/src/lib/ops/services.ts
    if (new URL(request.url).pathname !== '/health') return response;
    const withVersion = new Response(response.body, response);
    withVersion.headers.set('x-meridian-version-id', env.CF_VERSION_METADATA.id);
    return withVersion;
  },
} satisfies ExportedHandler<Env>;
