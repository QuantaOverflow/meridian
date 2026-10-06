import type { ChatRequest, ChatResponse } from '../types'
import { readsReasoningAsContent, thinkingOffKwargs } from '../config/thinking'
import { Logger } from '../utils/logger'

const logger = new Logger({ component: 'workers-ai' })

/**
 * Workers AI 支持的模型表。mapResponse 按 model 名查表（不在表里的 model 会被拒）。
 * 价格、上下文长度等以 Cloudflare 模型页为准。
 * @internal 导出只为测试断言模型表
 */
export const WORKERS_AI_MODELS: readonly string[] = [
  // 文章分析第一档（index.ts 的 analysisStrategies）
  '@cf/qwen/qwen3-30b-a3b-fp8',
  // 简报链路全部 phase 与文章分析第二档（见 services/call-llm.ts）
  '@cf/zai-org/glm-4.7-flash',
  // 写作–核查循环（ADR 0010）：简报块的写作与改写
  '@cf/deepseek-ai/deepseek-v4-pro-0813',
  // 写作–核查循环：逐句核查 agent
  '@cf/qwen/qwen3.8-27b',
]

/**
 * 等一会儿、原样重发同一个请求（写作–核查循环，ADR 0010）：只对这两个模型，glm 等其他模型不变。
 * 重发不算调用方的一次尝试，也不算核查 agent 的一步。两类错误各自计数：
 *
 * - 限流：报错里带 3021 或 "rate limit"（不分大小写）。v4-pro 每账号每模型 20 次/分钟、qwen3.8 300 次/分钟，
 *   一期 6 块在飞时撞得到。等 15s，之后每次多 10s，最多等 8 次（原型 lib.mts 的取值）。
 * - 服务端会自愈的故障：容量不足（3040）、超时（3046）、内部错误（8005）、连接中断。指数退避：等 2s、4s、8s，
 *   各加 0–1s 随机抖动，免得同时失败的几十个核查请求一起重发；最多 3 次。原型在 REST 层也重试这类错误
 *   （5xx / 408 / 断连），生产原先只有核查 agent 每步立刻连试 3 次，一阵繁忙就可能把句子记成没核到。
 *   参数错、鉴权错这类重发也没用的错误不在此列，照旧立刻失败。
 *
 * 等满之后照旧抛错。
 */
const RESEND_MODELS: readonly string[] = ['@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/qwen/qwen3.8-27b']
const RATE_LIMIT_MAX_WAITS = 8
const rateLimitWaitMs = (wait: number) => 15_000 + 10_000 * wait
const FAULT_MAX_WAITS = 3
const faultWaitMs = (wait: number) => 2_000 * 2 ** wait + Math.floor(Math.random() * 1_000)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isRateLimited = (error: unknown) => /3021|rate limit/i.test(messageOf(error))
const isTransientFault = (error: unknown) =>
  /\b(3040|3046|8005)\b|capacity temporarily exceeded|request timeout|internal server error|network connection lost/i.test(messageOf(error))

/**
 * 调一次 binding；撞上限流或会自愈的故障就按上面的规矩等待、原样重发，等满后照旧抛错。
 * chat() 只对 RESEND_MODELS 用它；句子向量（services/embed-texts.ts）也用它。
 */
export async function runWithResend<T>(run: () => Promise<T>, logContext: { request_id: string; model: string }): Promise<T> {
  for (let rateWaits = 0, faultWaits = 0; ; ) {
    try {
      return await run()
    } catch (error) {
      const rateLimited = isRateLimited(error)
      if (rateLimited ? rateWaits >= RATE_LIMIT_MAX_WAITS : !isTransientFault(error) || faultWaits >= FAULT_MAX_WAITS) throw error
      const ms = rateLimited ? rateLimitWaitMs(rateWaits++) : faultWaitMs(faultWaits++)
      logger.warn(
        rateLimited
          ? `Workers AI 限流，${ms / 1000}s 后原样重发（第 ${rateWaits}/${RATE_LIMIT_MAX_WAITS} 次等待）`
          : `Workers AI 服务故障，${(ms / 1000).toFixed(1)}s 后原样重发（第 ${faultWaits}/${FAULT_MAX_WAITS} 次等待）`,
        { ...logContext, error_message: messageOf(error) }
      )
      await new Promise(r => setTimeout(r, ms))
    }
  }
}

