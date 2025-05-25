import { AIRequest, AIGatewayEnhancedConfig, ModelConfig, CloudflareEnv } from '../types'

/**
 * AI Gateway 增强功能服务
 * 基于 Cloudflare AI Gateway 官方最佳实践实现：
 * 1. AI Gateway 认证 (cf-aig-authorization)
 * 2. 自定义成本跟踪 (cf-aig-custom-cost)
 * 3. 智能缓存策略 (cf-aig-cache-ttl, cf-aig-cache-key, cf-aig-skip-cache)
 * 4. 自定义元数据 (cf-aig-metadata)
 */
export class AIGatewayEnhancementService {
  private env: CloudflareEnv

  constructor(env: CloudflareEnv) {
    this.env = env
  }
  
  /**
   * 生成智能缓存键
   */
  async generateCacheKey(request: AIRequest): Promise<string> {
    const keyComponents = [
      request.capability,
      request.provider || 'auto',
      request.model || 'default',
      await this.hashRequestContent(request)
    ]
    
    return `aig_cache:${keyComponents.join(':')}`
  }

  /**
   * 创建 AI Gateway 增强头部
   * 基于官方最佳实践实现认证、成本跟踪和缓存策略
   */
  async createEnhancedHeaders(
    request: AIRequest,
    enhancedConfig?: AIGatewayEnhancedConfig,
    modelConfig?: ModelConfig
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}

    // 1. AI Gateway 认证 - 官方认证头部
    await this.addAuthenticationHeaders(headers, enhancedConfig)

    // 2. 自定义成本跟踪 - 官方成本跟踪头部
    await this.addCostTrackingHeaders(headers, request, enhancedConfig, modelConfig)

    // 3. 智能缓存策略 - 官方缓存头部
    await this.addCacheHeaders(headers, request, enhancedConfig)

    // 4. 自定义元数据 - 官方元数据头部
    await this.addMetadataHeaders(headers, request, enhancedConfig)

