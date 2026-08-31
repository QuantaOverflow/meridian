import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { AIGatewayService } from './services/ai-gateway'
import { runFaithfulnessCheck } from './services/faithfulness-check'
import { StoryValidationService } from './services/story-validation'
import { IntelligenceService } from './services/intelligence'
import {
  BriefGenerationService,
  normalizeAnalysisToReport,
  type BriefSkeleton,
  type IntelligenceReport
} from './services/brief-generation'
import { loadR2Batched, type MinimalBucket } from './services/brief-skeleton'
import type { BlockSectionContext } from './prompts/briefSkeleton'
import { loggedChat, readTraceContext } from './services/llm-call-logger'
import { getArticleAnalysisPrompt, articleAnalysisSchema } from './prompts/articleAnalysis'
import { CloudflareEnv, ChatResponse } from './types'
import { APIResponse, ArticleItem, BriefContent } from './types/api'
import { ValidatedStories } from './types/story-validation'
import { StorySchema } from './types/intelligence-types'
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
  allowHeaders: ['Content-Type', 'Authorization', 'X-Trace-ID', 'x-trace-id'],
}))

// 跨服务追踪：把上游传过来的 x-trace-id 在请求入口打一行结构化日志，便于 wrangler tail 关联
app.use('*', async (c, next) => {
  const traceId = c.req.header('x-trace-id') || c.req.header('X-Trace-ID')
  if (traceId) {
    console.log(`[trace] svc=meridian-ai-worker trace_id=${traceId} path=${c.req.path} method=${c.req.method}`)
  }
  await next()
})

// ============================================================================
// 通用工具函数
// ============================================================================

async function callAI(
  aiGateway: AIGatewayService, 
  prompt: string, 
  systemPrompt?: string,
  options: { provider?: string; model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const messages = systemPrompt 
    ? [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: prompt }
      ]
    : [{ role: 'user' as const, content: prompt }]

  const chatRequest = {
    capability: 'chat' as const,
    messages,
    provider: options.provider || 'dashscope',
    model: options.model || 'qwen-plus',
    // ?? 而非 ||：调用方显式传 temperature: 0（需确定性的判定场景）时必须生效，|| 会吞成 0.1
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens || 8000,
    metadata: createRequestMetadata({ req: { header: () => 'ai-worker' } })
  }

  const result = await aiGateway.chat(chatRequest)
  if (result.capability !== 'chat') {
    throw new Error('Unexpected response type from chat service')
  }

  return (result as ChatResponse).choices?.[0]?.message?.content || ''
}

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
// Embedding Generation
// ============================================================================

