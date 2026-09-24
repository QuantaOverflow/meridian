import { 
  AIRequest, 
  AIResponse, 
  CloudflareEnv, 
  BaseProvider,
  AICapability,
  ChatRequest
} from '../types'
import { WorkersAIProvider } from './providers/workers-ai'
import { isThinkingDisabled } from '../config/thinking'
import { Logger } from './logger'

/**
 * env.AI（Workers AI binding）的最小结构。CloudflareEnv 的索引签名限定为 string，
 * 无法在其上声明对象属性，故单独定义、在取用处断言。
 */
interface WorkersAIBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: { gateway?: { id: string; skipCache?: boolean; cacheTtl?: number } }
  ): Promise<any>
}

// 需要显式关闭思维链的模型名单已移到 config/thinking.ts——capabilities/chat.ts 的
// reasoning 兜底判定要用同一份名单，留在这里会漂移。

export class AIGatewayService {
  private providers: Map<string, BaseProvider>
  private logger: Logger

  constructor(private env: CloudflareEnv) {
    this.logger = new Logger(env)
    this.providers = new Map<string, BaseProvider>()
    
    // workers-ai 只走 env.AI binding（预认证，无需 API token）
    const workersAIBinding = (env as unknown as { AI?: { run?: unknown } }).AI
    if (typeof workersAIBinding?.run === 'function') {
      this.providers.set('workers-ai', new WorkersAIProvider())
    }
  }

  /**
   * 唯一通道：workers-ai 经 env.AI binding。binding 的凭证由 Worker 部署关系授予，不依赖 API token。
   * 不经 AI Gateway（2026-09-24 删掉了最后一个走 Gateway 的 provider DashScope；
   * 以后要接非 CF 厂商，CF AI Gateway 本身支持直接接入）。
   */
  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now()
    
    // Get available providers for this capability
    const availableProviders = this.getAvailableProvidersForCapability(request.capability)
    
    if (availableProviders.length === 0) {
      throw new Error(`No available providers support capability: ${request.capability}`)
    }

    // Validate specified provider if provided
    if (request.provider && !availableProviders.includes(request.provider)) {
      throw new Error(`Provider ${request.provider} is not available or does not support capability: ${request.capability}`)
    }

    const requestedProvider = request.provider || availableProviders[0]
    try {
      const mappedResponse = await this.executeWorkersAIViaBinding(request)
      mappedResponse.processingTime = Date.now() - startTime
      return mappedResponse
    } catch (error) {
      this.logger.logProviderError(
        request.metadata?.requestId || 'unknown',
        requestedProvider,
        error as Error,
        { capability: request.capability, model: request.model }
      )
      throw new Error(`Workers AI binding failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private getAvailableProvidersForCapability(capability: AICapability): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.getSupportedCapabilities().includes(capability))
      .map(([name, _]) => name)
  }

  /**
   * Workers AI 经 env.AI binding 调用。认证来自 binding 本身（无 API token 依赖）。
   * 不经 AI Gateway（不传 gateway 参数，原因见方法内 `const options` 处）。
   */
  private async executeWorkersAIViaBinding(request: AIRequest): Promise<AIResponse> {
    const ai = (this.env as unknown as { AI?: WorkersAIBinding }).AI
    if (!ai || typeof ai.run !== 'function') {
      throw new Error('Workers AI binding (env.AI) 未配置')
    }

    const provider = this.providers.get('workers-ai')
    if (!provider) {
      throw new Error('Provider workers-ai not registered')
    }

    if (request.capability !== 'chat') {
      throw new Error(`Workers AI binding 目前只接 chat capability，收到: ${request.capability}`)
    }

    const modelName = request.model || provider.getDefaultModel(request.capability)
    if (!modelName) {
      throw new Error(`No workers-ai model available for capability: ${request.capability}`)
    }

    const chatRequest = request as ChatRequest
    const inputs: Record<string, unknown> = { messages: chatRequest.messages }
    if (chatRequest.max_tokens != null) inputs.max_tokens = chatRequest.max_tokens
    if (chatRequest.temperature != null) inputs.temperature = chatRequest.temperature
    // 第二道白名单。Cloudflare 的 glm-4.7-flash 模型页列出支持 frequency_penalty /
    // presence_penalty / seed；不下发时行为与此前逐字相同。
    if (chatRequest.frequency_penalty != null) inputs.frequency_penalty = chatRequest.frequency_penalty
    if (chatRequest.presence_penalty != null) inputs.presence_penalty = chatRequest.presence_penalty
    if (chatRequest.seed != null) inputs.seed = chatRequest.seed
    // 结构化输出。Workers AI 的 JSON mode 收 `response_format`（OpenAI 兼容）。
    // 逐模型的支持情况官方文档没给列表，**不支持的模型是静默忽略还是报错未知**——
    // 所以调用方必须自己核验产出是否真被约束住了，不能因为返回 200 就当它生效
    // （这正是 frequency_penalty 那次的教训：不在白名单里传了照样 200）。
    if (chatRequest.response_format != null) inputs.response_format = chatRequest.response_format

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
    if (isThinkingDisabled(modelName)) {
      inputs.chat_template_kwargs = { enable_thinking: false }
    }

    // 不传 gateway 参数。当前形态经生产日志验证可靠：2026-08-11 真实文章流量
    // "尝试分析 (4/4)" 37 次 → "成功完成分析" 37 次（100%）。
    //
    // ⚠️ 关于 gateway 参数：曾观测到"带 gateway.id 则 240s 无响应"，但该结论建立在
    // **从本机 curl 生产端点**这一种测量上，而那条回程本身不可靠——同一时段本机 curl
    // 屡屡超时的请求，服务端日志显示 worker 早已正常完成。故"带 gateway 会挂起"未经
    // 服务端证据确认，不可当作事实。若要恢复 gateway 观测（日志/缓存/成本统计），
    // 加回参数后**必须用 worker 日志（而非客户端响应）判定成败**。
    const options = undefined

    this.logger.log('debug', 'Workers AI via binding', {
      model: modelName,
      viaGateway: false, // 见上：binding + authenticated gateway 会静默挂起
      thinkingDisabled: inputs.chat_template_kwargs != null, // 生产判定 thinking 是否真关掉的凭据
      requestId: request.metadata?.requestId,
    })

    const body = await ai.run(modelName, inputs, options)
    return provider.mapResponse(body, { ...request, model: modelName })
  }

  async chat(request: Omit<ChatRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'chat' })
  }
}
