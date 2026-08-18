import { AIGatewayService } from './ai-gateway'
import { TraceContext } from './llm-call-logger'
import { callLLM } from './call-llm'
import { getStoryValidationPrompt } from '../prompts/storyValidation'
import {
  StoryValidationRequest,
  StoryValidationResult,
  Story,
  RejectedCluster,
  ClusterItem,
  MinimalArticleInfo,
  AIValidationResponse
} from '../types/story-validation'
import { CloudflareEnv } from '../types'
import { recordSensor } from './sensor-log'

// 解析失败重采样上限。与情报分析的 INTEL_PARSE_MAX_ATTEMPTS 取同值：同模型同类 JSON 格式滑手，
// 没有理由一边给 4 次机会、一边给 0 次。
const SV_PARSE_MAX_ATTEMPTS = 4

export class StoryValidationService {
  private aiGateway: AIGatewayService
  private env: CloudflareEnv
  private traceContext: TraceContext

  constructor(env: CloudflareEnv, traceContext: TraceContext = {}) {
    this.env = env
    this.aiGateway = new AIGatewayService(env)
    this.traceContext = traceContext
  }

  /**
   * 验证聚类并生成故事
   */
  async validateStories(request: StoryValidationRequest): Promise<StoryValidationResult> {
    const { clusteringResult, articlesData, useAI = true, options } = request
    
    console.log(`[Story Validation] 验证 ${clusteringResult.clusters.length} 个聚类，包含 ${articlesData.length} 个文章数据`)

    // 空聚类情况：返回空结果而不是抛出异常
    if (!clusteringResult.clusters.length) {
      return {
        stories: [],
        rejectedClusters: [],
        metadata: {
          totalClusters: 0,
          totalArticlesProvided: articlesData.length,
          validatedStories: 0,
          rejectedClusters: 0,
          processingStatistics: clusteringResult.statistics
        }
      }
    }

    const stories: Story[] = []
    const rejectedClusters: RejectedCluster[] = []

    // 限并发并行验证：每簇独立(collection 路径的 seen 去重是簇内的、不跨簇共享；
    // AI 验证的 LLM 调用是大头)，原串行逐簇 await 是次要 wall-clock 来源。
    // 按簇顺序合并结果保持确定性。
    //
    // 3 → 6(2026-08-18)：原注释给出的保守理由是"撞 DashScope 限流由 AIGateway 配额退避兜底"，
    // 而 DashScope 三档已在 c997f56 删除，现在走 Workers AI——该理由已失效。
    // 同仓 intelligence 分析走的是同一类 LLM 调用、并发早已是 6 且生产稳定
    // (auto-brief-generation.ts INTEL_CONCURRENCY，注释记录 18min→6min→3min)。
    // 实测依据：本步 wall-clock 随簇数线性涨——109s(16簇) → 293s(23簇) → 367s(24簇)，
    // 扩源后已是端到端第二大头(20 分钟里占 6 分钟)。
    const VALIDATION_CONCURRENCY = 6
    // 解析失败降级丢簇计数（Node 单线程，await 间自增原子安全）。落进 metadata + summary 日志，让静默丢簇可观测。
    let validationParseFailures = 0

    const validateCluster = async (
      cluster: (typeof clusteringResult.clusters)[number]
    ): Promise<{ stories: Story[]; rejected: RejectedCluster[] }> => {
      const outStories: Story[] = []
      const outRejected: RejectedCluster[] = []
      try {
        // HDBSCAN 的 -1 不是一个簇，是"没聚成簇"的残余集合——把它当故事候选送模型，
        // 是拿一次调用去拆解几百篇互不相关的文章。2026-08-18 实测它已占窗口文章约 70%
        // (515/745)，比最大真实簇(23 篇)大 22 倍，而 max_tokens=4000 的输出上限决定了
        // 响应必然被截断 → JSON 解析失败；又因 temperature=0 且 prompt 不变，4 次重采样
        // 是同一请求重发 4 遍，必然同样失败(run 76/77 均 4/4)。它从未产出过一个故事
        // (brief_stories 全表无 -1 来源记录)，纯粹每轮白烧 4 次超大调用，并且因为调度是
        // "分批 + 批间栅栏"，它所在批次的其余簇都要陪它等 → 并发提上去也吃不到收益。
        //
        // 跳过的是**模型判定**，不是**记录**：仍然落一条带完整 originalArticleIds 的拒绝
        // 记录，让"哪些文章从未进入任何故事"可从 cluster_rejections 直接查（复盘/救回噪声
        // 桶是独立的一件事，届时从这张表取样本，不必回头翻 R2）。
        if (cluster.clusterId === -1) {
          console.log(`[Story Validation] 跳过 -1 噪声组(${cluster.articleIds.length} 篇)：非簇，不送模型判定，仅登记`)
          outRejected.push({
            clusterId: cluster.clusterId,
            rejectionReason: "NOISE_BUCKET_SKIPPED",
            originalArticleIds: cluster.articleIds
          })
          return { stories: outStories, rejected: outRejected }
        }

        // 基本尺寸过滤
        if (cluster.size < 3) {
          outRejected.push({
            clusterId: cluster.clusterId,
            rejectionReason: "INSUFFICIENT_ARTICLES",
            originalArticleIds: cluster.articleIds
          })
          return { stories: outStories, rejected: outRejected }
        }

        // 对于足够大的聚类，使用AI进行深度验证
        if (useAI && cluster.size >= 3) {
          const validation = await this.performAIValidation(cluster, articlesData, options)

          if (validation.answer === 'single_story') {
            const validArticleIds = cluster.articleIds.filter(
              (id: number) => !validation.outliers?.includes(id)
            )

            if (validArticleIds.length >= 2) {
              outStories.push({
                title: validation.title || `Story ${cluster.clusterId}`,
                importance: this.importanceFromDims(validation),
                articleIds: validArticleIds,
                storyType: "SINGLE_STORY"
              })
            } else {
              outRejected.push({
                clusterId: cluster.clusterId,
                rejectionReason: "INSUFFICIENT_ARTICLES",
                originalArticleIds: cluster.articleIds
              })
            }
          } else if (validation.answer === 'collection_of_stories') {
            // 故事集合：分解为多个独立故事。
            // LLM 吐回的 article id 视为不可信输入：只留确属本簇、且未被别的子故事用过的。
            // (曾观测到幻觉 id —— 簇外/捏造 —— 与跨子故事重复；用簇成员白名单挡掉，不靠模型自觉)
            const clusterIds = new Set(cluster.articleIds)
            const seen = new Set<number>()
            let addedFromCollection = 0
            validation.stories?.forEach((story: any, index: number) => {
              const ids: number[] = (Array.isArray(story.articles) ? story.articles : [])
                .filter((id: any) => typeof id === 'number' && clusterIds.has(id) && !seen.has(id))
              if (ids.length >= 2) {
                ids.forEach((id: number) => seen.add(id))
                outStories.push({
                  title: story.title || `Story ${cluster.clusterId}-${index + 1}`,
                  importance: this.importanceFromDims(story),
                  articleIds: ids,
                  storyType: "SINGLE_STORY" // 分解后的每个故事都是单一故事
                })
                addedFromCollection++
              }
            })
            // 子集过滤后一个有效故事都不剩(全幻觉 / 全单篇 / 全重复)→ 显式拒绝，便于观测
            if (addedFromCollection === 0) {
              outRejected.push({
                clusterId: cluster.clusterId,
                rejectionReason: "NO_STORIES",
                originalArticleIds: cluster.articleIds
              })
            }
          } else if (validation.answer === 'pure_noise') {
            outRejected.push({
              clusterId: cluster.clusterId,
              rejectionReason: "PURE_NOISE",
              originalArticleIds: cluster.articleIds
            })
          } else {
            // no_stories 或其他情况。区分：parseFailed 时这是解析失败的兜底降级，非模型判定 → 计数留痕。
            if (validation.parseFailed) validationParseFailures++
            outRejected.push({
              clusterId: cluster.clusterId,
              rejectionReason: "NO_STORIES",
              originalArticleIds: cluster.articleIds
            })
          }
        } else {
          // 简单验证：按尺寸分类
          outStories.push({
            title: `Story ${cluster.clusterId}`,
            importance: Math.floor(Math.random() * 10) + 1,
            articleIds: cluster.articleIds,
            storyType: "SINGLE_STORY"
          })
        }
      } catch (error) {
        console.warn(`[Story Validation] 聚类 ${cluster.clusterId} 验证失败:`, error)
        // 验证失败的聚类标记为拒绝
        outRejected.push({
          clusterId: cluster.clusterId,
          rejectionReason: "NO_STORIES",
          originalArticleIds: cluster.articleIds
        })
      }
      return { stories: outStories, rejected: outRejected }
    }

    for (let i = 0; i < clusteringResult.clusters.length; i += VALIDATION_CONCURRENCY) {
      const batch = clusteringResult.clusters.slice(i, i + VALIDATION_CONCURRENCY)
      const batchResults = await Promise.all(batch.map(validateCluster))
      for (const r of batchResults) {
        stories.push(...r.stories)
        rejectedClusters.push(...r.rejected)
      }
    }
    
    console.log(`[Story Validation] 验证完成: ${stories.length} 个有效故事, ${rejectedClusters.length} 个拒绝聚类` +
      (validationParseFailures > 0 ? `（其中 ${validationParseFailures} 个因验证响应解析失败被降级丢弃，非模型判定）` : ''))

    return {
      stories,
      rejectedClusters,
      metadata: {
        totalClusters: clusteringResult.clusters.length,
        totalArticlesProvided: articlesData.length,
        validatedStories: stories.length,
        rejectedClusters: rejectedClusters.length,
        validationParseFailures,
        processingStatistics: clusteringResult.statistics
      }
    }
  }