app.post('/meridian/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.text || (typeof body.text !== 'string' && !Array.isArray(body.text))) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'text field is required (string or array)'
      }, 400)
    }

    const aiGatewayService = new AIGatewayService(c.env)
    
    const embeddingRequest = {
      capability: 'embedding' as const,
      provider: body.options?.provider || 'workers-ai',
      model: body.options?.model || '@cf/baai/bge-small-en-v1.5',
      input: body.text,
      metadata: createRequestMetadata(c)
    }

    const result = await aiGatewayService.embed(embeddingRequest)
    
    if (result.capability !== 'embedding') {
      throw new Error('Unexpected response type from embedding service')
    }
    
    const dimensions = result.data?.[0]?.embedding?.length || 0
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        embeddings: result.data,
        dimensions,
        model: result.model
      },
      metadata: {
        provider: result.provider,
        processingTime: result.processingTime,
        cached: result.cached
      }
    })
  } catch (error: any) {
    console.error('Embedding generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate embedding',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Article Analysis
// ============================================================================

app.post('/meridian/article/analyze', async (c) => {
  const aiGateway = new AIGatewayService(c.env)
  const requestMetadata = createRequestMetadata(c)
  
  try {
    const { title, content, url } = await c.req.json()
    
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

// ============================================================================
// Story Validation - 使用重构后的服务
// ============================================================================

app.post('/meridian/story/validate', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证输入数据结构
    if (!body.clusteringResult?.clusters || !Array.isArray(body.clusteringResult.clusters)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'clusteringResult.clusters array is required'
      }, 400)
    }

    // 验证文章数据数组
    if (!body.articlesData || !Array.isArray(body.articlesData)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'articlesData array is required'
      }, 400)
    }

    // 候选组由 backend 在 story-validation 步内算好传入（几何见 lib/core/candidate-grouping.ts）。
    // 2026-08-21 起它是判定单位；缺失即无法工作，显式 400 而不是静默按空处理。
    if (!body.candidateGroups || !Array.isArray(body.candidateGroups)) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'candidateGroups array is required'
      }, 400)
    }

    console.log(`[Story Validation] 验证 ${body.clusteringResult.clusters.length} 个聚类 / ${body.candidateGroups.length} 个候选组，包含 ${body.articlesData.length} 个文章数据`)

    // 验证空聚类情况 - 保持原有的400错误响应
    if (!body.clusteringResult.clusters.length) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'No clusters to validate'
      }, 400)
    }

    // 使用重构后的故事验证服务（注入 trace 上下文以便 LLM I/O 落 R2）
    const storyValidationService = new StoryValidationService(c.env, readTraceContext(c.req.raw))
    const result = await storyValidationService.validateStories({
      clusteringResult: body.clusteringResult,
      candidateGroups: body.candidateGroups,
      articlesData: body.articlesData,
      options: body.options
    })
    
    return c.json<APIResponse<ValidatedStories>>({
      success: true,
      data: result,
      metadata: result.metadata
    })
    
  } catch (error: any) {
    console.error('Story validation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to validate stories',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Intelligence Analysis - 符合 intelligence-pipeline.test.ts 契约
// ============================================================================

app.post('/meridian/intelligence/analyze-stories', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证输入格式：支持新的 ValidatedStories + ArticleDataset 格式
    if (!body.stories || !body.dataset) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'stories (ValidatedStories) and dataset (ArticleDataset) are required'
      }, 400)
    }

    console.log(`[Intelligence] 分析 ${body.stories.stories?.length || 0} 个故事`)

    const intelligenceService = new IntelligenceService(c.env, readTraceContext(c.req.raw))
    const result = await intelligenceService.analyzeStories(body.stories, body.dataset)
    
    if (result.success) {
      return c.json<APIResponse<any>>({
        success: true,
        data: result.data,
        metadata: {
          total_stories: result.data?.processingStatus.totalStories,
          completed_analyses: result.data?.processingStatus.completedAnalyses,
          failed_analyses: result.data?.processingStatus.failedAnalyses,
          analysis_method: 'intelligence_service_v2'
        }
      })
    } else {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: result.error || 'Intelligence analysis failed'
      }, 500)
    }
    
  } catch (error: any) {
    console.error('Intelligence batch analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze stories',
      metadata: { details: error.message }
    }, 500)
  }
})

