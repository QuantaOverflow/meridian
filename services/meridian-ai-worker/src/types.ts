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
}

// =============================================================================
// Unified Request Types
// =============================================================================

interface BaseAIRequest {
  model?: string
  provider?: string
  temperature?: number
  max_tokens?: number
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
}

export interface ProviderConfig {
  models: ModelConfig[]
  default_model?: string
}

// =============================================================================
// Provider Interface
// =============================================================================

export interface BaseProvider {
  config: ProviderConfig
  
  getSupportedCapabilities(): AICapability[]
  getModelsForCapability(capability: AICapability): ModelConfig[]
  getDefaultModel(capability: AICapability): string | undefined
  
  mapResponse(response: any, originalRequest: AIRequest): AIResponse
}

// =============================================================================
// Capability Handlers
// =============================================================================

export interface CapabilityHandler<TRequest extends AIRequest, TResponse extends AIResponse> {
  parseProviderResponse(response: any, model: ModelConfig): TResponse
}

// Cloudflare Workers environment with string index signature
export interface CloudflareEnv extends Record<string, string | undefined> {
  // Logging configuration
  LOG_LEVEL?: string
  ENABLE_DETAILED_LOGGING?: string
}
