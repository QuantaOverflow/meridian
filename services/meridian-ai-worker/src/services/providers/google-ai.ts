import {
  BaseProvider,
  ProviderConfig,
  AICapability,
  ModelConfig,
  AIRequest,
  AIResponse,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  AIGatewayRequest,
  RequestMetadata,
  RetryConfig
} from '../../types'

export class GoogleAIProvider implements BaseProvider {
  name = 'google-ai-studio'
  config: ProviderConfig

  constructor(private apiKey: string) {
    this.config = {
      name: 'google-ai-studio',
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      auth_header: 'x-goog-api-key',
      models: [
        {
          name: 'gemini-1.5-flash-8b-001',
          capabilities: ['chat'],
          endpoint: '/models/gemini-1.5-flash-8b-001:generateContent',
          max_tokens: 8192,
          supports_streaming: false,
          cost_per_token: {
            input: 0.000000075, // $0.075 per 1M input tokens
            output: 0.0000003    // $0.30 per 1M output tokens
          },
          ai_gateway_config: {
            cache_ttl: 3600,
            enable_cost_tracking: true,
            enable_metrics: true,
            enable_logging: true
          }
        },
        {
          name: 'gemini-1.5-flash-001',
          capabilities: ['chat'],
          endpoint: '/models/gemini-1.5-flash-001:generateContent',
          max_tokens: 8192,
          supports_streaming: false,
          cost_per_token: {
            input: 0.000000075,
            output: 0.0000003
          },
          ai_gateway_config: {
            cache_ttl: 3600,
            enable_cost_tracking: true,
            enable_metrics: true,
            enable_logging: true
          }
        },
        {
          name: 'gemini-1.5-pro-001',
          capabilities: ['chat'],
          endpoint: '/models/gemini-1.5-pro-001:generateContent',
          max_tokens: 8192,
          supports_streaming: false,
          cost_per_token: {
            input: 0.00000125,  // $1.25 per 1M input tokens
            output: 0.000005    // $5.00 per 1M output tokens
          },
          ai_gateway_config: {
            cache_ttl: 3600,
            enable_cost_tracking: true,
            enable_metrics: true,
            enable_logging: true
          }
        }
      ]
    }
  }

  getSupportedCapabilities(): AICapability[] {
    return ['chat']
  }

  getModelsForCapability(capability: AICapability): ModelConfig[] {
    return this.config.models.filter(model => model.capabilities.includes(capability))
  }

  getDefaultModel(capability: AICapability): string | undefined {
    const models = this.getModelsForCapability(capability)
    return models[0]?.name
  }

  buildRequest(request: AIRequest): AIGatewayRequest {
    if (request.capability === 'chat') {
      return this.buildChatRequest(request as ChatRequest)
    }

    throw new Error(`Unsupported capability: ${request.capability}`)
  }

  private buildChatRequest(request: ChatRequest): AIGatewayRequest {
    const model = request.model || this.getDefaultModel('chat')
    const modelConfig = this.config.models.find(m => m.name === model)
    
    if (!modelConfig) {
      throw new Error(`Model ${model} not found`)
    }

    // Convert messages to Gemini format
    const parts = request.messages.map(msg => ({
      text: msg.content
    }))

    const body = {
      contents: [{
        parts: parts
      }],
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.max_tokens ?? modelConfig.max_tokens,
      }
    }

    return {
      provider: this.name,
      endpoint: `${this.config.base_url}${modelConfig.endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        [this.config.auth_header]: this.apiKey
      },
      query: body,
      metadata: request.metadata as RequestMetadata | undefined,
      retryConfig: request.retryConfig as RetryConfig | undefined
    }
  }

  mapResponse(response: any, originalRequest: AIRequest): AIResponse {
    if (originalRequest.capability === 'chat') {
      return this.mapChatResponse(response, originalRequest as ChatRequest)
    }

    throw new Error(`Unsupported capability: ${originalRequest.capability}`)
  }

  private mapChatResponse(response: any, originalRequest: ChatRequest): ChatResponse {
    const candidate = response.candidates?.[0]
    const content = candidate?.content?.parts?.[0]?.text || ''
    
    return {
      id: crypto.randomUUID(),
      capability: 'chat',
      provider: this.name,
      model: originalRequest.model || this.getDefaultModel('chat') || 'gemini-1.5-flash-8b-001',
      choices: [
        {
          message: {
            role: 'assistant',
            content: content
          },
          finish_reason: candidate?.finishReason || 'stop'
        }
      ],
      usage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0
      },
      metadata: originalRequest.metadata as RequestMetadata | undefined
    }
  }
} 