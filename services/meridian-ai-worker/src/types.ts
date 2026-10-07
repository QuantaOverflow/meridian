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

// ai-worker 的全部 binding、vars（wrangler.toml）与 secret（只有一次调用核查的 DashScope 通道要，ADR 0012）。
// 用 type 而不是 interface：hono 的 Bindings 约束带索引签名，只有类型字面量能隐式满足它
// （interface 不会被推出索引签名），这样不必在这里写 `[k: string]: …` 把任意键放回来。
export type CloudflareEnv = {
  /** Workers AI binding：模型通道（一次调用核查另走 DashScope，见下） */
  AI: Ai
  /**
   * 生产桶，只写 LLM 调用日志（llm-calls/）与传感器读数（observability/sensors/）。
   * 可选：没有这个 binding 时（本地/单测）两处写入都跳过。
   */
  ARTICLES_BUCKET?: R2Bucket
  /**
   * 逐句核查的 epoch 数（写作–核查循环，ADR 0010；wrangler.toml 的 [vars]）：每句独立核查几次，任一次判有问题就算有问题。
   * "0" = 不核查、不改写（只留 v4-pro 写作，兼作回滚开关）；正整数 = 几次；缺省或其他任何值 = 1——
   * 缺了这个变量不会悄悄把核查关掉。
   */
  BRIEF_CHECK_EPOCHS?: string
  /**
   * 逐句核查怎么做（ADR 0012；wrangler.toml 的 [vars]）："one_call" = 代码取证据 + DashScope 一次调用，失败的句子回退到 agent；
   * "agent" = 逐句 agent（ADR 0010 的做法，请求与改动前逐字相同）。缺省或其他任何值 = "agent"（并打 warn）——
   * 写错了不会悄悄不核查，也不会悄悄去调一个没配好的厂商。
   */
  BRIEF_CHECK_MODE?: string
  /**
   * DashScope 的 OpenAI 兼容入口，到 `/compatible-mode/v1` 为止（后面接 `/chat/completions`）。生产指向 Cloudflare AI Gateway 的
   * custom provider：`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/custom-dashscope/compatible-mode/v1`。
   * 是变量不是常量：单测与 replay 把它指到本地 HTTP 服务。
   */
  DASHSCOPE_BASE_URL?: string
  /** DashScope 的 key（secret）。只有 one_call 核查用；缺了按 key 无效处理（回退 agent）。 */
  DASHSCOPE_API_KEY?: string
  /** AI Gateway 自己的鉴权 token（secret，网关开了鉴权才要）；有就带 `cf-aig-authorization` 头。 */
  AI_GATEWAY_TOKEN?: string
  /** 跑在哪个环境（wrangler.toml 的 [vars] 与 [env.staging.vars]）。可选：单测里没有。 */
  ENVIRONMENT?: 'production' | 'staging'
  /** 本次部署的版本 id 与时刻（wrangler.toml 的 [version_metadata]）。可选：单测里没有。 */
  CF_VERSION_METADATA?: WorkerVersionMetadata
  /** 部署的提交：短哈希、标题、工作区是否有未提交改动（"true"/"false"）。scripts/deploy.sh 用 --var 注入，不经脚本部署时没有。 */
  GIT_COMMIT?: string
  GIT_TITLE?: string
  GIT_DIRTY?: string
}
