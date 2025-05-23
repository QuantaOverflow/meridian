
import { AbstractProvider } from './base'
import { ProviderConfig, ModelConfig, AIRequest } from '../../types'
import { getProviderConfig } from '../../config/providers'

export class AnthropicProvider extends AbstractProvider {
  name = 'anthropic'
  config: ProviderConfig

  constructor(apiKey: string) {
    super(apiKey)
    const config = getProviderConfig('anthropic')
    if (!config) {
      throw new Error('Anthropic provider configuration not found')
    }
    this.config = config
  }

  protected addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void {
    // Anthropic-specific headers
    headers['anthropic-version'] = '2023-06-01'
    if (request.capability === 'vision') {
      headers['anthropic-beta'] = 'tools-2024-04-04'
    }
  }

  protected buildEndpointUrl(model: ModelConfig, request: AIRequest): string {
    return `${this.config.base_url}${model.endpoint}`
  }
}
