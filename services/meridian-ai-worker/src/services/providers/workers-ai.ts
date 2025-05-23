
import { AbstractProvider } from './base'
import { ProviderConfig, ModelConfig, AIRequest, CloudflareEnv } from '../../types'
import { getProviderConfig } from '../../config/providers'

export class WorkersAIProvider extends AbstractProvider {
  name = 'workers-ai'
  config: ProviderConfig
  private accountId: string

  constructor(apiToken: string, env: CloudflareEnv) {
    super(apiToken)
    const config = getProviderConfig('workers-ai')
    if (!config) {
      throw new Error('Workers AI provider configuration not found')
    }
    this.config = config
    this.accountId = env.CLOUDFLARE_ACCOUNT_ID
  }

  protected addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void {
    // Workers AI specific headers
    headers['CF-AI-Gateway'] = 'true'
  }

  protected buildEndpointUrl(model: ModelConfig, request: AIRequest): string {
    // Workers AI uses account-specific URLs
    return `${this.config.base_url}/${this.accountId}${model.endpoint}`
  }
}