function logDebug(message: string, metadata: Record<string, unknown>): void {
  logger.debug(message, { request_id: metadata.requestId || 'unknown', metadata })
}

function logProviderError(requestId: string, error: Error, context?: Record<string, unknown>): void {
  logger.error(
    'Provider request failed',
    { request_id: requestId, metadata: { requestId, provider: 'workers-ai', errorMessage: error.message, ...context } },
    error,
  )
}

function mapResponse(body: any, modelName: string): ChatResponse {
  // Workers AI format：新模型（qwen3 / glm 等）返回 OpenAI 兼容格式（choices + usage，
  // 且 response 字段为 null），老模型（llama-2-7b 等）返回 { response: "..." }。
  const cfBody = body
  const cfChoice = cfBody.choices?.[0]
  const cfReasoning: string = cfChoice?.message?.reasoning_content ?? cfChoice?.message?.reasoning ?? ''
  let cfContent: string = cfChoice?.message?.content ?? cfBody.response ?? ''

  // 已显式关闭思维链的模型（见 config/thinking.ts），正文可能落在 reasoning 字段而非 content：
  // qwen3 关掉 thinking 后 content 恒为 null、完整 JSON 全在 reasoning_content 里
  // （2026-08-13 实测 23 篇 ×2 轮，content 非空 0/23 而 reasoning 里 9 字段齐全 23/23）。
  // 各家关掉 thinking 后的字段落位并不统一——GLM 关掉后正文照常进 content，走不到这条兜底。
  // **兜底必须限定在名单内**：思维链吃光 max_tokens 时同样是 content=null + 一堆 reasoning，
  // 无条件兜底会把那类真故障当正常输出放行，正是下面那段"响亮地失败"要防的事。
  if (!cfContent && cfReasoning && readsReasoningAsContent(modelName)) {
    cfContent = cfReasoning
  }

  // 空正文必须响亮地失败，不能 `?? ''` 悄悄放行。reasoning 模型（GLM）在 max_tokens 被
  // 思维链吃光时返回 content=null，而 HTTP 层看起来完全正常（200 + 完整 JSON + usage）——
  // 静默降级成空串后，下游 JSON 解析拿到 null 再兜底成默认值，故障要到简报缺内容才暴露。
  // 抛错让上层既有的重试/兜底机制接管，并把判定所需的证据（reasoning 长度、finish_reason）
  // 一并带出：这正是当初只靠客户端返回码判断时看不见的那部分。
  if (!cfContent) {
    const reasoningLen = cfReasoning.length
    throw new Error(
      `Workers AI 返回空正文 (model=${modelName}, finish_reason=${cfChoice?.finish_reason}, ` +
      `reasoning=${reasoningLen}字符, completion_tokens=${cfBody.usage?.completion_tokens})` +
      (reasoningLen > 0 ? ' —— 思维链占满了 max_tokens，检查该模型是否已关闭 thinking' : '')
    )
  }

  return {
    capability: 'chat',
    id: cfBody.id || `chatcmpl-${Date.now()}`,
    provider: 'workers-ai',
    model: modelName,
    choices: [{
      message: {
        role: 'assistant' as const,
        content: cfContent
      },
      finish_reason: cfChoice?.finish_reason || 'stop'
    }],
    usage: cfBody.usage,
  }
}

/**
 * Workers AI 的通道：经 env.AI binding（另一条是逐句核查一次调用的 DashScope，services/dashscope.ts）。binding 的凭证由 Worker 部署关系授予，不依赖 API token。
 * 不经 AI Gateway（2026-09-24 删掉了最后一个走 Gateway 的 provider DashScope；
 * 以后要接非 CF 厂商，CF AI Gateway 本身支持直接接入）。
 *
 * `ai` 由调用方传入（来自 `c.env.AI`）：本函数不接 env、不做 `as unknown as` 断言。
 */