app.post('/meridian/intelligence/analyze-single-story', async (c) => {
  try {
    const body = await c.req.json()

    // story 形状必须在边界处运行时校验：跨 service 调用走 JSON，TS 类型已被抹掉。
    // 缺字段(曾经的 articleIds 丢失)若不在此拦下，会潜到 service 里变成 undefined.length 的 TypeError。
    const storyParse = StorySchema.safeParse(body?.story)
    if (!storyParse.success) {
      const detail = storyParse.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      return c.json<APIResponse<null>>({
        success: false,
        error: `Invalid story payload: ${detail}`
      }, 400)
    }
    // articleData 保持轻校验(非空数组)：不套严格 ArticleSchema，避免 publishDate/url 格式差异误拒真实数据。
    if (!Array.isArray(body.articleData) || body.articleData.length === 0) {
      return c.json<APIResponse<null>>({
        success: false,
        error: 'articleData (Article[]) is required and must be a non-empty array'
      }, 400)
    }

    console.log(`[Intelligence] 分析单个故事: ${storyParse.data.title}`)

    // selfCorrect = RARR 接地校验-改正（默认开）；eval baseline 臂传 false 关掉做对照。
    // skipCache 默认 false（生产照常走缓存）；eval 重问同一 story 须传 true 保证独立采样。
    const intelligenceService = new IntelligenceService(c.env, readTraceContext(c.req.raw), {
      selfCorrect: body.selfCorrect,
      skipCache: body.skipCache === true,
    })
    const result = await intelligenceService.analyzeSingleStory(storyParse.data, body.articleData)
    
    if (result.success) {
      return c.json<APIResponse<any>>({
        success: true,
        data: result.data,
        metadata: {
          story_title: body.story.title,
          article_count: body.articleData.length,
          analysis_method: 'single_story_analysis_v2'
        }
      })
    } else {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: result.error || 'Single story analysis failed'
      }, 500)
    }
    
  } catch (error: any) {
    console.error('Single story analysis error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to analyze single story',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// Brief Generation - 基于数据契约的完整实现
// ============================================================================

app.post('/meridian/generate-final-brief', async (c) => {
  try {
    const body = await c.req.json()
    
    if (!body.analysisData || !Array.isArray(body.analysisData)) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'analysisData array is required'
      }, 400)
    }

    console.log(`[Brief Generation] 生成简报，输入 ${body.analysisData.length} 个分析`)

    const briefService = new BriefGenerationService(c.env, readTraceContext(c.req.raw))

    // analysisData 实际就是上游 intel 端点产出的 IntelligenceReport（backend 原样卸 R2 再回灌）。
    // 归一逻辑抽在 brief-generation.ts 的 normalizeAnalysisToReport（b′ 的端点直接从 R2
    // 读报告，必须共用同一套，否则两份实现漂了就是"简报里的人名开始张冠李戴"）。
    // 历史 bug：本段曾假设输入是 legacy 形状去拆装，把已经正确的 IntelligenceReport 全搅成占位符 → 空 brief。
    const intelligenceReports = {
      reports: body.analysisData.map((analysis: any) => normalizeAnalysisToReport(analysis)),
      processingStatus: {
        totalStories: body.analysisData.length,
        completedAnalyses: body.analysisData.length,
        failedAnalyses: 0,
      },
    }

    const previousContext = body.previousBrief ? {
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      title: body.previousBrief.title || 'Previous Brief',
      summary: body.previousBrief.tldr || body.previousBrief.summary || '无上下文',
      coveredTopics: [],
    } : undefined

    // 调用新的简报生成服务。selfCorrect = RARR 接地校验-改正（默认开，选项2）；
    // eval baseline 臂传 selfCorrect:false 关掉做对照。
    const result = await briefService.generateBrief(intelligenceReports, previousContext, {
      selfCorrect: body.selfCorrect,
      reconcileCoverage: body.reconcileCoverage,
      // 两遍法覆盖补录（默认开）；eval 对照臂传 false 关掉
      coverageRepair: body.coverageRepair,
    })

    if (!result.success) {
      return c.json<APIResponse<null>>({ 
        success: false,
        error: 'Failed to generate brief',
        metadata: { details: result.error }
      }, 500)
    }

    console.log(`[Brief Generation] 生成完成，标题: "${result.data!.metadata.title}"`)

    // 返回向后兼容的格式
    const briefContent = result.data!.content.sections.map(s => s.content).join('\n\n');
    
    return c.json<APIResponse<BriefContent>>({
      success: true,
      data: {
        title: result.data!.metadata.title,
        content: briefContent,
      },
      metadata: {
        sections_processed: body.analysisData.length,
        content_length: briefContent.length,
        has_previous_context: !!body.previousBrief,
        // 额外的契约数据
        model_used: result.data!.metadata.model,
        total_articles: result.data!.statistics.totalArticlesProcessed,
        sources_used: result.data!.statistics.totalSourcesUsed,
        // 覆盖对账清单（洞3 方案B）：每条候选 story 的去向 headline/noteworthy/dropped。
        // backend 可存入 observability 使合成层漏报可追踪。
        coverage: result.coverage ?? [],
        // 补录前的去向汇总：落盘的 coverage 已被补录推成 dropped=0，合成层的原始漏报率
        // 在持久化数据里本来完全不可见（只剩一行日志）。这是唯一能跨 run 比较生成质量的信号。
        coverage_before_repair: result.coverageBeforeRepair ?? null,
      }
    })

  } catch (error: any) {
    console.error('Brief generation error:', error)
    return c.json<APIResponse<null>>({ 
      success: false,
      error: 'Failed to generate brief',
      metadata: { details: error.message }
    }, 500)
  }
})