    return headers
  }

  /**
   * 添加 AI Gateway 认证头部
   * 使用官方的 cf-aig-authorization 头部
   */
  private async addAuthenticationHeaders(
    headers: Record<string, string>,
    enhancedConfig?: AIGatewayEnhancedConfig
  ): Promise<void> {
    // 优先级：enhancedConfig > 环境变量
    const authToken = enhancedConfig?.auth?.token || this.env.AI_GATEWAY_TOKEN
    
    if (authToken && !enhancedConfig?.auth?.skipAuthentication) {
      headers['cf-aig-authorization'] = authToken.startsWith('Bearer ') 
        ? authToken 
        : `Bearer ${authToken}`
    }

    // 添加自定义认证头部
    if (enhancedConfig?.auth?.customHeaders) {
      Object.assign(headers, enhancedConfig.auth.customHeaders)
    }
  }

  /**
   * 添加自定义成本跟踪头部
   * 使用官方的 cf-aig-custom-cost 头部支持精确成本计算
   */
  private async addCostTrackingHeaders(
    headers: Record<string, string>,
    request: AIRequest,
    enhancedConfig?: AIGatewayEnhancedConfig,
    modelConfig?: ModelConfig
  ): Promise<void> {
    const costConfig = this.buildCostConfig(request, enhancedConfig, modelConfig)
    
    if (Object.keys(costConfig).length > 0) {
      headers['cf-aig-custom-cost'] = JSON.stringify(costConfig)
    }
  }

  /**
   * 构建成本配置对象
   */
  private buildCostConfig(
    request: AIRequest,
    enhancedConfig?: AIGatewayEnhancedConfig,
    modelConfig?: ModelConfig
  ): Record<string, number> {
    const costConfig: Record<string, number> = {}

    // 优先级：enhancedConfig > modelConfig > 默认值
    const customCost = enhancedConfig?.cost
    const modelCost = modelConfig?.cost_per_token

    // Token 成本
    if (customCost?.per_token_in || modelCost?.input) {
      costConfig.per_token_in = customCost?.per_token_in || modelCost?.input || 0
    }
    
    if (customCost?.per_token_out || modelCost?.output) {
      costConfig.per_token_out = customCost?.per_token_out || modelCost?.output || 0
    }

    // 特殊能力的成本模型
    if (request.capability === 'image' && customCost?.per_image) {
      costConfig.per_image = customCost.per_image
    }

    if (request.capability === 'audio' && customCost?.per_second) {
      costConfig.per_second = customCost.per_second
    }

    // 固定请求成本
    if (customCost?.per_request) {
      costConfig.per_request = customCost.per_request
    }

    return costConfig
  }

  /**
   * 添加缓存头部
   * 使用官方的缓存控制头部实现智能缓存策略
   */
  private async addCacheHeaders(
    headers: Record<string, string>,
    request: AIRequest,
    enhancedConfig?: AIGatewayEnhancedConfig
  ): Promise<void> {
    const cacheConfig = enhancedConfig?.cache

    // 跳过缓存
    if (cacheConfig?.skipCache) {
      headers['cf-aig-skip-cache'] = 'true'
      return
    }

    // 缓存 TTL
    const cacheTTL = cacheConfig?.ttl || 
                    parseInt(this.env.DEFAULT_CACHE_TTL || '0') || 
                    this.getDefaultCacheTTL(request)
    headers['cf-aig-cache-ttl'] = cacheTTL.toString()

    // 缓存键
    const cacheKey = cacheConfig?.key || await this.generateCacheKey(request)
    headers['cf-aig-cache-key'] = cacheKey

    // 缓存命名空间
    if (cacheConfig?.cacheNamespace) {
      headers['cf-aig-cache-namespace'] = cacheConfig.cacheNamespace
    }
  }

  /**
   * 添加元数据头部
   * 使用官方的 cf-aig-metadata 头部
   */
  private async addMetadataHeaders(
    headers: Record<string, string>,
    request: AIRequest,
    enhancedConfig?: AIGatewayEnhancedConfig
  ): Promise<void> {
    const metadata: Record<string, any> = {}

    // 基础元数据
    metadata.capability = request.capability
    metadata.provider = request.provider || 'auto'
    metadata.model = request.model || 'default'
    metadata.timestamp = Date.now()

    // 请求特定元数据
    if (request.metadata?.requestId) {
      metadata.requestId = request.metadata.requestId
    }

    if (request.metadata?.userId) {
      metadata.userId = request.metadata.userId
    }

    // 自定义标签
    if (enhancedConfig?.metrics?.customTags) {
      Object.assign(metadata, enhancedConfig.metrics.customTags)
    }

    headers['cf-aig-metadata'] = JSON.stringify(metadata)
  }

  /**
   * 创建默认的增强配置
   */
  async createDefaultEnhancedConfig(request: AIRequest): Promise<AIGatewayEnhancedConfig> {
    return {
      cache: {
        ttl: this.getDefaultCacheTTL(request),
        key: await this.generateCacheKey(request)
      },
      metrics: {
        collectMetrics: true,
        enableLogging: true,
        logLevel: 'info',
        customTags: {
          capability: request.capability,
          provider: request.provider || 'auto',
          model: request.model || 'default'
        }
      },
      fallback: request.fallback || false
    }
  }

  /**
   * 根据请求类型获取默认缓存时间
   */
  private getDefaultCacheTTL(request: AIRequest): number {
    switch (request.capability) {
      case 'embedding':
        return 7200 // 2小时，嵌入结果比较稳定
      case 'image':
        return 86400 // 24小时，图像生成耗时较长
      case 'chat':
        return request.temperature === undefined || request.temperature < 0.1 
          ? 3600 // 1小时，低温度响应较稳定
          : 1800 // 30分钟，高创造性响应
      case 'vision':
        return 3600 // 1小时
      case 'audio':
        return 7200 // 2小时
      default:
        return 3600 // 1小时默认
    }
  }

  /**
   * 哈希请求内容用于缓存键
   */
  private async hashRequestContent(request: AIRequest): Promise<string> {
    // 创建用于哈希的规范化内容
    const contentForHash = {
      capability: request.capability,
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      // 根据能力类型添加特定内容
      ...this.getCapabilitySpecificContent(request)
    }

    // 使用 Web Crypto API
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(contentForHash))
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    
    return hashHex.substring(0, 16) // 取前16位
  }

  /**
   * 获取特定能力的内容用于哈希
   */
  private getCapabilitySpecificContent(request: AIRequest): Record<string, any> {
    switch (request.capability) {
      case 'chat':
        return { 
          messages: (request as any).messages?.map((m: any) => ({ 
            role: m.role, 
            content: m.content 
          })) 
        }
      case 'embedding':
        return { input: (request as any).input }
      case 'image':
        return { 
          prompt: (request as any).prompt,
          size: (request as any).size,
          quality: (request as any).quality,
          style: (request as any).style
        }
      case 'vision':
        return { 
          messages: (request as any).messages?.map((m: any) => ({ 
            role: m.role, 
            content: m.content 
          })) 
        }
      case 'audio':
        return { 
          input: (request as any).input,
          voice: (request as any).voice,
          format: (request as any).format
        }
      default:
        return {}
    }
  }

  /**
   * 验证和清理增强配置
   */
  validateEnhancedConfig(config: AIGatewayEnhancedConfig): AIGatewayEnhancedConfig {
    const validated: AIGatewayEnhancedConfig = { ...config }

    // 验证缓存 TTL 范围 (1分钟到7天)
    if (validated.cache?.ttl) {
      validated.cache.ttl = Math.max(60, Math.min(604800, validated.cache.ttl))
    }

    // 验证成本配置为正数
    if (validated.cost) {
      Object.keys(validated.cost).forEach(key => {
        const value = (validated.cost as any)[key]
        if (typeof value === 'number' && value < 0) {
          delete (validated.cost as any)[key]
        }
      })
    }

    return validated
  }
}