  /**
   * importance 容错归一：模型偶尔返回字符串("high"/"medium")或数字字符串("7")。
   * 裸用 Math.max("high",1) 会得 NaN 污染下游排序。统一成 1-10 整数,无法识别默认 5。
   * prompt 已要求整数,此处为双保险(已观测到 collection 路径吐 "high"/"medium")。
   */
  /**
   * 重要性 = 时政硬新闻 rubric 的 4 维加权(LLM 打 d1-d4 ∈ 0-3,权重留此便于金标校准、不改 prompt)。
   * importance = (0.35·d1 + 0.30·d2 + 0.20·d3 + 0.15·d4) × 3.33 → 1-10。
   * 维度缺失则回退:有 legacy importance 字段沿用 coerceImportance(过渡期兜底),否则中性 5。
   */
  private importanceFromDims(v: any): number {
    const g = (x: any) => Math.min(Math.max(Math.round(Number(x)) || 0, 0), 3)
    const s = v?.scoring
    // 新形态:scoring.dX.score（CoT 后的分）；过渡:dimensions.dX；再退:legacy importance
    let dims: any = null
    if (s && typeof s === 'object') dims = { d1: s.d1?.score, d2: s.d2?.score, d3: s.d3?.score, d4: s.d4?.score }
    else if (v?.dimensions && typeof v.dimensions === 'object') dims = v.dimensions
    if (dims) {
      const raw = 0.35 * g(dims.d1) + 0.30 * g(dims.d2) + 0.20 * g(dims.d3) + 0.15 * g(dims.d4)
      return Math.min(Math.max(Math.round(raw * 3.33), 1), 10)
    }
    if (v?.importance !== undefined) return this.coerceImportance(v.importance)
    return 5
  }

