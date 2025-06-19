import { ProviderConfig } from '../types'

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    name: 'openai',
    base_url: 'https://api.openai.com/v1',
    auth_header: 'Authorization',
    default_model: 'gpt-3.5-turbo',
    models: [
      {
        name: 'gpt-4',
        capabilities: ['chat', 'vision'],
        endpoint: '/chat/completions',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.00003, output: 0.00006 },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for chat
          enable_cost_tracking: true,
          custom_tags: ['premium', 'gpt-4']
        }
      },
      {
        name: 'gpt-4-turbo',
        capabilities: ['chat', 'vision'],
        endpoint: '/chat/completions',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.00001, output: 0.00003 },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for chat
          enable_cost_tracking: true,
          custom_tags: ['premium', 'gpt-4-turbo']
        }
      },
      {
        name: 'gpt-3.5-turbo',
        capabilities: ['chat'],
        endpoint: '/chat/completions',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.0000005, output: 0.0000015 },
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for standard chat
          enable_cost_tracking: true,
          custom_tags: ['standard', 'gpt-3.5']
        }
      },
      {
        name: 'text-embedding-3-large',
        capabilities: ['embedding'],
        endpoint: '/embeddings',
        max_tokens: 8191,
        supports_streaming: false,
        cost_per_token: { input: 0.00000013, output: 0 },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: true,
          custom_tags: ['embedding', 'large']
        }
      },
      {
        name: 'text-embedding-3-small',
        capabilities: ['embedding'],
        endpoint: '/embeddings',
        max_tokens: 8191,
        supports_streaming: false,
        cost_per_token: { input: 0.00000002, output: 0 },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: true,
          custom_tags: ['embedding', 'small']
        }
      },
      {
        name: 'dall-e-3',
        capabilities: ['image'],
        endpoint: '/images/generations',
        max_tokens: 4000,
        supports_streaming: false,
        cost_per_token: { input: 0.04, output: 0 }, // per image
        ai_gateway_config: {
          cache_ttl: 0, // No caching for image generation
          enable_cost_tracking: true,
          custom_tags: ['image', 'dall-e-3']
        }
      },
      {
        name: 'tts-1',
        capabilities: ['audio'],
        endpoint: '/audio/speech',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: { input: 0.000015, output: 0 }, // per character
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for TTS
          enable_cost_tracking: true,
          custom_tags: ['audio', 'tts']
        }
      }
    ]
  },

  anthropic: {
    name: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    auth_header: 'x-api-key',
    default_model: 'claude-3-haiku-20240307',
    models: [
      {
        name: 'claude-3-opus-20240229',
        capabilities: ['chat', 'vision'],
        endpoint: '/messages',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.000015, output: 0.000075 },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for premium chat
          enable_cost_tracking: true,
          custom_tags: ['premium', 'claude-opus']
        }
      },
      {
        name: 'claude-3-sonnet-20240229',
        capabilities: ['chat', 'vision'],
        endpoint: '/messages',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.000003, output: 0.000015 },
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for standard chat
          enable_cost_tracking: true,
          custom_tags: ['standard', 'claude-sonnet']
        }
      },
      {
        name: 'claude-3-haiku-20240307',
        capabilities: ['chat', 'vision'],
        endpoint: '/messages',
        max_tokens: 4096,
        supports_streaming: true,
        cost_per_token: { input: 0.00000025, output: 0.00000125 },
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for fast chat
          enable_cost_tracking: true,
          custom_tags: ['fast', 'claude-haiku']
        }
      }
    ]
  },

  'workers-ai': {
    name: 'workers-ai',
    base_url: 'https://api.cloudflare.com/client/v4/accounts',
    auth_header: 'Authorization',
    default_model: '@cf/meta/llama-2-7b-chat-int8',
    models: [
      {
        name: '@cf/meta/llama-2-7b-chat-int8',
        capabilities: ['chat'],
        endpoint: '/ai/run/@cf/meta/llama-2-7b-chat-int8',
        max_tokens: 2048,
        supports_streaming: true,
        cost_per_token: { input: 0, output: 0 }, // Free tier
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for free models
          enable_cost_tracking: false, // Free, no cost tracking needed
          custom_tags: ['free', 'workers-ai', 'llama']
        }
      },
      {
        name: '@cf/mistral/mistral-7b-instruct-v0.1',
        capabilities: ['chat'],
        endpoint: '/ai/run/@cf/mistral/mistral-7b-instruct-v0.1',
        max_tokens: 2048,
        supports_streaming: true,
        cost_per_token: { input: 0, output: 0 },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: false,
          custom_tags: ['free', 'workers-ai', 'mistral']
        }
      },
      {
        name: '@cf/baai/bge-base-en-v1.5',
        capabilities: ['embedding'],
        endpoint: '/ai/run/@cf/baai/bge-base-en-v1.5',
        max_tokens: 512,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: false,
          custom_tags: ['free', 'workers-ai', 'embedding']
        }
      },
      {
        name: '@cf/baai/bge-small-en-v1.5',
        capabilities: ['embedding'],
        endpoint: '/ai/run/@cf/baai/bge-small-en-v1.5',
        max_tokens: 512,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: false,
          custom_tags: ['free', 'workers-ai', 'embedding', '384d']
        }
      },
      {
        name: '@cf/baai/bge-m3',
        capabilities: ['embedding'],
        endpoint: '/ai/run/@cf/baai/bge-m3',
        max_tokens: 8192, // BGE-M3 supports longer context
        supports_streaming: false,
        cost_per_token: { input: 0.000012, output: 0 }, // $0.012 per M input tokens
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: true, // Enable cost tracking for paid model
          custom_tags: ['paid', 'workers-ai', 'embedding', 'multilingual', 'bge-m3']
        }
      },
      {
        name: '@cf/lykon/dreamshaper-8-lcm',
        capabilities: ['image'],
        endpoint: '/ai/run/@cf/lykon/dreamshaper-8-lcm',
        max_tokens: 77,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 },
        ai_gateway_config: {
          cache_ttl: 0, // No caching for image generation
          enable_cost_tracking: false,
          custom_tags: ['free', 'workers-ai', 'image']
        }
      },
      {
        name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        capabilities: ['chat', 'function_calling'],
        endpoint: '/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        max_tokens: 24000, // Context window: 24,000 tokens
        supports_streaming: true,
        cost_per_token: { 
          input: 0.00000029,  // $0.29 per 1M input tokens
          output: 0.00000225  // $2.25 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for premium model
          enable_cost_tracking: true, // Enable cost tracking for paid model
          custom_tags: ['paid', 'workers-ai', 'llama', '3.3', '70b', 'instruct', 'fp8', 'function-calling']
        }
      }
    ]
  },

  'google-ai-studio': {
    name: 'google-ai-studio',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    auth_header: 'x-goog-api-key',
    default_model: 'gemini-2.0-flash',
    models: [
      // ===== Gemini 2.5 系列 (最新实验性模型) =====
      {
        name: 'gemini-2.5-pro-preview',
        capabilities: ['chat', 'vision', 'audio'],
        endpoint: '/models/gemini-2.5-pro-preview:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000002,     // $2.00 per 1M input tokens (估算)
          output: 0.000008     // $8.00 per 1M output tokens (估算)
        },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for premium model
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.5', 'pro', 'experimental', 'thinking']
        }
      },
      {
        name: 'gemini-2.5-flash-preview',
        capabilities: ['chat', 'vision', 'audio'],
        endpoint: '/models/gemini-2.5-flash-preview:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075,  // $0.075 per 1M input tokens
          output: 0.0000003    // $0.30 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for standard chat
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.5', 'flash', 'experimental', 'thinking']
        }
      },
      {
        name: 'gemini-2.5-flash-native-audio',
        capabilities: ['chat', 'audio', 'speech-to-text', 'text-to-speech'],
        endpoint: '/models/gemini-2.5-flash-native-audio:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.5', 'flash', 'native-audio']
        }
      },
      {
        name: 'gemini-2.5-flash-text-to-speech',
        capabilities: ['text-to-speech'],
        endpoint: '/models/gemini-2.5-flash-text-to-speech:generateContent',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for TTS
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.5', 'flash', 'tts']
        }
      },
      {
        name: 'gemini-2.5-pro-text-to-speech',
        capabilities: ['text-to-speech'],
        endpoint: '/models/gemini-2.5-pro-text-to-speech:generateContent',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: {
          input: 0.000002,
          output: 0.000008
        },
        ai_gateway_config: {
          cache_ttl: 7200,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.5', 'pro', 'tts', 'premium']
        }
      },
      
      // ===== Gemini 2.0 系列 (新一代多模态模型) =====
      {
        name: 'gemini-2.0-flash',
        capabilities: ['chat', 'vision', 'image', 'audio'],
        endpoint: '/models/gemini-2.0-flash:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.0', 'flash', 'multimodal', 'image-gen']
        }
      },
      {
        name: 'gemini-2.0-flash-image-generation',
        capabilities: ['image'],
        endpoint: '/models/gemini-2.0-flash-image-generation:generateContent',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 0, // No caching for image generation
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.0', 'flash', 'image-generation']
        }
      },
      {
        name: 'gemini-2.0-flash-lite',
        capabilities: ['chat', 'vision'],
        endpoint: '/models/gemini-2.0-flash-lite:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.00000005,   // 更低成本的轻量版本
          output: 0.0000002
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.0', 'flash-lite', 'cost-effective']
        }
      },
      {
        name: 'gemini-2.0-flash-live',
        capabilities: ['live-audio', 'live-video', 'chat'],
        endpoint: '/models/gemini-2.0-flash-live:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 0, // No caching for live interactions
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', '2.0', 'flash', 'live', 'real-time']
        }
      },

      // ===== Gemini 1.5 系列 (稳定版本) =====
      {
        name: 'gemini-1.5-flash-8b-001',
        capabilities: ['chat', 'vision'],
        endpoint: '/models/gemini-1.5-flash-8b-001:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075, // $0.075 per 1M input tokens
          output: 0.0000003    // $0.30 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 3600, // 1 hour for standard chat
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', 'flash', '8b', 'cost-effective']
        }
      },
      {
        name: 'gemini-1.5-flash-001',
        capabilities: ['chat', 'vision'],
        endpoint: '/models/gemini-1.5-flash-001:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.000000075,
          output: 0.0000003
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', 'flash']
        }
      },
      {
        name: 'gemini-1.5-pro-001',
        capabilities: ['chat', 'vision'],
        endpoint: '/models/gemini-1.5-pro-001:generateContent',
        max_tokens: 8192,
        supports_streaming: true,
        cost_per_token: {
          input: 0.00000125,  // $1.25 per 1M input tokens
          output: 0.000005    // $5.00 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 1800, // 30 minutes for premium chat
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', 'pro', 'premium']
        }
      },

      // ===== 嵌入模型 =====
      {
        name: 'gemini-embedding-exp',
        capabilities: ['embedding'],
        endpoint: '/models/gemini-embedding-exp:embedContent',
        max_tokens: 2048,
        supports_streaming: false,
        cost_per_token: {
          input: 0.00000001,  // 极低成本的嵌入
          output: 0
        },
        ai_gateway_config: {
          cache_ttl: 7200, // 2 hours for embeddings
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', 'embedding', 'experimental']
        }
      },

      // ===== 专用生成模型 =====
      {
        name: 'imagen-3.0-generate-002',
        capabilities: ['image'],
        endpoint: '/models/imagen-3.0-generate-002:generateImage',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: {
          input: 0.04,  // per image generation
          output: 0
        },
        ai_gateway_config: {
          cache_ttl: 0, // No caching for image generation
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'imagen', '3.0', 'image-generation', 'premium']
        }
      },
      {
        name: 'veo-2.0-generate-001',
        capabilities: ['video'],
        endpoint: '/models/veo-2.0-generate-001:generateVideo',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: {
          input: 0.20,  // per video generation (估算)
          output: 0
        },
        ai_gateway_config: {
          cache_ttl: 0, // No caching for video generation
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'veo', '2.0', 'video-generation', 'premium']
        }
      },

      // ===== 遗留模型 (向后兼容) =====
      {
        name: 'gemini-1.0-pro',
        capabilities: ['chat'],
        endpoint: '/models/gemini-1.0-pro:generateContent',
        max_tokens: 8192,
        supports_streaming: false,
        cost_per_token: {
          input: 0.0000005,   // $0.50 per 1M input tokens
          output: 0.0000015   // $1.50 per 1M output tokens
        },
        ai_gateway_config: {
          cache_ttl: 3600,
          enable_cost_tracking: true,
          enable_metrics: true,
          enable_logging: true,
          custom_tags: ['google-ai', 'gemini', 'legacy', '1.0']
        }
      }
    ]
  }
}

export function getProviderConfig(providerName: string): ProviderConfig | undefined {
  return PROVIDER_CONFIGS[providerName]
}

export function getAllProviders(): string[] {
  return Object.keys(PROVIDER_CONFIGS)
}

export function getProvidersForCapability(capability: string): string[] {
  return Object.entries(PROVIDER_CONFIGS)
    .filter(([_, config]) => 
      config.models.some(model => 
        model.capabilities.includes(capability as any)
      )
    )
    .map(([name, _]) => name)
}
