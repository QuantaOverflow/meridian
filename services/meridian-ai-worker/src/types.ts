// =============================================================================
// AI Capabilities
// =============================================================================

export type AICapability = 'chat' | 'embedding' | 'image' | 'audio' | 'vision'

// =============================================================================
// Authentication Types
// =============================================================================

export interface AuthenticationConfig {
  apiKey?: string
  signature?: string
  requestId?: string
  clientId?: string
  customHeaders?: Record<string, string>
}

// =============================================================================
// Request Metadata Types
// =============================================================================

export interface RequestMetadata {
  requestId: string
  timestamp: number
  userId?: string
  clientId?: string
  userAgent?: string
  ipAddress?: string
  region?: string
  source?: {
    origin?: string
    userAgent?: string
    ip?: string
  }
  cloudflare?: {
    country?: string
    region?: string
    colo?: string
    ray?: string
    visitor?: string
    worker?: string
  }
  headers?: Record<string, string>
  performance?: {
    tokenUsage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
    latency?: {
      totalLatency: number
      providerLatency: number
      gatewayLatency: number
    }
    cost?: {
      estimatedCost: number
      currency: string
    }
  }
  processing?: {
    provider?: string
    model?: string
    capability?: string
    startTime?: number
    duration?: number
  }
  customTags?: Record<string, string>
  traceId?: string
  spanId?: string
  auth?: {
    authenticated: boolean
    userId?: string
    apiKeyUsed?: boolean
    apiKeyHash?: string
    errors?: string[]
  }
  error?: {
    type: string
    message: string
    statusCode?: number
    retryable?: boolean
    code?: number
    retryAttempts?: number
  }
}

// =============================================================================
// Retry Configuration Types
// =============================================================================

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  exponentialBase: number
  retryableStatusCodes: number[]
  retryableErrors: string[]
  // Support alternative property names for backward compatibility
  baseDelay?: number
  maxDelay?: number
  backoffFactor?: number
  jitter?: boolean
  maxAttempts?: number
}

export interface RetryAttempt {
  attemptNumber: number
  delayMs: number
  error?: Error
  timestamp: number
}

// =============================================================================
// Logging Types
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  timestamp: number
  requestId: string
  message: string
  metadata?: Record<string, any>
  error?: Error
  duration?: number
}

// =============================================================================
// Unified Request Types
// =============================================================================

export interface BaseAIRequest {
  model?: string
  provider?: string
  fallback?: boolean
  temperature?: number
  max_tokens?: number
  stream?: boolean
  // Authentication and metadata
  auth?: AuthenticationConfig
  metadata?: Partial<RequestMetadata>
  retryConfig?: Partial<RetryConfig>
}

export interface ChatRequest extends BaseAIRequest {
  capability: 'chat'
  messages: ChatMessage[]
}

export interface EmbeddingRequest extends BaseAIRequest {
  capability: 'embedding'
  input: string | string[]
  dimensions?: number
}

export interface ImageRequest extends BaseAIRequest {
  capability: 'image'
  prompt: string
  size?: string
  quality?: string
  style?: string
  n?: number
}

export interface AudioRequest extends BaseAIRequest {
  capability: 'audio'
  input: string
  voice?: string
  format?: string
  speed?: number
}

export interface VisionRequest extends BaseAIRequest {
  capability: 'vision'
  messages: VisionMessage[]
}

export type AIRequest = ChatRequest | EmbeddingRequest | ImageRequest | AudioRequest | VisionRequest

// =============================================================================
// Message Types
// =============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface VisionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{
    type: 'text' | 'image_url'
    text?: string
    image_url?: { url: string }
  }>
}

// =============================================================================
// Unified Response Types
// =============================================================================

export interface BaseAIResponse {
  id: string
  provider: string
  model: string
  cached?: boolean
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  // Added response metadata
  metadata?: RequestMetadata
  retryAttempts?: RetryAttempt[]
  processingTime?: number
}

export interface ChatResponse extends BaseAIResponse {
  capability: 'chat'
  choices: Array<{
    message: ChatMessage
    finish_reason: string
  }>
}

export interface EmbeddingResponse extends BaseAIResponse {
  capability: 'embedding'
  data: Array<{
    embedding: number[]
    index: number
  }>
}

