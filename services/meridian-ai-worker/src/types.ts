import type { RequestMetadata } from './types/api'

// =============================================================================
// Unified Request Types
// =============================================================================

interface BaseAIRequest {
  model: string
  provider?: string
  temperature?: number
  max_tokens?: number
  // 结构化输出（Workers AI JSON mode，2025-02-25 起支持，OpenAI 兼容的 response_format）。
  // 加它是因为实测的头号报废形态是**模型压根没开始写 JSON**：28 份抽取响应里 17 份（60%）
  // 把 8192 token 全烧在标签外的散文草稿上，`<final_json>` 一次都没出现。约束式解码下
  // 每个 token 都要符合 schema 文法，这种形态结构上不可能。
  // 不传就是原行为（provider 侧不下发），向后兼容。
  response_format?: { type: 'json_schema'; json_schema: Record<string, unknown> } | { type: 'json_object' }
  metadata?: Partial<RequestMetadata>
}

export interface ChatRequest extends BaseAIRequest {
  messages: ChatMessage[]
}

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

// ai-worker 的全部 binding（wrangler.toml）。没有字符串 vars，也没有 secret。
// 用 type 而不是 interface：hono 的 Bindings 约束带索引签名，只有类型字面量能隐式满足它
// （interface 不会被推出索引签名），这样不必在这里写 `[k: string]: …` 把任意键放回来。
export type CloudflareEnv = {
  /** Workers AI binding：唯一的模型通道 */
  AI: Ai
  /**
   * 生产桶，只写 LLM 调用日志（llm-calls/）与传感器读数（observability/sensors/）。
   * 可选：没有这个 binding 时（本地/单测）两处写入都跳过。
   */
  ARTICLES_BUCKET?: R2Bucket
}
