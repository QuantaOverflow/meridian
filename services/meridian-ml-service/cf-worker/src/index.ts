import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  ML_CONTAINER: DurableObjectNamespace<MeridianMLContainer>;
  API_TOKEN: string;
}

export class MeridianMLContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      API_TOKEN: env.API_TOKEN,
      // 模型路径由 Dockerfile 的 ENV EMBEDDING_MODEL_NAME 指向烤进镜像的本地模型，这里不重复设
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.ML_CONTAINER, 'singleton');
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