// ============================================================================
// b′ 分段写简报：规划 → 逐块写 → 拼装
//
// 三个端点共用同一个输入契约 `reportKeys`：情报报告全文已由 backend 卸在 R2
// （`intel-reports/{workflowId}/{idx}.json`），这里只收 key、自己读回。
// 不内联传报告是因为 RARR 校验必须看全量源（25 份 ≈ 158KB JSON），逐块内联就是
// 每份简报 25 × 158KB 在 service binding 上来回搬；ai-worker 与 backend 本就共用
// 同一个 bucket（llm-calls / sensors 都写在那），读 key 是既有能力。
// ============================================================================

/** 按 R2 key 读回情报报告并归一。任何一个 key 读不到都硬失败——静默少一份报告会让
 *  oracle 悄悄变窄（RARR 把跨报告的正确内容判成无据删掉），而指标上完全看不出来。 */
export async function loadReportsFromR2(env: any, keys: unknown): Promise<{ ok: true; reports: IntelligenceReport[] } | { ok: false; error: string }> {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: 'reportKeys must be a non-empty array' }
  const bucket = env?.ARTICLES_BUCKET as R2Bucket | undefined
  if (!bucket) return { ok: false, error: 'ARTICLES_BUCKET binding 不可用' }
  // 限并发 + 「取对象与读 body 成对完成」的理由见 loadR2Batched 的注释
  // （2026-08-29 b′ 首次真实 cron 因 25 条并发撞 Workers 6 连接上限整期失败）。
  const { values, missing, broken } = await loadR2Batched(
    keys.map((k: unknown) => String(k)),
    bucket as unknown as MinimalBucket,
    (text: string) => normalizeAnalysisToReport(JSON.parse(text))
  )
  if (missing.length) return { ok: false, error: `R2 缺 ${missing.length} 份情报报告: ${missing.slice(0, 5).join(', ')}` }
  if (broken.length) return { ok: false, error: `情报报告读取失败 ${broken.length} 份: ${broken.slice(0, 3).join('; ')}` }
  return { ok: true, reports: values as IntelligenceReport[] }
}

app.post('/meridian/plan-brief-skeleton', async (c) => {
  try {
    const body = await c.req.json()
    const loaded = await loadReportsFromR2(c.env, body?.reportKeys)
    if (!loaded.ok) return c.json<APIResponse<null>>({ success: false, error: loaded.error }, 400)

    const service = new BriefGenerationService(c.env, readTraceContext(c.req.raw))
    const result = await service.planBriefSkeleton(loaded.reports)
    if (!result.success) {
      return c.json<APIResponse<null>>({ success: false, error: 'Failed to plan brief skeleton', metadata: { details: result.error } }, 500)
    }
    return c.json<APIResponse<BriefSkeleton>>({
      success: true,
      data: result.data!,
      metadata: {
        report_count: loaded.reports.length,
        main_sections: result.data!.main.length,
        isolated_count: result.data!.isolated.length,
        repaired: result.data!.repaired,
      },
    })
  } catch (error: any) {
    console.error('Brief skeleton planning error:', error)
    return c.json<APIResponse<null>>({ success: false, error: 'Failed to plan brief skeleton', metadata: { details: error.message } }, 500)
  }
})

