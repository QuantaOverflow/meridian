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
import { MockProvider } from './providers/mock'
import { getProvidersForCapability, getAllProviders } from '../config/providers'
import { AuthenticationService } from './auth'
import { Logger } from './logger'
import { RetryService, createRetryConfigFromEnv } from './retry'
import { MetadataService } from './metadata'
import { AIGatewayEnhancementService } from './ai-gateway-enhancement'

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
    
    if (env.CLOUDFLARE_API_TOKEN) {
      this.providers.set('workers-ai', new WorkersAIProvider(env.CLOUDFLARE_API_TOKEN, env))
    }
    
    if (env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new AnthropicProvider(env.ANTHROPIC_API_KEY))
    }

    if (env.GOOGLE_AI_API_KEY) {
      this.providers.set('google-ai-studio', new GoogleAIProvider(env.GOOGLE_AI_API_KEY))
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'cf-aig-cache-ttl': '3600'
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
        provider: providerRequest.provider,
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
              provider: fallbackRequest.provider,
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
      
      default:
        // For unknown providers, keep original endpoint
        return endpoint
    }
  }

  private mapUniversalResponse(response: any, request: AIRequest, usedProvider: string): AIResponse {
    const provider = this.providers.get(usedProvider)!
    return provider.mapResponse(response, request)
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
