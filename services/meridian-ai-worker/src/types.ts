// =============================================================================
// AI Capabilities
// =============================================================================

export type AICapability = 'chat' | 'embedding' | 'image' | 'audio' | 'vision' | 'video' | 'text-to-speech' | 'speech-to-text' | 'live-audio' | 'live-video' | 'function_calling'

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
  // 解码参数。加它们是因为 glm-4.7-flash 有已知的复读退化（同一条 JSON 逐字重复到 max_tokens
  // 被硬截断，实测同批输入 15 次里发作 4 次），而 frequency_penalty 正是对症的那个旋钮。
  // 此前这三个参数在 /meridian/chat 与 workers-ai binding 两处白名单里都不在，
  // 传了会被静默吞掉且照样返回 200——探针实测 fp=0 与 fp=2 的输出分布逐项重合。
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
  // 结构化输出（Workers AI JSON mode，2025-02-25 起支持，OpenAI 兼容的 response_format）。
  // 加它是因为实测的头号报废形态是**模型压根没开始写 JSON**：28 份抽取响应里 17 份（60%）
  // 把 8192 token 全烧在标签外的散文草稿上，`<final_json>` 一次都没出现。约束式解码下
  // 每个 token 都要符合 schema 文法，这种形态结构上不可能。
  // 不传就是原行为（provider 侧不下发），向后兼容。
  response_format?: { type: 'json_schema'; json_schema: Record<string, unknown> } | { type: 'json_object' }
  // 跳过 AI Gateway 缓存。默认 false（生产走缓存）。
  // 离线 eval 需要独立采样：同 prompt 重问若吃缓存会拿回同一份答案，
  // 把"模型稳定"和"缓存命中"混为一谈，A/B 的真实样本量退化成 1（见 judge 模型 cache_ttl:0 同因）。
  skipCache?: boolean
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
  // Extended for BGE-M3 support
  query?: string
  contexts?: Array<{ text: string }>
  truncate_inputs?: boolean
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

export interface VideoRequest extends BaseAIRequest {
  capability: 'video'
  prompt: string
  duration?: number
  resolution?: string
  fps?: number
  style?: string
  image_input?: string // 可选的输入图像
}

export interface TextToSpeechRequest extends BaseAIRequest {
  capability: 'text-to-speech'
  input: string
  voice?: string
  language?: string
  format?: string
  speed?: number
  pitch?: number
}

export interface SpeechToTextRequest extends BaseAIRequest {
  capability: 'speech-to-text'
  audio: string // base64 encoded audio
  language?: string
  format?: string
}

export interface LiveAudioRequest extends BaseAIRequest {
  capability: 'live-audio'
  audio_stream: string
  session_id?: string
  config?: {
    sample_rate?: number
    encoding?: string
    language?: string
  }
}

export interface LiveVideoRequest extends BaseAIRequest {
  capability: 'live-video'
  video_stream: string
  audio_stream?: string
  session_id?: string
  config?: {
    resolution?: string
    fps?: number
    language?: string
  }
}

export type AIRequest = ChatRequest | EmbeddingRequest | ImageRequest | AudioRequest | VisionRequest | VideoRequest | TextToSpeechRequest | SpeechToTextRequest | LiveAudioRequest | LiveVideoRequest

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
    // Extended for BGE-M3 query/context support
    score?: number
    context_id?: number
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

export interface VideoResponse extends BaseAIResponse {
  capability: 'video'
  data: Array<{
    url?: string
    b64_video?: string
    duration?: number
    resolution?: string
    fps?: number
  }>
}

export interface TextToSpeechResponse extends BaseAIResponse {
  capability: 'text-to-speech'
  data: string // base64 encoded audio
  format?: string
  duration?: number
}

export interface SpeechToTextResponse extends BaseAIResponse {
  capability: 'speech-to-text'
  text: string
  confidence?: number
  language?: string
}

export interface LiveAudioResponse extends BaseAIResponse {
  capability: 'live-audio'
  session_id: string
  response_audio?: string
  text_response?: string
  status: 'listening' | 'processing' | 'responding' | 'completed'
}

export interface LiveVideoResponse extends BaseAIResponse {
  capability: 'live-video'
  session_id: string
  response_video?: string
  response_audio?: string
  text_response?: string
  status: 'processing' | 'responding' | 'completed'
}

export type AIResponse = ChatResponse | EmbeddingResponse | ImageResponse | AudioResponse | VisionResponse | VideoResponse | TextToSpeechResponse | SpeechToTextResponse | LiveAudioResponse | LiveVideoResponse

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
  GOOGLE_AI_API_KEY?: string
  DASHSCOPE_API_KEY?: string
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
  GOOGLE_AI_API_KEY?: string
  DASHSCOPE_API_KEY?: string
  // Authentication and security
  API_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
  // AI Gateway enhanced features
  AI_GATEWAY_TOKEN?: string
  DEFAULT_CACHE_TTL?: string
  ENABLE_COST_TRACKING?: string
  // Retry configuration
  DEFAULT_MAX_RETRIES?: string
  DEFAULT_RETRY_DELAY_MS?: string
  // Logging configuration
  LOG_LEVEL?: string
  ENABLE_DETAILED_LOGGING?: string
}
