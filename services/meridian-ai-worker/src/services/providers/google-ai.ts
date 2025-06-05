import { AbstractProvider } from './base'
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
import { getProviderConfig } from '../../config/providers'

export class GoogleAIProvider extends AbstractProvider {
  name = 'google-ai-studio'
  config: ProviderConfig

  constructor(apiKey: string) {
    super(apiKey)
    const config = getProviderConfig('google-ai-studio')
    if (!config) {
      throw new Error('Google AI Studio provider configuration not found')
    }
    this.config = config
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

  protected addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void {
    // Google AI Studio specific headers
    headers['Content-Type'] = 'application/json'
    // API key is handled by the base class through auth_header configuration
  }

  protected buildEndpointUrl(model: ModelConfig, request: AIRequest): string {
    return `${this.config.base_url}${model.endpoint}`
  }
} 