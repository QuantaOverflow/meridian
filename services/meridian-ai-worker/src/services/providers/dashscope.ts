import { AbstractProvider } from './base'
import { ProviderConfig, ModelConfig, AIRequest } from '../../types'
import { getProviderConfig } from '../../config/providers'

/**
 * DashScope (阿里云 Qwen) provider.
 * Uses the OpenAI-compatible endpoint so the request/response shape matches OpenAI.
 * https://help.aliyun.com/zh/dashscope/developer-reference/compatibility-of-openai-with-dashscope
 */
export class DashScopeProvider extends AbstractProvider {
  name = 'dashscope'
  config: ProviderConfig

  constructor(apiKey: string) {
    super(apiKey)
    const config = getProviderConfig('dashscope')
    if (!config) {
      throw new Error('DashScope provider configuration not found')
    }
    this.config = config
  }

  protected addProviderHeaders(
    _headers: Record<string, string>,
    _request: AIRequest,
    _model: ModelConfig
  ): void {
    // No extra headers required — OpenAI-compatible path uses Authorization: Bearer
  }

  protected buildEndpointUrl(model: ModelConfig, _request: AIRequest): string {
    return `${this.config.base_url}${model.endpoint}`
  }
}
