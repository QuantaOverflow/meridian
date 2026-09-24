import { AbstractProvider } from './base'
import { ProviderConfig } from '../../types'
import { getProviderConfig } from '../../config/providers'

/**
 * Workers AI 只经 env.AI binding 调用（AIGatewayService.executeWorkersAIViaBinding），
 * 本类只提供模型表查找与响应解析（mapResponse），不构造 HTTP 请求。
 */
export class WorkersAIProvider extends AbstractProvider {
  name = 'workers-ai'
  config: ProviderConfig

  constructor() {
    super()
    const config = getProviderConfig('workers-ai')
    if (!config) {
      throw new Error('Workers AI provider configuration not found')
    }
    this.config = config
  }

  protected addProviderHeaders(): void {}

  protected buildEndpointUrl(): string {
    throw new Error('Workers AI 走 env.AI binding，不构造 HTTP endpoint')
  }
}
