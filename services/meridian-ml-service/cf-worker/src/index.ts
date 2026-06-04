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
      // 用烤进镜像的本地模型(Dockerfile COPY ./model-cache → /home/appuser/model),
      // 别用 HF 名:那会让每次冷启动去 HuggingFace 下载(慢+受限流,Dockerfile 注释明说"to avoid HF rate limits")。
      // 本地路径加载已验证可用。详见 memory: ml-service-cold-start。
      EMBEDDING_MODEL_NAME: '/home/appuser/model',
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.ML_CONTAINER, 'singleton');
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
