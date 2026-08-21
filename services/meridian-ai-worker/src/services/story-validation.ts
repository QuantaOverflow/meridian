import { AIGatewayService } from './ai-gateway'
import { TraceContext } from './llm-call-logger'
import { callLLM } from './call-llm'
import { getStoryJudgePrompt, getStoryVerifyPrompt } from '../prompts/storyValidation'
import {
  StoryValidationRequest,
  StoryValidationResult,
  Story,
  RejectedCluster,
  CandidateGroup,
  MinimalArticleInfo
} from '../types/story-validation'
import { CloudflareEnv } from '../types'
import { recordSensor } from './sensor-log'

// 解析失败重采样上限。与情报分析的 INTEL_PARSE_MAX_ATTEMPTS 取同值：同模型同类 JSON 格式滑手，
// 没有理由一边给 4 次机会、一边给 0 次。
const SV_PARSE_MAX_ATTEMPTS = 4

// 判官/复核并发。原实现是「分批 + 批间栅栏」，一个慢组会拖住整批；换成 worker pool 后
// 空闲槽立刻取下一项。取 6 与情报分析(INTEL_CONCURRENCY)一致，该值在生产已稳定。
// 规模参考：2026-08-20 全量 57 簇 1254 篇 → 201 候选组 + 约 195 次复核 ≈ 396 次调用，
// 实测单次判官中位 4.1s、复核 2.3s，并发 6 下端到端约 9 分钟（step 预算 25 分钟）。
const JUDGE_CONCURRENCY = 6
const VERIFY_CONCURRENCY = 6

/** 有序 worker pool：结果按输入顺序返回，保证同输入同输出（确定性对 eval 复现是硬要求）。 */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** 判官对单个候选组的产出 */
interface JudgedStory {
  clusterId: number
  groupId: string
  title: string
  importance: number
  articleIds: number[]
}

export class StoryValidationService {
  private aiGateway: AIGatewayService
  private env: CloudflareEnv
  private traceContext: TraceContext
  // 传感记录的落盘序号。recordSensor 的 idx 默认 0，不传会让同 kind 的记录互相覆盖到同一个 key。
  // 单元已从「簇」变成「候选组」，clusterId 不再唯一（一簇多组），故改用单调计数器。
  private sensorIdx = 0

  constructor(env: CloudflareEnv, traceContext: TraceContext = {}) {
    this.env = env
    this.aiGateway = new AIGatewayService(env)
    this.traceContext = traceContext
  }