app.post('/meridian/write-brief-block', async (c) => {
  try {
    const body = await c.req.json()
    const loaded = await loadReportsFromR2(c.env, body?.reportKeys)
    if (!loaded.ok) return c.json<APIResponse<null>>({ success: false, error: loaded.error }, 400)

    const index = Number(body?.index)
    if (!Number.isInteger(index) || index < 0 || index >= loaded.reports.length) {
      return c.json<APIResponse<null>>({ success: false, error: `index must be an integer in [0, ${loaded.reports.length - 1}]` }, 400)
    }
    const title = String(body?.title ?? '').trim()
    if (!title) return c.json<APIResponse<null>>({ success: false, error: 'title is required（块标题由规划步产出，写作调用不自己写标题）' }, 400)

    // 章节上下文可缺省：缺省即「独立事态」，prompt 会换成 standalone 的措辞。
    // 同节兄弟只传下标不传摘要：报告全文本来就在这边（刚从 R2 读回），让 backend 也去读一遍
    // R2 再把摘要传过来，就等于两边各存一份「摘要长什么样」的知识，迟早漂。
    const raw = body?.section
    const section: BlockSectionContext | undefined = raw && typeof raw.heading === 'string'
      ? {
          heading: String(raw.heading),
          causalLink: String(raw.causalLink ?? ''),
          siblingSummaries: (Array.isArray(raw.siblingIndices) ? raw.siblingIndices : [])
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n >= 0 && n < loaded.reports.length && n !== index)
            .map((n: number) => loaded.reports[n].executiveSummary || ''),
        }
      : undefined

    const service = new BriefGenerationService(c.env, readTraceContext(c.req.raw))
    const result = await service.writeBriefBlock(loaded.reports, index, title, section, { selfCorrect: body?.selfCorrect })
    if (!result.success) {
      return c.json<APIResponse<null>>({ success: false, error: 'Failed to write brief block', metadata: { details: result.error } }, 500)
    }
    return c.json<APIResponse<any>>({
      success: true,
      data: result.data!,
      metadata: {
        index,
        verified: result.data!.verified,
        edits: result.data!.edits,
        applied: result.data!.applied,
        blocked: result.data!.blocked,
      },
    })
  } catch (error: any) {
    console.error('Brief block writing error:', error)
    return c.json<APIResponse<null>>({ success: false, error: 'Failed to write brief block', metadata: { details: error.message } }, 500)
  }
})

