import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  ML_CONTAINER: DurableObjectNamespace<MeridianMLContainer>;
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
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