export interface ImageResponse extends BaseAIResponse {
  capability: 'image'
  data: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export interface AudioResponse extends BaseAIResponse {
  capability: 'audio'
  data: string // base64 encoded audio
}

export interface VisionResponse extends BaseAIResponse {
  capability: 'vision'
  choices: Array<{
    message: ChatMessage
    finish_reason: string
  }>
}

export type AIResponse = ChatResponse | EmbeddingResponse | ImageResponse | AudioResponse | VisionResponse

// =============================================================================
// Provider Configuration
// =============================================================================

export interface ModelConfig {
  name: string
  capabilities: AICapability[]
  endpoint: string
  max_tokens?: number
  supports_streaming?: boolean
  cost_per_token?: {
    input: number
    output: number
  }
  ai_gateway_config?: {
    cache_ttl?: number // Time to live in seconds
    enable_cost_tracking?: boolean
    custom_tags?: string[] // Custom tags for cost tracking and analytics
    cache_namespace?: string
    enable_metrics?: boolean
    enable_logging?: boolean
  }
}

export interface ProviderConfig {
  name: string
  base_url: string
  models: ModelConfig[]
  auth_header: string
  default_model?: string
}

// =============================================================================
// AI Gateway Types
// =============================================================================

export interface AIGatewayRequest {
  provider: string
  endpoint: string
  headers: Record<string, string>
  query: any // For AI Gateway Universal Endpoint format
  // Added for enhanced features
  metadata?: RequestMetadata
  retryConfig?: RetryConfig
  enhancedConfig?: AIGatewayEnhancedConfig
}

// =============================================================================
// AI Gateway Enhanced Features
// =============================================================================

export interface AIGatewayCostConfig {
  per_token_in?: number
  per_token_out?: number
  per_request?: number
  per_image?: number
  per_second?: number
}

export interface AIGatewayCacheConfig {
  ttl?: number // Time to live in seconds
  key?: string // Custom cache key
  skipCache?: boolean
  cacheNamespace?: string
}

export interface AIGatewayAuthConfig {
  token?: string
  skipAuthentication?: boolean
  customHeaders?: Record<string, string>
}

export interface AIGatewayMetricsConfig {
  collectMetrics?: boolean
  customTags?: Record<string, string>
  enableLogging?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
}

export interface AIGatewayEnhancedConfig {
  cost?: AIGatewayCostConfig
  cache?: AIGatewayCacheConfig
  auth?: AIGatewayAuthConfig
  metrics?: AIGatewayMetricsConfig
  fallback?: boolean
  retryConfig?: Partial<RetryConfig>
}

// =============================================================================
// Provider Interface
// =============================================================================

export interface BaseProvider {
  name: string
  config: ProviderConfig
  
  getSupportedCapabilities(): AICapability[]
  getModelsForCapability(capability: AICapability): ModelConfig[]
  getDefaultModel(capability: AICapability): string | undefined
  
  buildRequest(request: AIRequest): AIGatewayRequest
  mapResponse(response: any, originalRequest: AIRequest): AIResponse
}

// =============================================================================
// Capability Handlers
// =============================================================================

export interface CapabilityHandler<TRequest extends AIRequest, TResponse extends AIResponse> {
  capability: AICapability
  buildProviderRequest(request: TRequest, model: ModelConfig): any
  parseProviderResponse(response: any, request: TRequest, model: ModelConfig): TResponse
}

export interface Env {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  CLOUDFLARE_API_TOKEN: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
  // Authentication and security
  API_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
  // Retry configuration
  DEFAULT_MAX_RETRIES?: string
  DEFAULT_RETRY_DELAY_MS?: string
  // Logging configuration
  LOG_LEVEL?: string
  ENABLE_DETAILED_LOGGING?: string
}

// Cloudflare Workers environment with string index signature
export interface CloudflareEnv extends Record<string, string | undefined> {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  CLOUDFLARE_API_TOKEN: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
  // Authentication and security
  API_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
  // AI Gateway enhanced features
  AI_GATEWAY_TOKEN?: string
  ENABLE_AI_GATEWAY_AUTH?: string
  DEFAULT_CACHE_TTL?: string
  ENABLE_COST_TRACKING?: string
  // Retry configuration
  DEFAULT_MAX_RETRIES?: string
  DEFAULT_RETRY_DELAY_MS?: string
  // Logging configuration
  LOG_LEVEL?: string
  ENABLE_DETAILED_LOGGING?: string
}