app.post('/meridian/assemble-brief', async (c) => {
  try {
    const body = await c.req.json()
    const loaded = await loadReportsFromR2(c.env, body?.reportKeys)
    if (!loaded.ok) return c.json<APIResponse<null>>({ success: false, error: loaded.error }, 400)

    const skeleton = body?.skeleton
    if (!skeleton || !Array.isArray(skeleton.main) || !Array.isArray(skeleton.isolated)) {
      return c.json<APIResponse<null>>({ success: false, error: 'skeleton {main, isolated} is required' }, 400)
    }
    if (!Array.isArray(body?.blocks) || body.blocks.length === 0) {
      return c.json<APIResponse<null>>({ success: false, error: 'blocks must be a non-empty array' }, 400)
    }

    const service = new BriefGenerationService(c.env, readTraceContext(c.req.raw))
    const result = await service.assembleBrief(loaded.reports, skeleton as BriefSkeleton, body.blocks)
    if (!result.success) {
      return c.json<APIResponse<null>>({ success: false, error: 'Failed to assemble brief', metadata: { details: result.error } }, 500)
    }

    return c.json<APIResponse<BriefContent>>({
      success: true,
      data: { title: result.data!.title, content: result.data!.content },
      metadata: {
        content_length: result.data!.content.length,
        block_count: body.blocks.length,
        report_count: loaded.reports.length,
        // 覆盖对账：b′ 下这是**确定已知**的调用结果而非判官推断，dropped 恒等于块 step 失败数
        coverage: result.data!.coverage,
        model_used: result.data!.model,
        // 传感器读数（只报不改），backend 落 observability
        hygiene_findings: result.hygiene ?? [],
        consistency_findings: result.consistency ?? [],
      },
    })
  } catch (error: any) {
    console.error('Brief assembly error:', error)
    return c.json<APIResponse<null>>({ success: false, error: 'Failed to assemble brief', metadata: { details: error.message } }, 500)
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
// Faithfulness Check - 忠实度传感器（mark-only）
// 逐句把 brief 对 source 取证 → 套门 F 判据 → 出 verdict（block 字段实为 would_block，
// 只记录不拦截）。判据标定见 memory: faithfulness-runtime-gate。
// ============================================================================

const FaithfulnessCheckSchema = z.object({
  // sources = 按故事拆分的情报报告数组；brief = 待检的简报正文。
  // per-story 拆分避免合并 source 撞 qwen-max 30720 token context 上限（旧合并 ~141K 字符 → 400）。
  sources: z.array(z.object({ storyId: z.string(), content: z.string().min(1) })).min(1),
  brief: z.string().min(1),
  // mode: code_only(默认)=只跑拆claim+代码比对通道(线上传感器形态,LLM判官旁路);
  //       full=全量LLM判官(离线批跑/预筛用)。方向定案见 memory: intel-grounding-judge-validated。
  options: z.object({ model: z.string().optional(), mode: z.enum(['code_only', 'full']).optional() }).optional(),
})

app.post('/meridian/faithfulness-check', async (c) => {
  try {
    // 跨 service 边界必做运行时校验：c.req.json() 是 any，TS 类型不随 JSON 过网线
    const parsed = FaithfulnessCheckSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      const detail = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      return c.json<APIResponse<null>>({ success: false, error: `Invalid payload: ${detail}` }, 400)
    }
    const { sources, brief, options } = parsed.data
    const totalSourceChars = sources.reduce((s, r) => s + r.content.length, 0)

    console.log(`[Faithfulness] 检查 brief(${brief.length} chars) vs ${sources.length} 个故事源(合计 ${totalSourceChars} chars)`)
    // 观测性：把 workflow trace 传入 in-process faithfulness LLM 调用，避免绕过 loggedChat。
    // 不传 model 时交给 phase 默认（call-llm 单一入口），别在边界处再垫一个硬编码默认
    const verdict = await runFaithfulnessCheck(c.env, sources, brief, options?.model, readTraceContext(c.req.raw), options?.mode)
    console.log(`[Faithfulness] block=${verdict.block} reasons=[${verdict.block_reasons.join(' | ')}] ` +
      `unsupported=${verdict.genuine_unsupported}/${verdict.factual_claims}(${(verdict.unsupported_rate * 100).toFixed(1)}%) ` +
      `contradicted=${verdict.contradicted} ana_contra=${verdict.analytical_contradicting}`)

    return c.json<APIResponse<typeof verdict>>({ success: true, data: verdict })
  } catch (error: any) {
    console.error('Faithfulness check error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: 'Failed to run faithfulness check',
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

// ============================================================================
// Status and Monitoring - 简化版
// ============================================================================

app.get('/meridian/status', (c) => {
  try {
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json<APIResponse<any>>({ 
      success: true,
      data: {
        service: 'meridian-ai-worker',
        version: '2.0.0-simplified',
        status: 'active',
        endpoints: {
          // 核心工作流端点
          article_analysis: '/meridian/article/analyze',
          embedding_generation: '/meridian/embeddings/generate', 
          story_validation: '/meridian/story/validate',
          // 情报分析端点
          intelligence_batch_analysis: '/meridian/intelligence/analyze-stories',
          intelligence_single_analysis: '/meridian/intelligence/analyze-single-story',
          brief_generation: '/meridian/generate-final-brief',
          brief_tldr: '/meridian/generate-brief-tldr',
          brief_summary: '/meridian/generate-brief-summary',
          // 通用端点
          chat: '/meridian/chat',
          health: '/health'
        },
        workflow: {
          description: '聚类分析 → 故事验证 → 情报分析 → 简报生成',
          data_flow: 'ClusteringResult → ValidatedStories → IntelligenceReports → FinalBrief',
          architecture: 'Clean Architecture - 服务职责分离，代码简洁易读',
          input_formats: {
            story_validation: 'ClusteringResult + articlesData (MinimalArticleInfo[]) → ValidatedStories',
            intelligence_batch_analysis: 'ValidatedStories + ArticleDataset → IntelligenceReports',
            intelligence_single_analysis: 'Story + Article[] → IntelligenceReport',
            brief_generation: 'Array of StoryAnalysis objects'
          },
          refactored_services: {
            description: '重构后的服务架构',
            features: [
              'StoryValidationService - 故事验证服务',
              'IntelligenceService - 情报分析服务',
              'BriefGenerationService - 简报生成服务',
              '统一类型管理 - types/ 目录统一管理',
              '通用工具函数 - utils/ 目录分离',
              '简洁端点实现 - 只保留端点定义'
            ]
          }
        },
        providers: aiGatewayService.getAvailableProviders()
      }
    })
  } catch (error) {
    return c.json<APIResponse<null>>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

app.get('/test', async (c) => {
  try {
    const aiGatewayService = new AIGatewayService(c.env)
    
    return c.json<APIResponse<any>>({
      success: true,
      data: {
        service: 'meridian-ai-worker',
        message: 'Service is operational',
        providers: aiGatewayService.getAvailableProviders(),
        capabilities: ['chat', 'embedding', 'intelligence', 'story_validation', 'brief_generation']
      }
    })
  } catch (error) {
    console.error('Service test error:', error)
    return c.json<APIResponse<null>>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default app
