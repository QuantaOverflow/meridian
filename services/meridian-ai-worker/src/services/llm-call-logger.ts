import type { AIGatewayService } from './ai-gateway'
import type { ChatRequest, AIResponse, ChatResponse, CloudflareEnv } from '../types'
import { recordLLMCall } from './observe'

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
  // 简报块 v6：一个簇的原文 → 窗口标重点 + 一次写作。与 brief_generation 分开，
  // 免得两条链路的 R2 观测记录互相覆盖。
  | 'brief_block_v6'

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
  const traceId = headers.get('x-trace-id') || headers.get('X-Trace-ID') || undefined
  const idxRaw = headers.get('x-call-index') || headers.get('X-Call-Index')
  const callIndex = idxRaw ? parseInt(idxRaw, 10) : undefined
  return { traceId, callIndex: Number.isFinite(callIndex as number) ? callIndex : undefined }
}

/**
 * 调用 ai-gateway.chat 并把 input/output/metadata 落 R2：
 *   llm-calls/{trace_id}/{phase}-{idx 3位}.json
 *
 * 失败不阻塞主流程：R2 写入是 best-effort、异步
 * 没有 trace_id 或 R2 binding 时跳过写入，原样返回 chat 结果
 */
export async function loggedChat(
  aiGateway: AIGatewayService,
  env: CloudflareEnv,
  trace: TraceContext,
  phase: LLMCallPhase,
  request: Omit<ChatRequest, 'capability'>
): Promise<AIResponse> {
  const startedAt = Date.now()
  let response: AIResponse | null = null
  let errMsg: string | undefined
  try {
    response = await aiGateway.chat(request)
    return response
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    const latencyMs = Date.now() - startedAt
    const chat = response && response.capability === 'chat' ? (response as ChatResponse) : null
    // 观测 wrapper：这次调用挂到当前步骤下（只在请求带 x-observe: inline 时记，见 observe.ts）
    await recordLLMCall({
      phase,
      model: request.model,
      params: {
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        frequency_penalty: (request as any).frequency_penalty,
        response_format: (request as any).response_format,
      },
      messages: request.messages,
      content: chat?.choices?.[0]?.message?.content,
      finishReason: chat?.choices?.[0]?.finish_reason,
      usage: response?.usage,
      error: errMsg,
      startedAt,
      latencyMs,
    })
    const bucket = (env as any).ARTICLES_BUCKET as R2Bucket | undefined
    if (trace.traceId && bucket) {
      const idx = trace.callIndex ?? 0
      const key = `llm-calls/${trace.traceId}/${phase}-${String(idx).padStart(3, '0')}.json`
      const responseContent =
        response && response.capability === 'chat'
          ? (response as ChatResponse).choices?.[0]?.message?.content
          : undefined

      const record = {
        trace_id: trace.traceId,
        phase,
        call_index: idx,
        timestamp: new Date().toISOString(),
        request: {
          provider: request.provider,
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          // 解码参数必须记：不记的话落盘日志里「没下发」和「下发了但模型没认」长得一模一样。
          // 2026-09-08 就因为 response_format 不在这份记录里，差点把「生效」误判成「没透传」。
          response_format: (request as any).response_format,
          frequency_penalty: (request as any).frequency_penalty,
          presence_penalty: (request as any).presence_penalty,
          seed: (request as any).seed,
        },
        response: response
          ? {
              content: responseContent,
              // finish_reason 必须记：截断（length）产出的是残缺 JSON，下游报「响应无 X 字段」，
              // 读起来像模型不配合、实际是预算不够。不记这一格，这两种成因在落盘里分不开。
              finish_reason:
                response.capability === 'chat'
                  ? (response as ChatResponse).choices?.[0]?.finish_reason
                  : undefined,
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
        console.warn(`[LLMCallLogger] R2 put failed key=${key}:`, err)
      }
    }
  }
}
