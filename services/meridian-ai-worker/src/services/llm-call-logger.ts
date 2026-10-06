import { chat } from './workers-ai'
import { dashScopeChat } from './dashscope'
import type { ChatRequest, AIResponse, CloudflareEnv } from '../types'
import { recordLLMCall } from './observe'
import { llmCallKey } from '@meridian/contracts'
import { Logger } from '../utils/logger'

const logger = new Logger({ component: 'llm-call-logger' })

/**
 * LLM 调用阶段，用于 R2 key 分类
 */
export type LLMCallPhase =
  | 'article_analysis'
  | 'brief_generation'
  // 读者端的散文摘要
  | 'tldr_prose_generation'
  // 簇判定：一簇一次，判「是不是一件事」+ 起名。2026-09-05 起取代 storyline 两段式
  // （命名主线 + 逐篇归类），后者已随之删除。
  | 'cluster_judge'
  | 'story_rank'
  // 简报块 v6：一个簇的原文 → 窗口标重点 + 写作 + 改写。与 brief_generation 分开，
  // 免得两条链路的 R2 观测记录互相覆盖。
  | 'brief_block_v6'
  // 简报块 v6 的逐句核查 agent（写作–核查循环，ADR 0010）：一句一个 agent、每步一次调用，
  // 调用量是写作的几十倍，单独一个 phase，callIndex 编号与写作 / 改写互不挤占（见 services/brief-block-v6.ts）。
  | 'brief_block_v6_check'
  // 逐句核查的「一次调用」做法（ADR 0012）：代码取证据、一句一次调用，走 DashScope 而不是 Workers AI binding。
  // 与上面的 agent 核查分开一个 phase：两条路的调用数与花费要分开看，callIndex 也互不挤占。
  | 'brief_block_v6_check_one_call'

export interface TraceContext {
  traceId?: string
  callIndex?: number
}

/**
 * 从请求头里提取 trace 上下文，集中处理 fallback
 */
export function readTraceContext(req: Request | { headers: Headers }): TraceContext {
  const headers = (req as Request).headers
  if (!headers) return {}
  const traceId = headers.get('x-trace-id') || undefined
  const idxRaw = headers.get('x-call-index')
  const callIndex = idxRaw ? parseInt(idxRaw, 10) : undefined
  return { traceId, callIndex: Number.isFinite(callIndex as number) ? callIndex : undefined }
}

/**
 * 调用模型通道（默认 workers-ai.chat；`request.provider` 为 `dashscope` 时走 DashScope）并把 input/output/metadata 落 R2：
 *   llm-calls/{trace_id}/{phase}-{idx 3位}.json
 *
 * 失败不阻塞主流程：R2 写入是 best-effort、异步
 * 没有 trace_id 或 R2 binding 时跳过写入，原样返回 chat 结果
 */
export async function loggedChat(
  ai: Ai,
  env: CloudflareEnv,
  trace: TraceContext,
  phase: LLMCallPhase,
  request: ChatRequest
): Promise<AIResponse> {
  const startedAt = Date.now()
  let response: AIResponse | null = null
  let errMsg: string | undefined
  // 两条通道：只有显式标了 dashscope 的请求（一次调用核查的 phase 默认值）走 DashScope，其余全是 Workers AI binding
  const provider = request.provider === 'dashscope' ? 'dashscope' : 'workers-ai'
  try {
    response = provider === 'dashscope' ? await dashScopeChat(env, request) : await chat(ai, request)
    return response
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    const latencyMs = Date.now() - startedAt
    // 观测 wrapper：这次调用挂到当前步骤下（只在请求带 x-observe: inline 时记，见 observe.ts）
    await recordLLMCall({
      phase,
      provider,
      model: request.model,
      params: {
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        response_format: (request as any).response_format,
      },
      messages: request.messages,
      content: response?.choices?.[0]?.message?.content,
      finishReason: response?.choices?.[0]?.finish_reason,
      usage: response?.usage,
      error: errMsg,
      startedAt,
      latencyMs,
    })
    const bucket = env.ARTICLES_BUCKET
    if (trace.traceId && bucket) {
      const idx = trace.callIndex ?? 0
      const key = llmCallKey(trace.traceId, phase, idx)
      const responseContent = response?.choices?.[0]?.message?.content

      const record = {
        trace_id: trace.traceId,
        phase,
        call_index: idx,
        timestamp: new Date().toISOString(),
        request: {
          // 实际走的通道，不是 request.provider 的原值：Workers AI 的 phase 不带 provider 列
          // （request.provider 常态是 undefined），这一格照旧落 'workers-ai'，格式不因此漂移。
          provider,
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          // 解码参数必须记：不记的话落盘日志里「没下发」和「下发了但模型没认」长得一模一样。
          // 2026-09-08 就因为 response_format 不在这份记录里，差点把「生效」误判成「没透传」。
          response_format: (request as any).response_format,
        },
        response: response
          ? {
              content: responseContent,
              // finish_reason 必须记：截断（length）产出的是残缺 JSON，下游报「响应无 X 字段」，
              // 读起来像模型不配合、实际是预算不够。不记这一格，这两种成因在落盘里分不开。
              finish_reason: response.choices?.[0]?.finish_reason,
              usage: response.usage,
              provider_used: response.provider,
              model_used: response.model,
              processing_time_ms: response.processingTime,
            }
          : null,
        error: errMsg,
        latency_ms: latencyMs,
      }

      // 必须 await：CF Worker 在响应返回后会取消未完成的异步任务，
      // fire-and-forget 的 put 会丢。错误吞掉不影响主流程。
      try {
        await bucket.put(key, JSON.stringify(record, null, 2))
      } catch (err) {
        logger.warn(`[LLMCallLogger] R2 put failed key=${key}:`, undefined, err)
      }
    }
  }
}
