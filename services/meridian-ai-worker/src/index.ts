import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { BriefGenerationService } from './services/brief-generation'
import { BriefBlockV6Service } from './services/brief-block-v6'
import { callLLM } from './services/call-llm'
import { getClusterJudgePrompt, JUDGE_DATA_BLOCK_MARK, EVENT_SPECIFIC_LEAK, type JudgeArticle } from './prompts/cluster-judge'
import { RANK_TOP_N, type RankCandidate } from './prompts/story-rank'
import { rankStories } from './services/story-rank'
import { loggedChat, readTraceContext } from './services/llm-call-logger'
import { observeMiddleware } from './services/observe'
import { getArticleAnalysisPrompt, articleAnalysisSchema } from './prompts/articleAnalysis'
import { getBriefTitlePrompt } from './prompts/briefGeneration'
import { CloudflareEnv, ChatResponse } from './types'
import { APIResponse } from './types/api'
import { createRequestMetadata, parseJSONFromResponse } from './utils/common'

type HonoEnv = {
  Bindings: CloudflareEnv & {
    AI: Ai
  }
}

const app = new Hono<HonoEnv>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Trace-ID', 'x-trace-id', 'x-observe'],
}))

// 跨服务追踪：把上游传过来的 x-trace-id 在请求入口打一行结构化日志，便于 wrangler tail 关联
app.use('*', async (c, next) => {
  const traceId = c.req.header('x-trace-id') || c.req.header('X-Trace-ID')
  if (traceId) {
    console.log(`[trace] svc=meridian-ai-worker trace_id=${traceId} path=${c.req.path} method=${c.req.method}`)
  }
  await next()
})

// 观测上下文：请求内经 loggedChat 的 LLM 调用自动挂到本请求的 span 下（services/observe.ts）
app.use('*', observeMiddleware)

// ============================================================================
// Health Check
// ============================================================================

app.get('/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'meridian-ai-worker'
  })
})

// ============================================================================
// Article Analysis
// ============================================================================

