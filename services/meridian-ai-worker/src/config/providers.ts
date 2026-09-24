import { ProviderConfig } from '../types'

// 模型表只做两件事：mapResponse 按 model 名查表（不在表里的 model 会被拒），
// 以及请求没带 model 时取 default_model。价格、上下文长度等以 Cloudflare 模型页为准。
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'workers-ai': {
    default_model: '@cf/zai-org/glm-4.7-flash',
    models: [
      // 文章分析第一档（index.ts 的 analysisStrategies）
      { name: '@cf/qwen/qwen3-30b-a3b-fp8', capabilities: ['chat'] },
      // 简报链路全部 phase 与文章分析第二档（见 services/call-llm.ts）
      { name: '@cf/zai-org/glm-4.7-flash', capabilities: ['chat'] },
    ]
  },
}

export function getProviderConfig(providerName: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[providerName]
}
