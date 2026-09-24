import { ProviderConfig } from '../types'

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'workers-ai': {
    name: 'workers-ai',
    base_url: 'https://api.cloudflare.com/client/v4/accounts',
    auth_header: 'Authorization',
    default_model: '@cf/zai-org/glm-4.7-flash',
    models: [
      {
        name: '@cf/qwen/qwen3-30b-a3b-fp8',
        capabilities: ['chat'],
        endpoint: '/ai/run/@cf/qwen/qwen3-30b-a3b-fp8',
        max_tokens: 32768, // Context window: 32,768 tokens
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000051,  // $0.051 per 1M input tokens
          output: 0.00000034   // $0.34 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 1800,
          enable_cost_tracking: true,
          custom_tags: ['paid', 'workers-ai', 'qwen3', '30b', 'moe', 'fp8']
        }
      },
      {
        // 简报链路全部 phase 与文章分析第二档都用它（见 services/call-llm.ts）。
        name: '@cf/zai-org/glm-4.7-flash',
        capabilities: ['chat'],
        endpoint: '/ai/run/@cf/zai-org/glm-4.7-flash',
        max_tokens: 131072, // Context window: 131,072 tokens
        supports_streaming: true,
        cost_per_token: {
          input: 0.0000000605, // $0.0605 per 1M input tokens
          output: 0.0000004    // $0.40 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 1800,
          enable_cost_tracking: true,
          custom_tags: ['paid', 'workers-ai', 'glm', 'flash', 'long-context']
        }
      },
    ]
  },

  dashscope: {
    name: 'dashscope',
    // DashScope OpenAI-compatible endpoint (chat completions API parity with OpenAI SDK)
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    auth_header: 'Authorization',
    default_model: 'qwen-plus',
    models: [
      {
        name: 'qwen-plus',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.0000008,  // ~¥0.0008 / 1K tokens
          output: 0.000002,
        },
        ai_gateway_config: {
          cache_ttl: 1800,
          enable_cost_tracking: true,
          custom_tags: ['dashscope', 'qwen', 'plus'],
        },
      },
      {
        name: 'qwen-turbo',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.0000003,
          output: 0.0000006,
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          custom_tags: ['dashscope', 'qwen', 'turbo'],
        },
      },
      {
        name: 'qwen-max',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.00002,
          output: 0.00006,
        },
        ai_gateway_config: {
          cache_ttl: 1800,
          enable_cost_tracking: true,
          custom_tags: ['dashscope', 'qwen', 'max'],
        },
      },
      {
        // 跨家族判官通道：与 qwen 异家族，百炼托管，用于 grounding 判官 meta 实验
        // （dashscope custom 路径不带缓存头，cache_ttl 实际不生效，仅作声明）
        name: 'deepseek-v3',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000002,   // ~¥0.002 / 1K tokens
          output: 0.000008,
        },
        ai_gateway_config: {
          cache_ttl: 0,
          enable_cost_tracking: true,
          custom_tags: ['dashscope', 'deepseek', 'judge'],
        },
      },
      {
        // 长文本模型，最大上下文 10M tokens，专为文档摘要/情报合成类任务设计
        name: 'qwen-long',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.0000005,  // ~¥0.0005 / 1K tokens
          output: 0.000002,
        },
        ai_gateway_config: {
          cache_ttl: 1800,
          enable_cost_tracking: true,
          custom_tags: ['dashscope', 'qwen', 'long-context'],
        },
      },
    ],
  },
}

export function getProviderConfig(providerName: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[providerName]
}
