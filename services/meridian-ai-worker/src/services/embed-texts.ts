import { llmCallKey } from '@meridian/contracts'
import type { EmbedTexts } from '../types/one-call-check'
import { recordLLMCall } from './observe'
import { runWithResend } from './workers-ai'
import { Logger } from '../utils/logger'

const logger = new Logger({ component: 'embed-texts' })

/** 一次调用核查「按意思搜」用的向量模型（ADR 0012）：原型读数就是用它测的；管线的 e5-small 在 ml-service，ai-worker 调不到 */
const EMBED_MODEL = '@cf/baai/bge-m3'
/** 调用日志与观测里的 phase 名。不进 LLMCallPhase：它不是 chat 调用，没有 PHASE_DEFAULTS 那套参数 */
const EMBED_PHASE = 'brief_block_v6_embed'
/** 每批条数与每条文本的截断长度：原型（2026-10-06）的取值 */
const BATCH_SIZE = 50
const MAX_CHARS = 1500

/**
 * 一批文本的向量：按 50 条一批调 binding，交回的向量长度归一、顺序同输入。
 * 会过去的故障照付费模型的规矩等待重发（runWithResend），用尽后抛错——调用方据此不按意思搜。
 * 整个调用记一条观测 / 一条 `llm-calls/` 记录（只记条数与用量，不存文本和向量：文本就是簇里的句子，向量一簇几 MB）。
 *
 * 这是 chat() 之外唯一直接调 binding 的地方（eslint 只豁免这个文件）：向量调用没有 messages / 正文，套不进 loggedChat。
 */
export const embedTexts: EmbedTexts = async (ai, env, trace, texts) => {
  if (texts.length === 0) return []
  const startedAt = Date.now()
  const batches = Math.ceil(texts.length / BATCH_SIZE)
  // binding 报了用量就逐批累加（neurons 报不报随模型，没报就没有这一格）
  const usage: Record<string, number> = {}
  let vectors: number[][] | null = null
  let errMsg: string | undefined
  try {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, MAX_CHARS))
      const body: any = await runWithResend(
        // 模型名是运行时字符串，Ai.run 的签名要具体字面量的 keyof，与 chat() 同一处转型
        () => ai.run(EMBED_MODEL as keyof AiModels, { text: batch } as any),
        { request_id: trace.traceId || 'unknown', model: EMBED_MODEL }
      )
      if (!Array.isArray(body?.data) || body.data.length !== batch.length) {
        throw new Error(`${EMBED_MODEL} 回的向量条数不对：要 ${batch.length} 条，回 ${Array.isArray(body?.data) ? body.data.length : '非数组'}`)
      }
      for (const [k, v] of Object.entries(body.usage ?? {})) if (typeof v === 'number') usage[k] = (usage[k] ?? 0) + v
      out.push(...(body.data as number[][]))
    }
    vectors = out.map(v => {
      const norm = Math.hypot(...v)
      return norm > 0 ? v.map(x => x / norm) : v
    })
    return vectors
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    const latencyMs = Date.now() - startedAt
    const reported = Object.keys(usage).length > 0 ? usage : undefined
    await recordLLMCall({
      phase: EMBED_PHASE,
      provider: 'workers-ai',
      model: EMBED_MODEL,
      params: { texts: texts.length, batches },
      messages: undefined,
      usage: reported,
      error: errMsg,
      startedAt,
      latencyMs,
    })
    const bucket = env.ARTICLES_BUCKET
    if (trace.traceId && bucket) {
      const idx = trace.callIndex ?? 0
      const key = llmCallKey(trace.traceId, EMBED_PHASE, idx)
      const record = {
        trace_id: trace.traceId,
        phase: EMBED_PHASE,
        call_index: idx,
        timestamp: new Date().toISOString(),
        request: { provider: 'workers-ai', model: EMBED_MODEL, texts: texts.length, batches },
        response: vectors ? { vectors: vectors.length, dimensions: vectors[0]?.length ?? 0, usage: reported } : null,
        error: errMsg,
        latency_ms: latencyMs,
      }
      // 必须 await、错误吞掉不影响主流程：理由同 llm-call-logger.ts
      try {
        await bucket.put(key, JSON.stringify(record, null, 2))
      } catch (err) {
        logger.warn(`[EmbedTexts] R2 put failed key=${key}:`, undefined, err)
      }
    }
  }
}
