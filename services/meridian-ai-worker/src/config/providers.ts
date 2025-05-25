
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
