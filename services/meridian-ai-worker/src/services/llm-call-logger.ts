import type { AIGatewayService } from './ai-gateway'
import type { ChatRequest, AIResponse, ChatResponse, CloudflareEnv } from '../types'

/**
 * LLM 调用阶段，用于 R2 key 分类
 */
export type LLMCallPhase =
  | 'article_analysis'
  | 'story_validation'
  | 'intelligence_analysis'
  // 观测性：环1 的 RARR 接地校验-改正原先复用 'intelligence_analysis' 且沿用同一个 callIndex
  // （= story 序号）→ **同一个 R2 key**，校验响应把情报分析的原始响应整份覆盖掉。
  // 2026-08-15 run 实证：15 份 llm-calls 记录里 14 份是校验响应，唯一保住分析原文的
  // 反而是分析失败、没走到校验的那条——留档只剩"没出事"的那段，排查时最需要的正好没有。
  | 'intel_grounding_verify'
  | 'brief_generation'
  | 'tldr_generation'
  // 读者端的散文摘要，与 tldr_generation 用途不同（那个是给次日模型读的机器格式）
  | 'tldr_prose_generation'
  // 观测性：运行时忠实度门也走 loggedChat，单独 phase 便于和 brief 生成区分。
  | 'faithfulness_check'
  | 'faithfulness_revise'
  // 去重层：确认两条 story 是不是同一个发生 + 给合并后的故事起标题。单独 phase 的理由与
  // intel_grounding_verify 相同——和 story_validation 共用会让两者的 R2 观测记录互相覆盖。
  | 'story_merge'
  | 'other'

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
        },
        response: response
          ? {
              content: responseContent,
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
