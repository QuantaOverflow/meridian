import { USD_PER_1K_NEURONS, type BriefBlockV6CheckFallbackReason } from '@meridian/contracts'
import type { ChatRequest, ChatResponse } from '../types'
import type { DashScopeChat, DashScopeErrorShape } from '../types/one-call-check'
import { Logger } from '../utils/logger'

const logger = new Logger({ component: 'dashscope' })

/**
 * DashScope 通道的模型表兼价目表（只有一次调用核查用，ADR 0012）：每百万 token 的人民币价。
 * 来源：阿里云百炼官方价目页，2026-10-06 读取。不在表里的模型在发请求之前就拒绝。
 */
const DASHSCOPE_MODELS: Record<string, { inputCnyPerM: number; outputCnyPerM: number }> = {
  'qwen3.8-flash': { inputCnyPerM: 0.8, outputCnyPerM: 2.7 },
}
/** 固定汇率：每美元的人民币数（2026-10-06 定，不随行情更新；改它等于改历史成本的口径） */
const CNY_PER_USD = 7.1

/**
 * 会过去的故障（429 / 408 / 5xx / 断连）等一会儿原样重发，取值同 Workers AI 付费模型的服务故障重发
 * （services/workers-ai.ts）：等 2s、4s、8s，各加 0–1s 随机抖动，最多 3 次。
 */
const RESEND_MAX_WAITS = 3
const resendWaitMs = (wait: number) => 2_000 * 2 ** wait + Math.floor(Math.random() * 1_000)

export class DashScopeError extends Error implements DashScopeErrorShape {
  constructor(public kind: Exclude<BriefBlockV6CheckFallbackReason, 'unreadable'>, message: string) {
    super(message)
    this.name = 'DashScopeError'
  }
}

/** 一次请求的结局：拿到回包体，或一个错（`resend` = 值得等一会儿重发） */
type Attempt = { body: any } | { error: DashScopeError; resend: boolean }

async function attempt(url: string, headers: Record<string, string>, payload: string): Promise<Attempt> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: payload })
  } catch (e) {
    return { error: new DashScopeError('provider_error', `DashScope 连接中断: ${e instanceof Error ? e.message : String(e)}`), resend: true }
  }
  const text = await res.text().catch(() => '')
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    // eslint-disable-next-line local/no-swallowed-catch -- 回包不是 JSON（网关的错误页等）：下面按状态码分类，原文带进错误信息
    body = null
  }
  if (res.ok && body) return { body }

  // DashScope 的错误体：{ error: { message, type, code } }
  const code = String(body?.error?.code ?? '')
  const message = `DashScope HTTP ${res.status}${code ? ` ${code}` : ''}: ${body?.error?.message ?? text.slice(0, 300)}`
  if (res.status === 401 || res.status === 403 || code === 'invalid_api_key') return { error: new DashScopeError('auth', message), resend: false }
  if (/DataInspectionFailed|data_inspection_failed/i.test(text)) return { error: new DashScopeError('content_filter', message), resend: false }
  return { error: new DashScopeError('provider_error', message), resend: res.status === 429 || res.status === 408 || res.status >= 500 }
}

function mapResponse(body: any, modelName: string): ChatResponse {
  const choice = body.choices?.[0]
  const content: string = choice?.message?.content ?? ''
  // 空正文响亮地失败，与 Workers AI 通道一致（services/workers-ai.ts 的 mapResponse）
  if (!content) {
    throw new DashScopeError(
      'provider_error',
      `DashScope 返回空正文 (model=${modelName}, finish_reason=${choice?.finish_reason}, completion_tokens=${body.usage?.completion_tokens})`
    )
  }
  // DashScope 报 token 不报 neurons：按价目表折成美元，再按 Workers AI 牌价折成等价 neurons，既有的 neurons 合计就含这笔钱
  const price = DASHSCOPE_MODELS[modelName]
  const promptTokens = Number(body.usage?.prompt_tokens ?? 0)
  const completionTokens = Number(body.usage?.completion_tokens ?? 0)
  const usd = (promptTokens * price.inputCnyPerM + completionTokens * price.outputCnyPerM) / 1_000_000 / CNY_PER_USD
  const usage = { ...body.usage, usd, neurons: (usd / USD_PER_1K_NEURONS) * 1000 }
  return {
    capability: 'chat',
    id: body.id || `chatcmpl-${Date.now()}`,
    provider: 'dashscope',
    model: modelName,
    choices: [{ message: { role: 'assistant' as const, content }, finish_reason: choice?.finish_reason || 'stop' }],
    usage,
  }
}

/**
 * 第二条模型通道：DashScope 的 OpenAI 兼容 chat，经 `env.DASHSCOPE_BASE_URL`（生产指向 Cloudflare AI Gateway）。
 * 只发 model / messages / temperature / max_tokens 与关 thinking；`response_format` 不下发（一次调用核查不用）。
 * 网关缓存一律关（`cf-aig-skip-cache`）：同一句核查多个 epoch 要的是独立的几次回答，缓存会把它们变成一次。
 * 不直接调用：走 callLLM（provider 为 dashscope 的 phase），经 loggedChat 才记日志。
 */
export const dashScopeChat: DashScopeChat = async (env, request: ChatRequest) => {
  const startTime = Date.now()
  const modelName = request.model
  if (!(modelName in DASHSCOPE_MODELS)) throw new DashScopeError('provider_error', `Model not found: ${modelName}`)
  // 没配好按 key 无效处理：不发请求，调用方回退到 agent
  if (!env.DASHSCOPE_BASE_URL || !env.DASHSCOPE_API_KEY) {
    throw new DashScopeError('auth', `DashScope 未配置：缺 ${env.DASHSCOPE_BASE_URL ? 'DASHSCOPE_API_KEY' : 'DASHSCOPE_BASE_URL'}`)
  }

  const url = `${env.DASHSCOPE_BASE_URL.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
    'cf-aig-skip-cache': 'true',
  }
  if (env.AI_GATEWAY_TOKEN) headers['cf-aig-authorization'] = `Bearer ${env.AI_GATEWAY_TOKEN}`
  const payload = JSON.stringify({
    model: modelName,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    enable_thinking: false,
  })

  for (let waits = 0; ; ) {
    const result = await attempt(url, headers, payload)
    if ('body' in result) {
      const response = mapResponse(result.body, modelName)
      response.processingTime = Date.now() - startTime
      return response
    }
    if (!result.resend || waits >= RESEND_MAX_WAITS) throw result.error
    const ms = resendWaitMs(waits++)
    logger.warn(`DashScope 故障，${(ms / 1000).toFixed(1)}s 后原样重发（第 ${waits}/${RESEND_MAX_WAITS} 次等待）`, {
      request_id: request.metadata?.requestId || 'unknown',
      model: modelName,
      error_message: result.error.message,
    })
    await new Promise(r => setTimeout(r, ms))
  }
}