  /**
   * 两段式故事验证：几何候选组 → 判官逐组找同事件子集 → 复核逐故事严格二审。
   *
   * 2026-08-21 架构替换（原为「整簇送 LLM，让它自己划出所有子故事」）。换法与实测见
   * prompts/storyValidation.ts 顶部说明；候选组的几何在 backend 侧算，见
   * apps/backend/src/lib/core/candidate-grouping.ts。
   *
   * 人工严口径（scripts/eval/story-validation/rubric.md，08-18 与 08-20 两天独立复验）：
   *   生产原形态 41.7% → 本形态 89-92%；进简报的前 15 条精度 93.3%（两天相同）。
   */
  async validateStories(request: StoryValidationRequest): Promise<StoryValidationResult> {
    const { clusteringResult, candidateGroups, articlesData, options } = request

    console.log(
      `[Story Validation] ${clusteringResult.clusters.length} 个聚类 → ${candidateGroups.length} 个候选组，` +
      `文章元数据 ${articlesData.length} 条`
    )

    const byId = new Map(articlesData.map(a => [a.id, a]))
    const rejected: RejectedCluster[] = []

    if (!candidateGroups.length) {
      return {
        stories: [],
        rejectedClusters: [],
        metadata: {
          totalClusters: clusteringResult.clusters.length,
          totalArticlesProvided: articlesData.length,
          validatedStories: 0,
          rejectedClusters: 0,
          candidateGroups: 0,
          verifyCalls: 0,
          processingStatistics: clusteringResult.statistics
        }
      }
    }

    // ---- 几何阶段的落单文章：不进判官，但必须留痕（否则又是「零记录消失」）----
    const grouped = new Set<number>()
    for (const g of candidateGroups) for (const id of g.articleIds) grouped.add(id)
    for (const c of clusteringResult.clusters) {
      const notGrouped = c.articleIds.filter(id => !grouped.has(id))
      if (notGrouped.length > 0) {
        rejected.push({ clusterId: c.clusterId, rejectionReason: 'NOT_GROUPED', originalArticleIds: notGrouped })
      }
    }

    // ---- 阶段 1：判官 ----
    let parseFailures = 0
    let callFailures = 0
    const judgeResults = await runPool(candidateGroups, JUDGE_CONCURRENCY, async group => {
      try {
        return await this.judgeGroup(group, byId, options)
      } catch (error) {
        console.warn(`[Story Validation] 候选组 ${group.groupId} 判官调用失败:`, error)
        return { stories: [] as JudgedStory[], leftOut: group.articleIds, parseExhausted: false, callFailed: true }
      }
    })

    const judgedStories: JudgedStory[] = []
    judgeResults.forEach((r, i) => {
      const group = candidateGroups[i]
      judgedStories.push(...r.stories)
      if (r.parseExhausted) parseFailures++
      if ((r as any).callFailed) callFailures++
      if (r.leftOut.length > 0) {
        rejected.push({
          clusterId: group.clusterId,
          groupId: group.groupId,
          rejectionReason: (r as any).callFailed
            ? 'CALL_FAILED'
            : r.parseExhausted
              ? 'PARSE_EXHAUSTED'
              : r.stories.length === 0
                ? 'JUDGE_NO_EVENT'
                : 'JUDGE_LEFT_OUT',
          originalArticleIds: r.leftOut
        })
      }
    })

    console.log(`[Story Validation] 判官阶段：${candidateGroups.length} 组 → ${judgedStories.length} 个候选故事`)

    // ---- 阶段 2：复核 ----
    const verifyResults = await runPool(judgedStories, VERIFY_CONCURRENCY, async story => {
      try {
        return await this.verifyStory(story, byId, options)
      } catch (error) {
        // 复核调用失败：保守保留原故事（不因二审故障而丢已确认的故事），留日志
        console.warn(`[Story Validation] 故事 ${story.groupId} 复核调用失败，保留原判:`, error)
        return { stories: [story], dropped: [] as number[], parseExhausted: false }
      }
    })

    const stories: Story[] = []
    verifyResults.forEach((r, i) => {
      const src = judgedStories[i]
      if (r.parseExhausted) parseFailures++
      for (const s of r.stories) {
        stories.push({
          title: s.title,
          importance: s.importance,
          articleIds: s.articleIds,
          storyType: 'SINGLE_STORY',
          clusterId: s.clusterId,
          groupId: s.groupId
        })
      }
      if (r.dropped.length > 0) {
        rejected.push({
          clusterId: src.clusterId,
          groupId: src.groupId,
          rejectionReason: 'VERIFY_DROPPED',
          originalArticleIds: r.dropped
        })
      }
    })

    const droppedArticles = rejected
      .filter(r => r.rejectionReason !== 'NOT_GROUPED')
      .reduce((s, r) => s + r.originalArticleIds.length, 0)

    console.log(
      `[Story Validation] 完成：${stories.length} 个故事，${rejected.length} 条拒绝记录` +
      `（判官/复核阶段丢弃 ${droppedArticles} 篇，几何落单 ${rejected.filter(r => r.rejectionReason === 'NOT_GROUPED').reduce((s, r) => s + r.originalArticleIds.length, 0)} 篇）` +
      (parseFailures > 0 ? `；${parseFailures} 次解析耗尽降级（非模型判定）` : '') +
      (callFailures > 0 ? `；${callFailures} 个候选组 LLM 调用失败（非模型判定，已按 CALL_FAILED 留痕）` : '')
    )

    return {
      stories,
      rejectedClusters: rejected,
      metadata: {
        totalClusters: clusteringResult.clusters.length,
        totalArticlesProvided: articlesData.length,
        validatedStories: stories.length,
        rejectedClusters: rejected.length,
        validationParseFailures: parseFailures,
        validationCallFailures: callFailures,
        candidateGroups: candidateGroups.length,
        verifyCalls: judgedStories.length,
        partiallyDroppedArticles: droppedArticles,
        processingStatistics: clusteringResult.statistics
      }
    }
  }

  // ==========================================================================
  // 阶段 1：判官
  // ==========================================================================