  private coerceImportance(v: any): number {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.min(Math.max(Math.round(v), 1), 10)
    }
    if (typeof v === 'string') {
      const n = parseFloat(v.trim())
      if (Number.isFinite(n)) return Math.min(Math.max(Math.round(n), 1), 10)
      const map: Record<string, number> = {
        'critical': 9, 'very high': 9, 'high': 8, 'medium-high': 7,
        'moderate': 5, 'medium': 5, 'low': 3, 'very low': 2, 'minor': 2,
      }
      const w = map[v.trim().toLowerCase()]
      if (w !== undefined) return w
    }
    return 5
  }

  /**
   * 使用AI验证单个聚类
   */
  private async performAIValidation(
    cluster: ClusterItem,
    articlesData: MinimalArticleInfo[],
    options?: { provider?: string; model?: string }
  ): Promise<AIValidationResponse> {
    // 从 articlesData 中查找文章信息，构建详细的文章列表
    const articleList = cluster.articleIds
      .map(id => {
        const article = articlesData.find(a => a.id === id)
        if (!article) {
          return `- Article ID: ${id} (无文章信息)`
        }
        
        let articleInfo = `- ID: ${article.id}\n  标题: ${article.title}\n  URL: ${article.url}`
        
        // 添加摘要要点（如果存在）
        if (Array.isArray(article.event_summary_points) && article.event_summary_points.length > 0) {
          articleInfo += `\n  摘要要点: ${article.event_summary_points.join('; ')}`
        }
        
        return articleInfo
      })
      .join('\n\n')

    const validationPrompt = getStoryValidationPrompt(articleList)

    // 格式失败重采样。此前一次解析失败即 return no_stories → **整簇消失**，连一次重试都没有，
    // 而隔壁情报分析同模型同类 JSON 有 4 次（INTEL_PARSE_MAX_ATTEMPTS）——全管线最不对称处。
    // 生产 7 天实测该降级触发 11 次（其中 5 次是真簇、6 次是 -1 噪声桶）。
    // 只对解析失败重采样：模型判定的 no_stories / pure_noise 是合法结论，重问只会得到同样答案。
    // 实测主因是"漏写字符串值的开引号"（`"why": A recurring…`），即采样噪声，重采样对症。
    let validation: any = null
    let attempts = 0
    for (let attempt = 1; attempt <= SV_PARSE_MAX_ATTEMPTS; attempt++) {
      attempts = attempt
      const response = await this.callAI(validationPrompt, undefined, {
        provider: options?.provider,
        model: options?.model,
        temperature: 0
      })
      validation = this.parseJSONFromResponse(response)
      if (validation) {
        if (attempt > 1) console.log(`[Story Validation] 聚类 ${cluster.clusterId} 第 ${attempt} 次重采样解析成功`)
        break
      }
      console.warn(`[Story Validation] 聚类 ${cluster.clusterId} 验证响应解析失败，重采样 (${attempt}/${SV_PARSE_MAX_ATTEMPTS})`)
    }

    // 重采样次数落 R2：只写 console 就无法跨 run 统计"模型格式稳定性"。只在真发生过重采样时写。
    // idx 用 clusterId + 1：clusterId 可为 -1（噪声桶），负数进 padStart 会得到 "-1" 这种别扭 key，
    // +1 后 -1→0、0→1，仍然一簇一 key 不碰撞。
    if (attempts > 1) {
      await recordSensor(this.env, this.traceContext, 'story_validation_parse', {
        clusterId: cluster.clusterId,
        clusterSize: cluster.articleIds.length,
        attempts,
        maxAttempts: SV_PARSE_MAX_ATTEMPTS,
        exhausted: validation === null,
      }, cluster.clusterId + 1)
    }

    if (!validation) {
      // 耗尽仍失败：仍降级为 no_stories（不改丢弃行为），但打 parseFailed 标记 + 具名日志，
      // 让"解析失败伪装的没故事"可被调用方/指标区分，不再与"模型真判没故事"静默合流。
      console.warn(
        `[Story Validation] SV_PARSE_EXHAUSTED 聚类 ${cluster.clusterId} 连续 ${SV_PARSE_MAX_ATTEMPTS} 次解析失败 ` +
        `→ 降级 no_stories（非模型判定，整簇 ${cluster.articleIds.length} 篇将被丢弃）`
      )
      return { answer: 'no_stories', parseFailed: true }
    }
    return validation
  }

  /**
   * 调用AI接口
   */
  private async callAI(
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

    // 配置（provider/model/temperature/skipCache）走 call-llm 单一入口按 phase 定默认；
    // temperature 仍 ?? 语义（performAIValidation 显式 0 不被吞）。
    const result = await callLLM(this.aiGateway, this.env, this.traceContext, 'story_validation', messages, {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      metadata: this.createRequestMetadata(),
    })
    if (result.capability !== 'chat') {
      throw new Error('Unexpected response type from chat service')
    }

    return result.choices?.[0]?.message?.content || ''
  }

  /**
   * 解析AI响应中的JSON
   */
  private parseJSONFromResponse(response: string): any {
    // 候选片段：优先 ```json/``` 代码块，否则尝试第一个 {...} 块，最后整段
    const candidates: string[] = []
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) candidates.push(fenced[1])
    const firstBrace = response.indexOf('{')
    const lastBrace = response.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(response.slice(firstBrace, lastBrace + 1))
    }
    candidates.push(response)

    for (const raw of candidates) {
      // 容错清洗：去掉行内 // 注释、块注释、尾随逗号
      const cleaned = raw
        .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */ 块注释
        .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1') // // 行内注释（避开 url 里的 ://）
        .replace(/,(\s*[}\]])/g, '$1') // 尾随逗号
        .trim()
      try {
        return JSON.parse(cleaned)
      } catch {
        // try next candidate
      }
    }
    console.warn('JSON解析失败，原始响应前 300 字符:', response.slice(0, 300))
    return null
  }

  /**
   * 创建请求元数据
   */
  private createRequestMetadata() {
    return {
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      timestamp: Date.now(),
      userAgent: 'story-validation-service',
      ipAddress: 'unknown'
    }
  }
} 