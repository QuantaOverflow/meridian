import { 
  AIRequest, 
  AIResponse, 
  AIGatewayRequest, 
  CloudflareEnv, 
  BaseProvider,
  AICapability,
  ChatRequest,
  EmbeddingRequest,
  ImageRequest,
  RequestMetadata,
  RetryConfig,
  AuthenticationConfig,
  RetryAttempt,
  AIGatewayEnhancedConfig,
  ModelConfig
} from '../types'
import { OpenAIProvider } from './providers/openai'
import { WorkersAIProvider } from './providers/workers-ai'
import { AnthropicProvider } from './providers/anthropic'
import { GoogleAIProvider } from './providers/google-ai'
import { DashScopeProvider } from './providers/dashscope'
import { MockProvider } from './providers/mock'
import { getProvidersForCapability, getAllProviders } from '../config/providers'
import { AuthenticationService } from './auth'
import { Logger } from './logger'
import { RetryService, createRetryConfigFromEnv } from './retry'
import { MetadataService } from './metadata'
import { AIGatewayEnhancementService } from './ai-gateway-enhancement'

/**
 * env.AI（Workers AI binding）的最小结构。CloudflareEnv 的索引签名限定为 string，
 * 无法在其上声明对象属性，故单独定义、在取用处断言。
 */
interface WorkersAIBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: { gateway?: { id: string; skipCache?: boolean; cacheTtl?: number } }
  ): Promise<any>
}

/**
 * 需要显式关闭思维链的 Workers AI 模型前缀（按模型名前缀匹配）。
 * 见 executeWorkersAIViaBinding 里的说明——这是模型属性（哪些模型的 chat template 默认开 thinking），
 * 不是 phase 选择，故放在 binding 调用处而非 PHASE_DEFAULTS。
 */
const THINKING_OFF_MODELS = ['@cf/zai-org/glm-']

export class AIGatewayService {
  private gatewayUrl: string
  private providers: Map<string, BaseProvider>
  private authService: AuthenticationService
  private logger: Logger
  private retryService: RetryService
  private metadataService: MetadataService
  private defaultRetryConfig: RetryConfig
  private enhancementService: AIGatewayEnhancementService