export async function chat(ai: Ai, request: ChatRequest): Promise<ChatResponse> {
  const startTime = Date.now()
  const modelName = request.model

  // 唯一有意的行为改变（相对旧 provider/capability/gateway 分层实现）：未知模型在调用 ai.run 之前就拒绝——
  // 原先这条检查在 mapResponse 里，跑在 ai.run 之后，等于先为一次注定失败的调用付了钱。
  if (!WORKERS_AI_MODELS.includes(modelName)) {
    throw new Error(`Model not found: ${modelName}`)
  }

  const inputs: Record<string, unknown> = { messages: request.messages }
  if (request.max_tokens != null) inputs.max_tokens = request.max_tokens
  if (request.temperature != null) inputs.temperature = request.temperature
  // 结构化输出。Workers AI 的 JSON mode 收 `response_format`（OpenAI 兼容）。
  // 逐模型的支持情况官方文档没给列表，**不支持的模型是静默忽略还是报错未知**——
  // 所以调用方必须自己核验产出是否真被约束住了，不能因为返回 200 就当它生效
  // （参数不在白名单里时传了照样 200，曾因此误判生效）。
  if (request.response_format != null) inputs.response_format = request.response_format

  // GLM / Qwen3 都是 reasoning 模型，chat template 默认开思维链，且 thinking token **计入 max_tokens
  // 并先于正文生成**——预算被吃光时 message.content 直接是 null。实测（2026-08-12，服务端日志）：
  // max_tokens=800 时 content=null / reasoning_content=3468 字符 / finish_reason=length；
  // 关掉后同一 prompt completion_tokens 950→183、耗时 10.7s→2.7s，正文反而更完整。
  // 我们所有 phase 都只要结构化正文（<final_json> / <final_brief> / ```json），思维链纯属负担。
  // 注：reasoning_effort 参数不被 Workers AI 接受（AiError 8001 Invalid input），只能走这个开关。
  //
  // qwen3 是 2026-08-13 A/B 补进名单的：此前它不在名单里 = 生产一直开着思维链跑文章分析。
  // 23 篇生产文章 ×2 轮实测（thinking ON vs OFF）：JSON 可解析与 9 字段齐全都是 23/23 打平，
  // 但 OFF 臂 completion_tokens 808→389、耗时 9.5s→5.4s，且**自一致性显著更高**
  // （同文重跑两次的 Jaccard：topic_tags 0.458→0.653、thematic_keywords 0.147→0.514）。
  // 即思维链没换来更好的抽取，只换来更抖的输出——而下游聚类正建立在这些字段上。
  // 下发哪组参数逐模型不同（deepseek 的模板读 `thinking`），名单与依据在 config/thinking.ts。
  const kwargs = thinkingOffKwargs(modelName)
  if (kwargs) {
    inputs.chat_template_kwargs = kwargs
  }

  // 不传 gateway 参数。当前形态经生产日志验证可靠：2026-08-11 真实文章流量
  // "尝试分析 (4/4)" 37 次 → "成功完成分析" 37 次（100%）。
  //
  // ⚠️ 关于 gateway 参数：曾观测到"带 gateway.id 则 240s 无响应"，但该结论建立在
  // **从本机 curl 生产端点**这一种测量上，而那条回程本身不可靠——同一时段本机 curl
  // 屡屡超时的请求，服务端日志显示 worker 早已正常完成。故"带 gateway 会挂起"未经
  // 服务端证据确认，不可当作事实。若要恢复 gateway 观测（日志/缓存/成本统计），
  // 加回参数后**必须用 worker 日志（而非客户端响应）判定成败**。

  logDebug('Workers AI via binding', {
    model: modelName,
    viaGateway: false, // 见上：不传 gateway 参数
    thinkingDisabled: inputs.chat_template_kwargs != null, // 生产判定 thinking 是否真关掉的凭据
    requestId: request.metadata?.requestId,
  })

  try {
    // model 名以运行时字符串驱动（模型表见 WORKERS_AI_MODELS），Ai.run 的类型签名要求
    // 具体字面量的 keyof——用真实 Ai 类型就必须在这一处转型，换不掉。
    const run = () => ai.run(modelName as keyof AiModels, inputs as any)
    const body: unknown = RESEND_MODELS.includes(modelName)
      ? await runWithResend(run, { request_id: request.metadata?.requestId || 'unknown', model: modelName })
      : await run()
    const response = mapResponse(body, modelName)
    response.processingTime = Date.now() - startTime
    return response
  } catch (error) {
    logProviderError(request.metadata?.requestId || 'unknown', error as Error, { model: modelName })
    throw new Error(`Workers AI binding failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