app.post('/meridian/article/analyze', async (c) => {
  const aiGateway = new AIGatewayService(c.env)
  const requestMetadata = createRequestMetadata(c)
  
  try {
    const { title, content } = await c.req.json()
    
    if (!title || !content) {
      return c.json({ success: false, error: '缺少必需字段：title 和 content' }, 400)
    }

    // 输入长度验证 - 利用llama-3.3-70b的24000上下文窗口
    const maxContentLength = 20000 // 约20000字符，充分利用24000 token上下文
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + '...[内容已截断]'
      : content

    console.log(`[Article Analysis] 原始内容长度: ${content.length}, 处理后长度: ${truncatedContent.length}`)

    const analysisPrompt = getArticleAnalysisPrompt(title, truncatedContent)

    // 分级重试策略。
    //
    // 2026-08-17：删掉原先前三档 DashScope（qwen-plus / qwen-turbo ×2）。它们自 2026-07-29 起
    // 每次都返回 401 invalid_api_key，实际干活的一直是末档 qwen3——生产日志实证 6 小时内
    // 「尝试分析 (1/4)」41 次 = 「(4/4)」41 次，100% 走到第 4 档。删除是行为等价的。
    //
    // 删它不只是省 3 次白打的调用，是**批量进稿的硬阻塞**：backend 侧 analyze 步是
    // timeout 1 分钟 + retries 3。涓流量（实测 5-14 篇/小时）下 3 次失败调用还挤得进 60 秒，
    // 但 2026-08-17 新增两个源、首轮一次进 42 篇时，并发把延迟放大到超时 —— ai-worker 侧
    // 日志明明「成功完成分析」，backend 侧 42/43 篇却记 AI_ANALYSIS_FAILED（同小时前 10 小时
    // 失败数均为 0）。少 3 次往返直接把这个放大器拆掉。
    //
    // ⚠️ 保留两档而非退化成单档：2026-07-29 的教训是同源多档对 provider 级故障零防护。
    // 但目前只有 Workers AI 一家凭证可用（DashScope key 已死），所以这两档只提供
    // **模型级**兜底，不提供 provider 级兜底 —— 真要后者得再配一家可用 provider 的 key。
    // 第二档选 glm-4.7-flash：简报五 phase 已在生产验证，且 131k 上下文比 qwen3 的 32k
    // 更能吃长文（本函数上游把正文截到 20000 字符）。
    const analysisStrategies = [
      { provider: 'workers-ai', model: '@cf/qwen/qwen3-30b-a3b-fp8', temperature: 0.1, maxTokens: 4000 },
      { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 4000 }
    ]

    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= analysisStrategies.length; attempt++) {
      const strategy = analysisStrategies[attempt - 1]
      
      console.log(`[Article Analysis] 尝试分析 (${attempt}/${analysisStrategies.length}): ${title.substring(0, 50)}...`)
      console.log(`[Article Analysis] 使用模型: ${strategy.model} (提供商: ${strategy.provider}), 温度: ${strategy.temperature}`)
      
      try {
        const aiResult = await loggedChat(aiGateway, c.env, readTraceContext(c.req.raw), 'article_analysis', {
          messages: [
            { role: 'user', content: analysisPrompt }
          ],
          provider: strategy.provider,
          model: strategy.model,
          temperature: strategy.temperature,
          max_tokens: strategy.maxTokens, // 每档自带（原特判写死的 llama-3.3-70b 分支已无对应策略档）
          metadata: requestMetadata
        })

        if (aiResult.capability !== 'chat') {
          throw new Error('Unexpected response type from chat service')
        }

        const aiResponse = (aiResult as ChatResponse).choices?.[0]?.message?.content
        if (!aiResponse) {
          throw new Error('AI 服务返回空响应')
        }

        console.log(`[Article Analysis] AI 响应长度: ${aiResponse.length}`)
        console.log(`[Article Analysis] 响应开头: ${aiResponse.substring(0, 100)}`)

        // 解析AI响应为JSON
        const analysisResult = parseJSONFromResponse(aiResponse)
        
        if (!analysisResult || typeof analysisResult !== 'object') {
          console.log(`[Article Analysis] 第 ${attempt} 次尝试失败: JSON 解析失败或返回非对象`)
          console.log(`[Article Analysis] JSON 解析错误 - AI 响应格式可能不正确`)
          lastError = new Error('JSON 解析失败或返回非对象')
          continue
        }

        console.log(`[Article Analysis] 第 ${attempt} 次尝试成功解析 JSON`)
        console.log(`[Article Analysis] 成功完成分析: ${JSON.stringify(analysisResult).substring(0, 200)}...`)

        // 字段契约校验：此前只校验"能否解析成 object"，{} 或缺字段照样当 success 返回
        // （articleAnalysisSchema 定义了却从未用于校验端点输出）。用 safeParse 让契约违背可见。
        // 仍放行不阻断：下游 processArticles 对缺字段有 `?? default` 兜底，且生产实测此类全默认输出
        // 0 发作；硬拒有过严风险（如 language.length(2) 误伤 "eng"）。留痕不改行为，与其它功能层修法一致。
        const contractCheck = articleAnalysisSchema.safeParse(analysisResult)
        if (!contractCheck.success) {
          console.warn(`[Article Analysis] 输出未通过 articleAnalysisSchema 字段契约（仍放行，下游有兜底）: ` +
            contractCheck.error.issues.map(i => `${i.path.join('.') || '(root)'}=${i.code}`).join(', '))
        }

        return c.json({
          success: true,
          data: analysisResult,
          metadata: {
            provider: strategy.provider,
            model: strategy.model,
            attempts: attempt,
            lastError: null
          }
        })

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[Article Analysis] 第 ${attempt} 次尝试失败: ${errorMessage}`)
        
        // 检查是否是配额或限制相关错误
        if (errorMessage.includes('quota') || errorMessage.includes('rate limit') || 
            errorMessage.includes('resource exhausted') || errorMessage.includes('429') ||
            errorMessage.includes('exceeded') || errorMessage.includes('context window')) {
          console.log(`[Article Analysis] API 配额或限制错误`)
          lastError = new Error(`API 配额或限制错误: ${errorMessage}`)
        } else {
          lastError = error instanceof Error ? error : new Error(errorMessage)
        }
      }
    }

    console.log(`[Article Analysis] 所有重试都失败了`)
    console.log(`[Article Analysis] 最终错误: ${lastError?.message}`)
    
    return c.json({
      success: false,
      error: `文章分析失败: ${lastError?.message || '未知错误'}`,
      metadata: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-2-7b-chat-int8',
        attempts: analysisStrategies.length,
        lastError: lastError?.message
      }
    }, 500)

  } catch (error) {
    console.error('[Article Analysis] 请求处理失败:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    return c.json({
      success: false,
      error: `文章分析失败: ${errorMessage}`,
      metadata: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-2-7b-chat-int8',
        attempts: 0,
        lastError: errorMessage
      }
    }, 500)
  }
})


/**
 * 簇判定：一个聚类簇 = 简报里的一条。一次调用同时回答「这簇是不是一件事」与「这件事叫什么」。
 *
 * 2026-09-05 起取代 storyline 两段式。前提是聚类换成不降维凝聚后一簇 ≈ 一件事
 * （两窗人读金标实测簇纯度 0.864/0.913）。判据与实测读数见 prompts/cluster-judge.ts。
 *
 * **失败不静默降级**：解析不出 JSON 一律回 500，由上游决定退化路径（整簇保留成一块）。
 * 绝不能把失败伪装成 NO_EVENT——那等于让一次网络抖动毙掉一条真新闻，这个仓库栽过。
 */
app.post('/meridian/cluster/judge', async (c) => {
  try {
    const body = await c.req.json()
    const articles = body?.articles as JudgeArticle[] | undefined
    if (!Array.isArray(articles) || articles.length < 2) {
      return c.json<APIResponse<null>>({ success: false, error: 'articles must be an array of >= 2 items' }, 400)
    }
    if (articles.some(a => typeof a?.id !== 'number' || typeof a?.title !== 'string' || a.title.trim().length === 0)) {
      return c.json<APIResponse<null>>({ success: false, error: 'every article needs a numeric id and a non-empty title' }, 400)
    }

    const prompt = getClusterJudgePrompt(articles)
    // 泛化断言：指令段不得含具体事件的专有词。写死案例既不泛化，又会让离线评估虚高。
    const instructions = prompt.slice(0, prompt.indexOf(JUDGE_DATA_BLOCK_MARK))
    const leak = instructions.match(EVENT_SPECIFIC_LEAK)
    if (leak) {
      return c.json<APIResponse<null>>({
        success: false,
        error: `cluster judge prompt leaked an event-specific term: "${leak[0]}"`,
      }, 500)
    }

    const aiGateway = new AIGatewayService(c.env)
    const res = await callLLM(aiGateway, c.env, readTraceContext(c.req.raw), 'cluster_judge',
      [{ role: 'user', content: prompt }])
    const content = ('choices' in res ? res.choices?.[0]?.message?.content : '') || ''
    const parsed = parseJSONFromResponse(content) as
      { verdict?: string; title?: string; event?: string; reason?: string } | null

    const verdict = String(parsed?.verdict ?? '').toUpperCase()
    if (verdict !== 'EVENT' && verdict !== 'NO_EVENT' && verdict !== 'UNSURE') {
      // 解析失败/字段缺失 → 让上游看见失败，而不是拿一个"安全默认值"顶上
      return c.json<APIResponse<null>>({
        success: false,
        error: 'cluster judge returned no usable verdict',
        metadata: { raw: content.slice(0, 400) },
      }, 500)
    }

    return c.json<APIResponse<{ verdict: string; title: string; event: string; reason: string }>>({
      success: true,
      data: {
        verdict,
        title: String(parsed?.title ?? '').trim(),
        event: String(parsed?.event ?? '').trim(),
        reason: String(parsed?.reason ?? '').trim(),
      },
    })
  } catch (error: any) {
    console.error('Cluster judge error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: 'Failed to judge cluster',
      metadata: { details: error.message },
    }, 500)
  }
})

/**
 * 故事重要性排序：一次请求内跑三轮洗牌 + Borda 聚合，返回前 12。
 * 判据与三形态对照写在 prompts/story-rank.ts，聚合与失败策略写在 services/story-rank.ts。
 */
app.post('/meridian/stories/rank', async (c) => {
  try {
    const body = await c.req.json()
    const candidates = body?.candidates as RankCandidate[] | undefined
    if (!Array.isArray(candidates) || candidates.length < RANK_TOP_N) {
      return c.json<APIResponse<null>>(
        { success: false, error: `candidates must be an array of >= ${RANK_TOP_N} items` },
        400
      )
    }
    // articles 是必填而不是可选：离线读数都是带它测出来的，缺了排序会变形
    // （见 prompts/story-rank.ts 的 RankCandidate.articles）。宁可 400 也不静默用默认值。
    if (
      candidates.some(
        x =>
          !Number.isInteger(x?.id) ||
          typeof x?.title !== 'string' ||
          x.title.trim().length === 0 ||
          !Number.isFinite(x?.articles)
      )
    ) {
      return c.json<APIResponse<null>>(
        { success: false, error: 'every candidate needs an integer id, a non-empty title and a numeric articles count' },
        400
      )
    }
    if (new Set(candidates.map(x => x.id)).size !== candidates.length) {
      return c.json<APIResponse<null>>({ success: false, error: 'candidate ids must be unique' }, 400)
    }

    // 这里**故意没有** cluster/judge 那样的运行时泛化断言。同一个目标（判据不许写死具体
    // 案例）换了落点：那道闸放在改 prompt 的环节（离线迭代时从全部候选标题抽专名集合，
    // 指令段命中任何一个即作废，见 prompts/story-rank.ts 顶部）。
    //
    // 不放运行时的理由是实测的：复用 cluster/judge 的正则会被 `casualty` 命中——「伤亡
    // 规模」是本判据第三个维度的定义词，是合法通用词汇。而任何基于通用词的正则都必然误杀
    // （标题里出现 "Judge blocks ..." 就会撞上指令段的 "Judge on a global scale"），
    // 误杀的代价是整期简报排序失败。闸放在人改 prompt 的那一步，收益同样、风险没有。
    const aiGateway = new AIGatewayService(c.env)
    const trace = readTraceContext(c.req.raw)
    let callIndex = 0
    const result = await rankStories(
      candidates,
      async (prompt: string) => {
        const res = await callLLM(aiGateway, c.env, trace, 'story_rank', [{ role: 'user', content: prompt }], {
          callIndex: callIndex++,
        })
        return ('choices' in res ? res.choices?.[0]?.message?.content : '') || ''
      },
      (text: string) => parseJSONFromResponse(text)
    )

    // 三轮全败才算整步失败。**不回退成机械序**：那会让「排序没生效」与
    // 「排序生效了但结果一样」无法分辨，调用方必须能看见这次失败。
    if (result.roundsOk === 0) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'story rank produced no usable round',
        metadata: { rounds: result.rounds },
      }, 500)
    }

    return c.json<APIResponse<typeof result>>({
      success: true,
      data: result,
      metadata: {
        candidates: candidates.length,
        rounds_ok: result.roundsOk,
        intersection_size: result.intersectionSize,
      },
    })
  } catch (error: any) {
    console.error('Story rank error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: 'Failed to rank stories',
      metadata: { details: error.message },
    }, 500)
  }
})

// 简报块 v6：一个簇的原文 → 一块高管简报（services/brief-block-v6.ts）。
// 请求体与 /meridian/report-v3 逐字同构（多一个可选的 tier），backend 可复用同一份文章材料。
// tier 决定篇幅：'lead' = 5–7 句，'more' / 不传 = 原 exec 档（3–5 句），'brief' = 1 句。
// 非法值按不传处理，不报 400——篇幅是写作风格，不是正确性约束。旧端点一个不动。
app.post('/meridian/brief-block-v6', async (c) => {
  try {
    const body = await c.req.json()
    const articles = Array.isArray(body?.articles) ? body.articles : null
    if (!articles || !articles.length) {
      return c.json<APIResponse<null>>({ success: false, error: 'articles must be a non-empty array' }, 400)
    }
    const bad = articles.findIndex(
      (a: any) => !Number.isInteger(a?.id) || typeof a?.title !== 'string' || typeof a?.content !== 'string' || !a.content.trim()
    )
    if (bad >= 0) {
      return c.json<APIResponse<null>>({ success: false, error: `articles[${bad}] needs {id:int, title:string, content:non-empty string}` }, 400)
    }
    const service = new BriefBlockV6Service(c.env, readTraceContext(c.req.raw))
    const data = await service.generate(
      { title: typeof body?.title === 'string' ? body.title : '', articles, tier: body?.tier },
      body?.skipCache === true
    )
    return c.json<APIResponse<typeof data>>({ success: true, data })
  } catch (error: any) {
    console.error('Brief block v6 error:', error)
    return c.json<APIResponse<null>>({ success: false, error: `Failed to build brief block v6: ${error?.message ?? String(error)}` }, 500)
  }
})

// 简报整篇标题。v3 链路的拼装在 backend 用代码做（三节、<u> 条目全是确定性的），
// 只剩「给整篇起个名」这一次调用，沿用旧链路同一个 prompt，标题风格不变。
app.post('/meridian/brief-title', async (c) => {
  try {
    const body = await c.req.json()
    const content = typeof body?.content === 'string' ? body.content : ''
    if (!content.trim()) {
      return c.json<APIResponse<null>>({ success: false, error: 'content is required' }, 400)
    }
    const res = await callLLM(new AIGatewayService(c.env), c.env, readTraceContext(c.req.raw), 'brief_generation',
      [{ role: 'user', content: getBriefTitlePrompt(content) }],
      { temperature: 0.3, maxTokens: 300, skipCache: true, callIndex: 690 })
    const raw = res.capability === 'chat' ? String((res as ChatResponse).choices?.[0]?.message?.content ?? '') : ''
    const parsed = parseJSONFromResponse(raw)
    // 解析失败不静默套通用名：留痕，让「模型没给标题」与「本来就叫这个」分得开
    if (!parsed?.title) console.warn(`[BriefTitle] 标题解析失败或缺 title 字段 → 用通用标题。原始输出: ${raw.slice(0, 200)}`)
    const usage = (res.usage as { neurons?: number } | undefined)?.neurons ?? 0
    return c.json<APIResponse<{ title: string; neurons: number }>>({
      success: true,
      data: { title: String(parsed?.title || 'Daily Intelligence Brief'), neurons: Number(usage) },
    })
  } catch (error: any) {
    console.error('Brief title error:', error)
    return c.json<APIResponse<null>>({ success: false, error: `Failed to generate brief title: ${error?.message ?? String(error)}` }, 500)
  }
})

// ============================================================================
// TLDR Generation - 基于数据契约的完整实现
// ============================================================================

app.post('/meridian/generate-brief-tldr', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.briefTitle || !body.briefContent) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'briefTitle and briefContent are required'
      }, 400)
    }

    console.log(`[TLDR Generation] 为简报生成TLDR`)

    const briefService = new BriefGenerationService(c.env, readTraceContext(c.req.raw))
    
    const result = await briefService.generateTLDR(body.briefTitle, body.briefContent)
    
    if (!result.success) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'Failed to generate TLDR',
        metadata: { details: result.error }
      }, 500)
    }

    console.log(`[TLDR Generation] TLDR生成完成`)

    return c.json<APIResponse<{ tldr: string }>>({
      success: true,
      data: result.data!,
      metadata: {
        brief_title: body.briefTitle,
        brief_length: body.briefContent.length,
        story_count: result.data!.tldr.split('\n').filter(line => line.trim()).length
      }
    })

  } catch (error: any) {
    console.error('TLDR generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate TLDR',
      metadata: { details: error.message }
    }, 500)
  }
})

app.post('/meridian/generate-brief-summary', async (c) => {
  try {
    const body = await c.req.json()

    if (!body.briefTitle || !body.briefContent) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'briefTitle and briefContent are required'
      }, 400)
    }

    console.log(`[TLDR Prose] 为简报生成散文摘要`)

    const briefService = new BriefGenerationService(c.env, readTraceContext(c.req.raw))

    const result = await briefService.generateProseTldr(body.briefTitle, body.briefContent)

    if (!result.success) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'Failed to generate brief summary',
        metadata: { details: result.error }
      }, 500)
    }

    return c.json<APIResponse<{ tldrProse: string }>>({
      success: true,
      data: result.data!,
      metadata: {
        brief_title: body.briefTitle,
        summary_length: result.data!.tldrProse.length
      }
    })

  } catch (error: any) {
    console.error('Brief summary generation error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: 'Failed to generate brief summary',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Chat API - 简化版
// ============================================================================

app.post('/meridian/chat', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'messages array is required'
      }, 400)
    }

    const aiGatewayService = new AIGatewayService(c.env)
    
    const chatRequest = {
      capability: 'chat' as const,
      messages: body.messages,
      provider: body.options?.provider || 'dashscope',
      model: body.options?.model || 'qwen-plus',
      // ?? 而非 ||：调用方显式传 temperature: 0（judge 场景）时必须生效，|| 会吞成 0.7
      temperature: body.options?.temperature ?? 0.7,
      max_tokens: body.options?.max_tokens || 1000,
      stream: body.options?.stream || false,
      // 离线 eval 的 A/B 需要独立采样：默认 false（生产照常走缓存），显式传 true 才跳过
      skipCache: body.options?.skipCache === true,
      // 解码参数透传。不传就是原行为（provider 侧不下发），向后兼容。
      // 这里是显式白名单：不在名单上的 options 会被静默丢弃且照样 200，加参数必须同时改这里
      // 和 ai-gateway.ts 的 executeWorkersAIViaBinding。
      frequency_penalty: body.options?.frequency_penalty,
      presence_penalty: body.options?.presence_penalty,
      seed: body.options?.seed,
      response_format: body.options?.response_format,
      metadata: createRequestMetadata(c)
    }

    const result = await aiGatewayService.chat(chatRequest)
    
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }
    
    const chatResult = result as ChatResponse
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        id: chatResult.id,
        choices: chatResult.choices,
        usage: chatResult.usage,
        model: chatResult.model
      },
      metadata: {
        provider: chatResult.provider,
        processingTime: chatResult.processingTime,
        cached: chatResult.cached
      }
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to process chat request',
      metadata: { details: error.message }
    }, 500)
  }
})

export default app
