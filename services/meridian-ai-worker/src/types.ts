import type { RequestMetadata } from './types/api'

// =============================================================================
// AI Capabilities
// =============================================================================

// 只剩 chat：其余 capability 从无调用方，已删。
export type AICapability = 'chat'

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

interface BaseAIRequest {
  model?: string
  provider?: string
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
  metadata?: Partial<RequestMetadata>
}

export interface ChatRequest extends BaseAIRequest {
  capability: 'chat'
  messages: ChatMessage[]
}

export type AIRequest = ChatRequest

// =============================================================================
// Message Types
// =============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// =============================================================================
// Unified Response Types
// =============================================================================

interface BaseAIResponse {
  id: string
  provider: string
  model: string
  cached?: boolean
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  processingTime?: number
}

export interface ChatResponse extends BaseAIResponse {
  capability: 'chat'
  choices: Array<{
    message: ChatMessage
    finish_reason: string
  }>
}

export type AIResponse = ChatResponse

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
  query: any
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

// Cloudflare Workers environment with string index signature
export interface CloudflareEnv extends Record<string, string | undefined> {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  DASHSCOPE_API_KEY?: string
  AI_GATEWAY_TOKEN?: string
  // Logging configuration
  LOG_LEVEL?: string
  ENABLE_DETAILED_LOGGING?: string
}