  private async judgeGroup(
    group: CandidateGroup,
    byId: Map<number, MinimalArticleInfo>,
    options?: { provider?: string; model?: string }
  ): Promise<{ stories: JudgedStory[]; leftOut: number[]; parseExhausted: boolean }> {
    const prompt = getStoryJudgePrompt(this.renderArticleList(group.articleIds, byId))
    const parsed = await this.callWithParseRetry(prompt, `候选组 ${group.groupId}`, group, options)

    if (!parsed) {
      return { stories: [], leftOut: group.articleIds, parseExhausted: true }
    }

    // LLM 吐回的 article id 视为不可信输入：只留确属本组、且未被别的子故事用过的。
    // （已观测到幻觉 id —— 组外/捏造 —— 与跨子故事重复；用白名单挡掉，不靠模型自觉）
    const inGroup = new Set(group.articleIds)
    const used = new Set<number>()
    const stories: JudgedStory[] = []
    const events = Array.isArray(parsed?.events) ? parsed.events : []

    events.forEach((ev: any, idx: number) => {
      const raw: number[] = Array.isArray(ev?.members) ? ev.members : []
      const members = [...new Set(raw.filter((x: any) => Number.isInteger(x) && inGroup.has(x) && !used.has(x)))]
        .sort((a, b) => a - b)
      if (members.length < 2) return
      members.forEach(x => used.add(x))
      stories.push({
        clusterId: group.clusterId,
        groupId: group.groupId,
        title: typeof ev?.title === 'string' && ev.title.trim() ? ev.title : `Story ${group.groupId}-${idx + 1}`,
        importance: this.importanceFromDims(ev),
        articleIds: members
      })
    })

    return {
      stories,
      leftOut: group.articleIds.filter(id => !used.has(id)),
      parseExhausted: false
    }
  }

  // ==========================================================================
  // 阶段 2：复核
  // ==========================================================================

  private async verifyStory(
    story: JudgedStory,
    byId: Map<number, MinimalArticleInfo>,
    options?: { provider?: string; model?: string }
  ): Promise<{ stories: JudgedStory[]; dropped: number[]; parseExhausted: boolean }> {
    const prompt = getStoryVerifyPrompt(
      story.title,
      this.renderArticleBlock(story.articleIds, byId),
      story.articleIds.length
    )
    const parsed = await this.callWithParseRetry(
      prompt,
      `故事 ${story.groupId}`,
      { clusterId: story.clusterId, groupId: story.groupId, articleIds: story.articleIds },
      options
    )

    // 解析耗尽：保守保留原故事（复核是加码的二审，二审失灵不该反过来吃掉已确认的故事）
    if (!parsed) return { stories: [story], dropped: [], parseExhausted: true }

    const inSet = new Set(story.articleIds)
    const clean = (arr: any): number[] =>
      [...new Set((Array.isArray(arr) ? arr : []).filter((x: any) => Number.isInteger(x) && inSet.has(x)))]

    const action = ['confirm', 'split', 'trim'].includes(parsed?.action) ? parsed.action : null
    if (!action) {
      console.warn(`[Story Validation] 故事 ${story.groupId} 复核返回非法 action=${JSON.stringify(parsed?.action)} → 保留原判`)
      return { stories: [story], dropped: [], parseExhausted: false }
    }

    if (action === 'confirm') return { stories: [story], dropped: [], parseExhausted: false }

    if (action === 'split') {
      const used = new Set<number>()
      const out: JudgedStory[] = []
      for (const g of (Array.isArray(parsed.groups) ? parsed.groups : [])) {
        const members = clean(g?.members).filter(x => !used.has(x)).sort((a, b) => a - b)
        if (members.length < 2) continue
        members.forEach(x => used.add(x))
        out.push({
          ...story,
          title: typeof g?.title === 'string' && g.title.trim() ? g.title : story.title,
          articleIds: members
        })
      }
      // split 未给出任何 ≥2 篇的有效组 → 该故事作废（复核认定它压根不是一个事件）
      return { stories: out, dropped: story.articleIds.filter(id => !used.has(id)), parseExhausted: false }
    }

    // trim：剔除不属于该事件的成员；剩不足 2 篇则整条作废（prompt 明文允许并预期这种情况）
    const remove = new Set(clean(parsed.remove))
    const keep = story.articleIds.filter(id => !remove.has(id))
    if (keep.length >= 2) {
      return { stories: [{ ...story, articleIds: keep }], dropped: [...remove], parseExhausted: false }
    }
    return { stories: [], dropped: story.articleIds, parseExhausted: false }
  }

  // ==========================================================================
  // 共用
  // ==========================================================================

