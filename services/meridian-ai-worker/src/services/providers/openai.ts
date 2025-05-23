
import { AbstractProvider } from './base'
import { ProviderConfig, ModelConfig, AIRequest } from '../../types'
import { getProviderConfig } from '../../config/providers'

export class OpenAIProvider extends AbstractProvider {
  name = 'openai'
  config: ProviderConfig

  constructor(apiKey: string) {
    super(apiKey)
    const config = getProviderConfig('openai')
    if (!config) {
      throw new Error('OpenAI provider configuration not found')
    }
    this.config = config
  }

  protected addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void {
    // OpenAI-specific headers
    if (request.capability === 'vision') {
      headers['OpenAI-Beta'] = 'assistants=v1'
    }
  }

  protected buildEndpointUrl(model: ModelConfig, request: AIRequest): string {
    return `${this.config.base_url}${model.endpoint}`
  }
}