  constructor(private env: CloudflareEnv, options?: { simplified?: boolean }) {
    this.gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}`
    
    // Initialize services
    this.logger = new Logger(env)
    this.authService = new AuthenticationService(env)
    this.metadataService = new MetadataService()
    
    // Create retry configuration from environment
    const envRetryConfig = createRetryConfigFromEnv(env)
    this.defaultRetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      exponentialBase: 2,
      retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      retryableErrors: ['TIMEOUT', 'NETWORK_ERROR', 'CONNECTION_RESET'],
      ...envRetryConfig
    }
    
    this.retryService = new RetryService(this.logger, this.defaultRetryConfig)
    
    // Initialize AI Gateway enhancement service
    this.enhancementService = new AIGatewayEnhancementService(env)
    
    // Initialize providers
    this.providers = new Map<string, BaseProvider>()
    
    if (env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider(env.OPENAI_API_KEY))
    }
    
    // workers-ai 有两条通道：env.AI binding（预认证，生产走这条）与 REST + API token。
    // 注册条件必须涵盖两者——生产 ai-worker 只绑了 AI，没有 CLOUDFLARE_API_TOKEN secret，
    // 旧条件会让该 provider 从未注册，兜底档直接报 "not available"。
    const workersAIBinding = (env as unknown as { AI?: { run?: unknown } }).AI
    if (env.CLOUDFLARE_API_TOKEN || typeof workersAIBinding?.run === 'function') {
      this.providers.set('workers-ai', new WorkersAIProvider(env.CLOUDFLARE_API_TOKEN, env))
    }
    
    if (env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new AnthropicProvider(env.ANTHROPIC_API_KEY))
    }

    if (env.GOOGLE_AI_API_KEY) {
      this.providers.set('google-ai-studio', new GoogleAIProvider(env.GOOGLE_AI_API_KEY))
    }

    if (env.DASHSCOPE_API_KEY) {
      this.providers.set('dashscope', new DashScopeProvider(env.DASHSCOPE_API_KEY))
    }

    // Add mock provider in development mode or when no real providers are available
    const isDevelopment = env.ENVIRONMENT === 'development' || !env.CLOUDFLARE_ACCOUNT_ID
    if (isDevelopment || this.providers.size === 0) {
      this.providers.set('mock', new MockProvider())
      this.logger.log('info', 'Mock provider added for development/testing', {
        isDevelopment,
        totalProviders: this.providers.size,
        simplified: options?.simplified || false
      })
    }
    
    this.logger.log('info', 'AIGatewayService initialized', {
      gatewayUrl: this.gatewayUrl,
      availableProviders: Array.from(this.providers.keys()),
      retryConfig: this.defaultRetryConfig,
      mode: options?.simplified ? 'simplified' : 'full'
    })
  }

  /**
   * Main entry point for processing HTTP requests with full authentication, retry, and metadata support
   */
  async processRequestWithAuth(request: Request): Promise<Response> {
    const startTime = Date.now()
    let requestMetadata: RequestMetadata | undefined
    let authConfig: AuthenticationConfig

    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return this.createCorsResponse(request)
      }

      // Authenticate request
      const authResult = await this.authService.authenticateRequest(request)
      if (!authResult.isValid) {
        return this.createErrorResponse(401, 'Authentication failed', {
          errors: authResult.errors
        }, request)
      }

      authConfig = authResult.authConfig
      requestMetadata = this.metadataService.createRequestMetadata(request, authConfig)
      
      this.logger.logRequest(
        requestMetadata.requestId,
        request.method,
        request.url,
        requestMetadata
      )

      // Parse AI request from body
      const aiRequest = await this.parseAIRequest(request, authConfig, requestMetadata)
      
      // Process the AI request with retry logic
      const { result: response, attempts } = await this.retryService.executeWithRetry(
        requestMetadata.requestId,
        () => this.processRequest(aiRequest),
        aiRequest.retryConfig
      )
      
      // Enrich response with metadata (保留现有的性能数据)
      response.metadata = {
        ...requestMetadata,
        ...response.metadata  // 保留processRequest中添加的性能数据
      }
      response.retryAttempts = attempts
      response.processingTime = Date.now() - startTime
      
      // Create successful response
      const duration = Date.now() - startTime
      this.logger.logResponse(requestMetadata.requestId, 200, duration, response.provider)
      
      return this.createSuccessResponse(response, requestMetadata, duration, request)

    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      this.logger.log('error', 'Request processing failed', {
        requestId: requestMetadata?.requestId || 'unknown',
        error: errorMessage,
        duration
      }, error instanceof Error ? error : undefined)

      return this.createErrorResponse(500, errorMessage, {
        requestId: requestMetadata?.requestId,
        duration
      }, request)
    }
  }

  /**
   * Process AI request with enhanced metadata and monitoring
   */
  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now()
    
    // Get available providers for this capability
    const availableProviders = this.getAvailableProvidersForCapability(request.capability)
    
    if (availableProviders.length === 0) {
      throw new Error(`No available providers support capability: ${request.capability}`)
    }

    // Validate specified provider if provided
    if (request.provider && !availableProviders.includes(request.provider)) {
      throw new Error(`Provider ${request.provider} is not available or does not support capability: ${request.capability}`)
    }

    // Enrich request metadata with processing info
    if (request.metadata && request.metadata.requestId) {
      const selectedProvider = request.provider || availableProviders[0]
      const provider = this.providers.get(selectedProvider)!
      const model = request.model || provider.getDefaultModel(request.capability) || 'default'
      
      request.metadata = this.metadataService.enrichWithProcessingInfo(
        request.metadata as RequestMetadata,
        {
          provider: selectedProvider,
          model,
          capability: request.capability,
          startTime
        }
      )
    }

    // Custom Providers (e.g. DashScope) 不能走 CF AI Gateway 的 Universal Endpoint，
    // 必须用 provider-specific path: {gatewayUrl}/custom-{slug}/{base-relative-path}
    const customSlugs = new Set(['dashscope'])
    const requestedProvider = request.provider || availableProviders[0]
    if (customSlugs.has(requestedProvider)) {
      try {
        const mappedResponse = await this.executeCustomProviderViaGateway(request, requestedProvider)
        if (request.metadata && request.metadata.requestId) {
          mappedResponse.metadata = this.metadataService.addPerformanceMetrics(request.metadata as RequestMetadata, {
            tokenUsage: {
              promptTokens: mappedResponse.usage?.prompt_tokens || 0,
              completionTokens: mappedResponse.usage?.completion_tokens || 0,
              totalTokens: mappedResponse.usage?.total_tokens || 0,
            },
            latency: { totalLatency: Date.now() - startTime, providerLatency: Date.now() - startTime, gatewayLatency: 0 },
          })
          mappedResponse.processingTime = Date.now() - startTime
        }
        return mappedResponse
      } catch (error) {
        this.logger.logProviderError(
          request.metadata?.requestId || 'unknown',
          requestedProvider,
          error as Error,
          { capability: request.capability, model: request.model }
        )
        throw new Error(`Custom provider via gateway failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Workers AI 走 env.AI binding 而非 HTTP：binding 的凭证由 Worker 部署关系授予，
    // 不依赖 CLOUDFLARE_API_TOKEN（生产 ai-worker 没有该 secret，旧的 Universal Endpoint
    // 路径必然 401 Authentication error，且模型名在转换中丢失回落 default_model）。
    // 传 gateway.id 使流量仍经 AI Gateway，观测/缓存/计费不丢。
    if (requestedProvider === 'workers-ai') {
      try {
        const mappedResponse = await this.executeWorkersAIViaBinding(request)
        if (request.metadata && request.metadata.requestId) {
          mappedResponse.metadata = this.metadataService.addPerformanceMetrics(request.metadata as RequestMetadata, {
            tokenUsage: {
              promptTokens: mappedResponse.usage?.prompt_tokens || 0,
              completionTokens: mappedResponse.usage?.completion_tokens || 0,
              totalTokens: mappedResponse.usage?.total_tokens || 0,
            },
            latency: { totalLatency: Date.now() - startTime, providerLatency: Date.now() - startTime, gatewayLatency: 0 },
          })
          mappedResponse.processingTime = Date.now() - startTime
        }
        return mappedResponse
      } catch (error) {
        this.logger.logProviderError(
          request.metadata?.requestId || 'unknown',
          requestedProvider,
          error as Error,
          { capability: request.capability, model: request.model }
        )
        throw new Error(`Workers AI binding failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Build universal request for AI Gateway compliance
    const { requests: universalRequestData, usedProvider } = await this.buildUniversalRequest(request, availableProviders)

    try {
      const response = await this.executeUniversalRequestWithMetadata(universalRequestData, request.metadata as RequestMetadata)
      const mappedResponse = this.mapUniversalResponse(response, request, usedProvider)
      
      // Add performance metrics with correct usage property mapping
      if (request.metadata && request.metadata.requestId) {
        mappedResponse.metadata = this.metadataService.addPerformanceMetrics(request.metadata as RequestMetadata, {
          tokenUsage: {
            promptTokens: mappedResponse.usage?.prompt_tokens || 0,
            completionTokens: mappedResponse.usage?.completion_tokens || 0,
            totalTokens: mappedResponse.usage?.total_tokens || 0
          },
          latency: {
            totalLatency: Date.now() - startTime,
            providerLatency: Date.now() - startTime,
            gatewayLatency: 0
          }
        })
        
        // 设置处理时间
        mappedResponse.processingTime = Date.now() - startTime
      }
      
      return mappedResponse
    } catch (error) {
      // Log provider error
      const selectedProvider = request.provider || availableProviders[0]
      this.logger.logProviderError(
        request.metadata?.requestId || 'unknown',
        selectedProvider,
        error as Error,
        {
          capability: request.capability,
          model: request.model
        }
      )

      // Add error metadata
      if (request.metadata && request.metadata.requestId) {
        request.metadata = this.metadataService.createErrorMetadata(request.metadata as RequestMetadata, error as Error, {
          provider: selectedProvider,
          errorCategory: 'provider_error'
        })
      }

      throw new Error(`AI Gateway request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Execute universal request with enhanced metadata headers
   */
  private async executeUniversalRequestWithMetadata(requests: any[], metadata?: RequestMetadata): Promise<any> {
    // 缓存策略不在外层设：每个 request item 的 headers 已由 enhancement service
    // 按模型配置带上 cf-aig-cache-ttl / cf-aig-skip-cache，外层硬编码会盖掉 skip
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // Add AI Gateway authentication if available
    if (this.env.AI_GATEWAY_TOKEN) {
      headers['cf-aig-authorization'] = `Bearer ${this.env.AI_GATEWAY_TOKEN}`
    }

    // Add metadata headers
    if (metadata) {
      const metadataHeaders = this.metadataService.createCloudflareHeaders(metadata)
      Object.assign(headers, metadataHeaders)
    }

    // Add enhanced monitoring headers
    headers['cf-aig-collect-metrics'] = 'true'
    headers['cf-aig-enable-logging'] = 'true'
    
    // Add cost tracking if enabled
    if (this.env.ENABLE_COST_TRACKING === 'true') {
      headers['cf-aig-collect-cost'] = 'true'
    }

    const response = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requests)
    })

    // Add debug logging for Universal endpoint requests
    this.logger.log('debug', 'Universal AI Gateway request', {
      url: this.gatewayUrl,
      headers,
      requests,
      metadata: metadata?.requestId
    })

    if (!response.ok) {
      const errorText = await response.text()
      
      // Enhanced error logging for debugging
      this.logger.log('error', 'Universal AI Gateway request failed', {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url: this.gatewayUrl,
        requestCount: requests.length,
        metadata: metadata?.requestId
      })
      
      throw new Error(`AI Gateway Universal request failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    return await response.json()
  }

  /**
   * Parse AI request from HTTP request body
   */
  private async parseAIRequest(
    request: Request,
    authConfig: AuthenticationConfig,
    metadata: RequestMetadata
  ): Promise<AIRequest> {
    let body: any
    
    try {
      const text = await request.text()
      body = text ? JSON.parse(text) : {}
    } catch (error) {
      throw new Error('Invalid JSON in request body')
    }

    // Validate required fields
    if (!body.capability) {
      throw new Error('Missing required field: capability')
    }

    // Add authentication and metadata to request
    const aiRequest: AIRequest = {
      ...body,
      auth: authConfig,
      metadata: { ...metadata, ...body.metadata }
    }

    return aiRequest
  }

  /**
   * Create CORS response for preflight requests
   */
  private createCorsResponse(request: Request): Response {
    const corsHeaders = this.authService.createCorsHeaders(request)
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    })
  }

  /**
   * Create successful response with metadata
   */
  private createSuccessResponse(
    response: AIResponse,
    metadata: RequestMetadata,
    duration: number,
    request: Request
  ): Response {
    const corsHeaders = this.authService.createCorsHeaders(request)
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': metadata.requestId,
        'X-Processing-Time': `${duration}ms`,
        'X-Provider': response.provider,
        ...corsHeaders
      }
    })
  }

  /**
   * Create error response with metadata
   */
  private createErrorResponse(
    status: number,
    message: string,
    details: Record<string, any>,
    request?: Request
  ): Response {
    const corsHeaders = request ? this.authService.createCorsHeaders(request) : {}
    
    const errorResponse = {
      error: {
        message,
        status,
        timestamp: new Date().toISOString(),
        ...details
      }
    }

    return new Response(JSON.stringify(errorResponse), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }

  private getAvailableProvidersForCapability(capability: AICapability): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.getSupportedCapabilities().includes(capability))
      .map(([name, _]) => name)
  }

  private async buildUniversalRequest(request: AIRequest, providers: string[]): Promise<{ requests: any[], usedProvider: string }> {
    const requests: any[] = []
    let usedProvider: string
    
    // Create enhanced configuration
    const enhancedConfig = await this.enhancementService.createDefaultEnhancedConfig(request)
    
    if (request.provider && providers.includes(request.provider)) {
      usedProvider = request.provider
      const provider = this.providers.get(request.provider)!
      const providerRequest = provider.buildRequest(request)
      
      // Get model configuration for cost tracking
      const modelConfig = provider.config.models.find(m => m.name === request.model || m.name === provider.getDefaultModel(request.capability))
      
      // Create enhanced headers
      const enhancedHeaders = await this.enhancementService.createEnhancedHeaders(request, enhancedConfig, modelConfig)
      
      // Merge provider headers with enhanced headers
      const finalHeaders = { ...providerRequest.headers, ...enhancedHeaders }
      
      // Transform endpoint for Universal AI Gateway
      const universalEndpoint = this.transformEndpointForUniversal(providerRequest.provider, providerRequest.endpoint, request.model || provider.getDefaultModel(request.capability))
      
      requests.push({
        provider: this.toGatewayProviderName(providerRequest.provider),
        endpoint: universalEndpoint,
        headers: finalHeaders,
        query: providerRequest.query
      })
      
      if (request.fallback) {
        const fallbackProviders = providers.filter(p => p !== request.provider)
        for (const providerName of fallbackProviders) {
          try {
            const fallbackProvider = this.providers.get(providerName)!
            const fallbackRequest = fallbackProvider.buildRequest(request)
            const fallbackModelConfig = fallbackProvider.config.models.find(m => m.name === request.model || m.name === fallbackProvider.getDefaultModel(request.capability))
            const fallbackEnhancedHeaders = await this.enhancementService.createEnhancedHeaders(request, enhancedConfig, fallbackModelConfig)
            const fallbackFinalHeaders = { ...fallbackRequest.headers, ...fallbackEnhancedHeaders }
            
            // Transform endpoint for Universal AI Gateway
            const fallbackUniversalEndpoint = this.transformEndpointForUniversal(fallbackRequest.provider, fallbackRequest.endpoint, request.model || fallbackProvider.getDefaultModel(request.capability))
            
            requests.push({
              provider: this.toGatewayProviderName(fallbackRequest.provider),
              endpoint: fallbackUniversalEndpoint,
              headers: fallbackFinalHeaders,
              query: fallbackRequest.query
            })
          } catch (error) {
            this.logger.log('warn', `Failed to build fallback request for ${providerName}`, {
              error: (error as Error).message
            })
          }
        }
      }
    } else {
      // Use first available provider if no specific provider requested
      usedProvider = providers[0]
      for (const providerName of providers) {
        try {
          const provider = this.providers.get(providerName)!
          const providerRequest = provider.buildRequest(request)
          const modelConfig = provider.config.models.find(m => m.name === request.model || m.name === provider.getDefaultModel(request.capability))
          const enhancedHeaders = await this.enhancementService.createEnhancedHeaders(request, enhancedConfig, modelConfig)
          const finalHeaders = { ...providerRequest.headers, ...enhancedHeaders }
          
          // Transform endpoint for Universal AI Gateway
          const universalEndpoint = this.transformEndpointForUniversal(providerRequest.provider, providerRequest.endpoint, request.model || provider.getDefaultModel(request.capability))
          
          requests.push({
            provider: providerRequest.provider,
            endpoint: universalEndpoint,
            headers: finalHeaders,
            query: providerRequest.query
          })
          
          if (!request.fallback) {
            break
          }
        } catch (error) {
          this.logger.log('warn', `Failed to build request for ${providerName}`, {
            error: (error as Error).message
          })
        }
      }
    }
    
    return { requests, usedProvider }
  }

  /**
   * Transform provider-specific endpoint to Universal AI Gateway format
   */
  private transformEndpointForUniversal(providerName: string, endpoint: string, modelName: string | undefined): string {
    switch (providerName) {
      case 'workers-ai':
        // For Workers AI, extract model name from the full endpoint URL
        // From: https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/meta/llama-2-7b-chat-int8
        // To: @cf/meta/llama-2-7b-chat-int8
        if (endpoint.includes('/ai/run/')) {
          const modelMatch = endpoint.match(/\/ai\/run\/(.+)$/)
          if (modelMatch && modelMatch[1]) {
            return modelMatch[1]
          }
        }
        // Fallback to model name if available
        return modelName || endpoint
      
      case 'openai':
        // For OpenAI, use the standard endpoint path
        // From: https://api.openai.com/v1/chat/completions
        // To: /chat/completions
        if (endpoint.startsWith('https://api.openai.com/v1')) {
          return endpoint.replace('https://api.openai.com/v1', '')
        }
        return endpoint
      
      case 'anthropic':
        // For Anthropic, use the standard endpoint path
        // Keep the original endpoint format
        return endpoint
      
      case 'google-ai-studio':
        // For Google AI Studio, extract relative path for Universal AI Gateway
        // From: https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b-001:generateContent
        // To: v1beta/models/gemini-1.5-flash-8b-001:generateContent (relative path for AI Gateway)
        if (endpoint.startsWith('https://generativelanguage.googleapis.com/')) {
          return endpoint.replace('https://generativelanguage.googleapis.com/', '')
        }
        // If already a relative path, keep it as is
        return endpoint

      case 'dashscope':
        // Custom Provider registered with base_url = https://dashscope.aliyuncs.com.
        // Universal endpoint expects path relative to that base, e.g. compatible-mode/v1/chat/completions
        if (endpoint.startsWith('https://dashscope.aliyuncs.com/')) {
          return endpoint.replace('https://dashscope.aliyuncs.com/', '')
        }
        return endpoint

      default:
        // For unknown providers, keep original endpoint
        return endpoint
    }
  }

  private mapUniversalResponse(response: any, request: AIRequest, usedProvider: string): AIResponse {
    const provider = this.providers.get(usedProvider)!
    return provider.mapResponse(response, request)
  }

  /**
   * CF AI Gateway 上对 Custom Provider 的 slug 必须用 `custom-{slug}` 前缀。
   * 内部 providers Map 用原生名（如 'dashscope'），发往 CF Gateway 前转换。
   */
  private toGatewayProviderName(providerName: string): string {
    const customSlugs = new Set(['dashscope'])
    return customSlugs.has(providerName) ? `custom-${providerName}` : providerName
  }

  /**
   * Custom Provider 走 CF AI Gateway 的 provider-specific path
   * (Universal endpoint 不支持 Custom Provider)。
   *
   *   URL: {gatewayUrl}/custom-{slug}/{base-relative-path}
   *   Headers:
   *     Authorization: Bearer <provider-key>      (转给阿里云)
   *     cf-aig-authorization: Bearer <cf-token>   (CF Gateway 自己鉴权)
   *   Body: 原生 provider 格式 (本例为 OpenAI 兼容 chat completion)
   */
  /**
   * Workers AI 经 env.AI binding 调用。认证来自 binding 本身（无 API token 依赖），
   * options.gateway 让请求仍走 AI Gateway，保留日志/缓存/成本追踪。
   */
  private async executeWorkersAIViaBinding(request: AIRequest): Promise<AIResponse> {
    const ai = (this.env as unknown as { AI?: WorkersAIBinding }).AI
    if (!ai || typeof ai.run !== 'function') {
      throw new Error('Workers AI binding (env.AI) 未配置')
    }

    const provider = this.providers.get('workers-ai')
    if (!provider) {
      throw new Error('Provider workers-ai not registered')
    }

    if (request.capability !== 'chat') {
      throw new Error(`Workers AI binding 目前只接 chat capability，收到: ${request.capability}`)
    }

    const modelName = request.model || provider.getDefaultModel(request.capability)
    if (!modelName) {
      throw new Error(`No workers-ai model available for capability: ${request.capability}`)
    }

    const chatRequest = request as ChatRequest
    const inputs: Record<string, unknown> = { messages: chatRequest.messages }
    if (chatRequest.max_tokens != null) inputs.max_tokens = chatRequest.max_tokens
    if (chatRequest.temperature != null) inputs.temperature = chatRequest.temperature

    // GLM 系列是 reasoning 模型，chat template 默认开思维链，且 thinking token **计入 max_tokens
    // 并先于正文生成**——预算被吃光时 message.content 直接是 null。实测（2026-08-12，服务端日志）：
    // max_tokens=800 时 content=null / reasoning_content=3468 字符 / finish_reason=length；
    // 关掉后同一 prompt completion_tokens 950→183、耗时 10.7s→2.7s，正文反而更完整。
    // 我们所有 phase 都只要结构化正文（<final_json> / <final_brief> / ```json），思维链纯属负担。
    // 注：reasoning_effort 参数不被 Workers AI 接受（AiError 8001 Invalid input），只能走这个开关。
    if (THINKING_OFF_MODELS.some(prefix => modelName.startsWith(prefix))) {
      inputs.chat_template_kwargs = { enable_thinking: false }
    }

    // 不传 gateway 参数。当前形态经生产日志验证可靠：2026-08-11 真实文章流量
    // "尝试分析 (4/4)" 37 次 → "成功完成分析" 37 次（100%）。
    //
    // ⚠️ 关于 gateway 参数：曾观测到"带 gateway.id 则 240s 无响应"，但该结论建立在
    // **从本机 curl 生产端点**这一种测量上，而那条回程本身不可靠——同一时段本机 curl
    // 屡屡超时的请求，服务端日志显示 worker 早已正常完成。故"带 gateway 会挂起"未经
    // 服务端证据确认，不可当作事实。若要恢复 gateway 观测（日志/缓存/成本统计），
    // 加回参数后**必须用 worker 日志（而非客户端响应）判定成败**。
    const options = undefined

    this.logger.log('debug', 'Workers AI via binding', {
      model: modelName,
      viaGateway: false, // 见上：binding + authenticated gateway 会静默挂起
      thinkingDisabled: inputs.chat_template_kwargs != null, // 生产判定 thinking 是否真关掉的凭据
      requestId: request.metadata?.requestId,
    })

    const body = await ai.run(modelName, inputs, options)
    return provider.mapResponse(body, { ...request, model: modelName })
  }

  private async executeCustomProviderViaGateway(request: AIRequest, providerName: string): Promise<AIResponse> {
    const provider = this.providers.get(providerName)
    if (!provider) {
      throw new Error(`Provider ${providerName} not registered`)
    }

    const providerRequest = provider.buildRequest(request)

    // 把 provider 的完整 URL (https://dashscope.aliyuncs.com/...) 改成相对路径，
    // 再拼到 CF Gateway 的 custom provider path 之后
    const relativePath = this.transformEndpointForUniversal(
      providerRequest.provider,
      providerRequest.endpoint,
      request.model || provider.getDefaultModel(request.capability)
    )
    const url = `${this.gatewayUrl}/${this.toGatewayProviderName(providerName)}/${relativePath}`

    const headers: Record<string, string> = { ...providerRequest.headers }
    if (this.env.AI_GATEWAY_TOKEN) {
      headers['cf-aig-authorization'] = `Bearer ${this.env.AI_GATEWAY_TOKEN}`
    }
    // 本路径绕开 enhancementService（custom provider 不走 Universal Endpoint），故缓存头
    // 必须在此自行下发——providers.ts 的 ai_gateway_config.cache_ttl 对 DashScope 从未生效。
    // 只处理 skipCache：离线 eval 重问需独立采样，缓存会让 n 次采样退化成 1 次。
    // 不下发 cache-ttl，保持生产现状（走 AI Gateway dashboard 的默认缓存策略）。
    if (request.skipCache) {
      headers['cf-aig-skip-cache'] = 'true'
    }

    this.logger.log('debug', 'Custom provider via CF Gateway', {
      url,
      provider: providerName,
      requestId: request.metadata?.requestId,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(providerRequest.query),
    })

    if (!response.ok) {
      const errorText = await response.text()
      this.logger.log('error', 'Custom provider via gateway failed', {
        provider: providerName,
        url,
        status: response.status,
        errorText,
        requestId: request.metadata?.requestId,
      })
      throw new Error(`${providerName} (via CF Gateway) failed: ${response.status} - ${errorText}`)
    }

    const body = await response.json()
    return provider.mapResponse(body, request)
  }

  // Convenience methods for different capabilities
  async chat(request: Omit<ChatRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'chat' })
  }

  async embed(request: Omit<EmbeddingRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'embedding' })
  }

  async generateImage(request: Omit<ImageRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'image' })
  }

  // Provider management methods
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  getProvidersForCapability(capability: AICapability): string[] {
    return this.getAvailableProvidersForCapability(capability)
  }

  getProviderCapabilities(providerName: string): AICapability[] {
    const provider = this.providers.get(providerName)
    return provider ? provider.getSupportedCapabilities() : []
  }

  getModelsForProvider(providerName: string): string[] {
    const provider = this.providers.get(providerName)
    if (!provider) return []
    
    return provider.config.models.map(model => model.name)
  }

  getModelConfigsForProvider(providerName: string): ModelConfig[] {
    const provider = this.providers.get(providerName)
    if (!provider) return []
    
    return provider.config.models
  }
}

// Default export for module compatibility
export default AIGatewayService