  /**
   * 判官输入的文章清单。格式与 2026-08-21 离线验过的原型逐字节一致
   * （中文标签 + URL；用归档 promptTok 回归定位、再打真调用把差值归零确认）。
   */
  private renderArticleList(ids: number[], byId: Map<number, MinimalArticleInfo>): string {
    return ids
      .map(id => {
        const a = byId.get(id)
        if (!a) return `- Article ID: ${id} (无文章信息)`
        let s = `- ID: ${a.id}\n  标题: ${a.title}\n  URL: ${a.url}`
        if (Array.isArray(a.event_summary_points) && a.event_summary_points.length > 0) {
          s += `\n  摘要要点: ${a.event_summary_points.join('; ')}`
        }
        return s
      })
      .join('\n\n')
  }

  /** 复核输入的文章块。原型的复核 prompt 用的是英文标签且不含 URL，此处保持一致。 */
  private renderArticleBlock(ids: number[], byId: Map<number, MinimalArticleInfo>): string {
    return ids
      .map(id => {
        const a = byId.get(id)
        if (!a) return `- ID: ${id} (no article info)`
        let s = `- ID: ${a.id}\n  Title: ${a.title}`
        if (Array.isArray(a.event_summary_points) && a.event_summary_points.length > 0) {
          s += `\n  Summary points: ${a.event_summary_points.join('; ')}`
        }
        return s
      })
      .join('\n\n')
  }

  /**
   * 调 LLM + 解析失败重采样。只对**解析失败**重采样：模型判定的「组内没有同事件」是合法结论，
   * 重问只会得到同样答案。实测主因是漏写字符串值的开引号（`"why": A recurring…`），
   * 即采样噪声，重采样对症。
   */
  private async callWithParseRetry(
    prompt: string,
    label: string,
    ctx: { clusterId: number; groupId: string; articleIds: number[] },
    options?: { provider?: string; model?: string }
  ): Promise<any | null> {
    let parsed: any = null
    let attempts = 0
    for (let attempt = 1; attempt <= SV_PARSE_MAX_ATTEMPTS; attempt++) {
      attempts = attempt
      const response = await this.callAI(prompt, undefined, {
        provider: options?.provider,
        model: options?.model,
        temperature: 0
      })
      parsed = this.parseJSONFromResponse(response)
      if (parsed) {
        if (attempt > 1) console.log(`[Story Validation] ${label} 第 ${attempt} 次重采样解析成功`)
        break
      }
      console.warn(`[Story Validation] ${label} 响应解析失败，重采样 (${attempt}/${SV_PARSE_MAX_ATTEMPTS})`)
    }

    // 重采样次数落 R2：只写 console 就无法跨 run 统计「模型格式稳定性」。只在真发生过重采样时写。
    if (attempts > 1) {
      await recordSensor(this.env, this.traceContext, 'story_validation_parse', {
        clusterId: ctx.clusterId,
        groupId: ctx.groupId,
        groupSize: ctx.articleIds.length,
        attempts,
        maxAttempts: SV_PARSE_MAX_ATTEMPTS,
        exhausted: parsed === null,
      }, ++this.sensorIdx)
    }

    if (!parsed) {
      console.warn(
        `[Story Validation] SV_PARSE_EXHAUSTED ${label} 连续 ${SV_PARSE_MAX_ATTEMPTS} 次解析失败 ` +
        `→ 降级（非模型判定，涉及 ${ctx.articleIds.length} 篇）`
      )
    }
    return parsed
  }

  /**
   * 重要性 = 时政硬新闻 rubric 的 4 维加权(LLM 打 d1-d4 ∈ 0-3,权重留此便于金标校准、不改 prompt)。
   * importance = (0.35·d1 + 0.30·d2 + 0.20·d3 + 0.15·d4) × 3.33 → 1-10。
   * 维度缺失则回退:有 legacy importance 字段沿用 coerceImportance(过渡期兜底),否则中性 5。
   */
  private importanceFromDims(v: any): number {
    const g = (x: any) => Math.min(Math.max(Math.round(Number(x)) || 0, 0), 3)
    const s = v?.scoring
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

  /**
   * importance 容错归一：模型偶尔返回字符串("high"/"medium")或数字字符串("7")。
   * 裸用 Math.max("high",1) 会得 NaN 污染下游排序。统一成 1-10 整数,无法识别默认 5。
   */
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
    // temperature 仍 ?? 语义（此处显式 0 不被吞）。
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
