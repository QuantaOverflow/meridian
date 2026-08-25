/**
 * 简报生成服务
 * 基于 intelligence-pipeline.test.ts 的简报生成契约
 * 生产环境错误处理，直接抛出错误而不使用fallback
 */

import { z } from 'zod';
import { AIGatewayService } from './ai-gateway';
import { TraceContext, LLMCallPhase } from './llm-call-logger';
import { callLLM, PHASE_DEFAULTS } from './call-llm';
import {
  getBriefGenerationSystemPrompt,
  getBriefGenerationPrompt,
  getBriefTitlePrompt,
  getBriefVerificationPrompt,
  getBriefCoverageReconciliationPrompt
} from '../prompts/briefGeneration';
import { getTldrGenerationPrompt } from '../prompts/tldrGeneration';
import { checkBriefHygiene } from '../utils/brief-hygiene';
import { recordSensor } from './sensor-log';
import { CloudflareEnv, ChatResponse } from '../types';

// ============================================================================
// 数据结构定义 - 符合测试契约
// ============================================================================

// 情报分析数据结构（输入数据）
const TimelineEventSchema = z.object({
  date: z.string().datetime(),
  description: z.string(),
  importance: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

const SignificanceAssessmentSchema = z.object({
  level: z.enum(["CRITICAL", "HIGH", "MODERATE", "LOW"]),
  reasoning: z.string(),
});

const EntitySchema = z.object({
  name: z.string(),
  type: z.string(),
  role: z.string(),
  positions: z.array(z.string()),
});

const SourceAnalysisSchema = z.object({
  sourceName: z.string(),
  articleIds: z.array(z.number()),
  reliabilityLevel: z.enum(["VERY_HIGH", "HIGH", "MODERATE", "LOW", "VERY_LOW"]),
  bias: z.string(),
});

const ClaimSchema = z.object({
  source: z.string(),
  statement: z.string(),
  entity: z.string().optional(),
});

const ContradictionSchema = z.object({
  issue: z.string(),
  conflictingClaims: z.array(ClaimSchema),
});

const IntelligenceReportSchema = z.object({
  storyId: z.string(),
  status: z.enum(["COMPLETE", "INCOMPLETE"]),
  executiveSummary: z.string(),
  storyStatus: z.enum(["DEVELOPING", "ESCALATING", "DE_ESCALATING", "CONCLUDING", "STATIC"]),
  timeline: z.array(TimelineEventSchema),
  significance: SignificanceAssessmentSchema,
  entities: z.array(EntitySchema),
  sources: z.array(SourceAnalysisSchema),
  factualBasis: z.array(z.string()),
  informationGaps: z.array(z.string()),
  contradictions: z.array(ContradictionSchema),
});

const ProcessingStatusSchema = z.object({
  totalStories: z.number(),
  completedAnalyses: z.number(),
  failedAnalyses: z.number(),
});

const IntelligenceReportsSchema = z.object({
  reports: z.array(IntelligenceReportSchema),
  processingStatus: ProcessingStatusSchema,
});

// 简报生成数据结构（输出数据）
const BriefMetadataSchema = z.object({
  title: z.string(),
  createdAt: z.string().datetime(),
  model: z.string(),
  tldr: z.string(),
});

const BriefSectionSchema = z.object({
  sectionType: z.enum([
    "WHAT_MATTERS_NOW", 
    "FRANCE_FOCUS", 
    "GLOBAL_LANDSCAPE",
    "CHINA_MONITOR", 
    "TECH_SCIENCE", 
    "NOTEWORTHY", 
    "POSITIVE_DEVELOPMENTS"
  ]),
  title: z.string(),
  content: z.string(),
  priority: z.number(),
});

const BriefContentSchema = z.object({
  sections: z.array(BriefSectionSchema),
  format: z.enum(["MARKDOWN", "JSON", "HTML"]),
});

const BriefStatisticsSchema = z.object({
  totalArticlesProcessed: z.number(),
  totalSourcesUsed: z.number(),
  articlesUsedInBrief: z.number(),
  sourcesUsedInBrief: z.number(),
  clusteringParameters: z.object({}),
});

const PreviousBriefContextSchema = z.object({
  date: z.string().datetime(),
  title: z.string(),
  summary: z.string(),
  coveredTopics: z.array(z.string()),
});

const FinalBriefSchema = z.object({
  metadata: BriefMetadataSchema,
  content: BriefContentSchema,
  statistics: BriefStatisticsSchema,
});

// 覆盖对账记录（洞3 方案B）：一条候选 story 在成品简报里的去向。
// disposition=headline(成篇)/noteworthy(降级)/dropped(丢弃)；section/reason 见对账 prompt。
// reasonInferred 恒 true——丢弃/降级理由是事后推断，非合成模型当时真意（方案B的固有局限）。
export type CoverageEntry = {
  storyId: string;
  storyLabel: string;
  disposition: 'headline' | 'noteworthy' | 'dropped';
  section: string | null;
  reason: string;
  reasonInferred: true;
};

// 类型定义
export type IntelligenceReports = z.infer<typeof IntelligenceReportsSchema>;
export type FinalBrief = z.infer<typeof FinalBriefSchema>;
export type PreviousBriefContext = z.infer<typeof PreviousBriefContextSchema>;
export type IntelligenceReport = z.infer<typeof IntelligenceReportSchema>;

// ============================================================================
// 错误处理器 - 生产环境版本
// ============================================================================

class BriefErrorHandler {
  
  /**
   * 检查是否为配额限制错误
   */
  static isQuotaLimitError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorString = JSON.stringify(error).toLowerCase();
    
    return (
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('resource exhausted') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('no response received') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('ai gateway') ||
      errorString.includes('quota') ||
      errorString.includes('rate_limit') ||
      errorString.includes('429')
    );
  }

  /**
   * 指数退避重试策略
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // 如果不是配额错误，直接抛出
        if (!this.isQuotaLimitError(error)) {
          throw error;
        }
        
        // 最后一次尝试失败
        if (attempt === maxRetries) {
          console.error(`[Brief Generation] 重试 ${maxRetries} 次后仍失败，配额限制错误:`, {
            error: error.message,
            attempt: attempt + 1,
            timestamp: new Date().toISOString()
          });
          throw error;
        }
        
        // 计算延迟时间（指数退避）
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        
        console.warn(`[Brief Generation] 配额限制错误，第 ${attempt + 1}/${maxRetries + 1} 次尝试，${delay}ms 后重试:`, {
          error: error.message,
          nextDelay: delay,
          timestamp: new Date().toISOString()
        });
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}

// 故事标题的 <u>**title**</u> 写法不是审美选择：前端目录（useTableOfContents.ts）的选择器
// 是 'h2, h3, u > strong'，靠 <strong> 认故事标题。模型只写 <u>title</u> 时 markdown 照常
// 渲染出下划线、正文看不出任何异常，但该故事进不了目录——静默失效，无报错、typecheck 查不到。
// 2026-08-22 A/B 实测：旧 prompt 8 个故事块 0/8 带 **，那份简报的目录里一条故事都没有。
// 只认整行就是一个 <u>…</u> 的形态（实测两版简报的 <u> 全部独占一行、且从不出现在 noteworthy 区），
// 段落内联的 <u> 不碰。纯格式补齐，不改一个字。
export function normalizeStoryTitleMarkers(content: string): { content: string; fixed: number } {
  let fixed = 0;
  const out = content.replace(/^<u>(.+?)<\/u>[ \t]*$/gm, (whole, inner: string) => {
    if (inner.includes('**')) return whole;
    fixed++;
    return `<u>**${inner.trim()}**</u>`;
  });
  return { content: out, fixed };
}

// factualBasis / informationGaps 声明为 string[]，但情报分析 prompt 没规定这两个字段的
// JSON 结构，模型时而给 {description, importance} 对象；且本服务的入口（index.ts 的
// /meridian/generate-final-brief）是把 backend 回灌的 R2 报告原样透传，不经 builder 归一化，
// R2 里也已存着改这之前写入的对象形状。直接模板串插值会渲染成 "[object Object]"——
// 2026-08-22 生产 run 实证：一篇报告的「影响评估」4 条全废，整段垃圾喂进简报模型。
function renderListItem(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') {
    const text = (item as any).description ?? (item as any).text ?? (item as any).gap ?? (item as any).fact;
    if (typeof text === 'string') return text.trim();
  }
  return '';
}

// ============================================================================
// 简报生成服务
// ============================================================================

export class BriefGenerationService {
  private aiGatewayService: AIGatewayService;
  private traceContext: TraceContext;

  constructor(private env: CloudflareEnv, traceContext: TraceContext = {}) {
    this.aiGatewayService = new AIGatewayService(env);
    this.traceContext = traceContext;
  }

  /**
   * 生成最终简报 - 生产环境版本，直接抛出错误
   */
  async generateBrief(
    reports: IntelligenceReports,
    context?: PreviousBriefContext,
    options?: { selfCorrect?: boolean; reconcileCoverage?: boolean; coverageRepair?: boolean }
  ): Promise<{
    success: boolean;
    data?: FinalBrief;
    error?: string;
    coverage?: CoverageEntry[];
    /** 补录**前**的去向汇总；null = 未跑对账。落盘后的 coverage 是补录后的，此项是唯一的合成层原始质量信号。 */
    coverageBeforeRepair?: { total: number; headline: number; noteworthy: number; dropped: number } | null;
  }> {
    // RARR 式接地校验-改正默认开启（选项2）；eval baseline 臂可传 selfCorrect:false 关掉做对照。
    const selfCorrect = options?.selfCorrect !== false;
    // 两遍法覆盖补录默认【开启】（与 selfCorrect 同款语义）：对账找 dropped → 程序化补插
    // noteworthy。这是合成漏报的硬保证（prompt 契约只压均值），代价=每篇一次 qwen-long
    // 对账调用。eval 对照臂传 coverageRepair:false 关掉。
    const coverageRepair = options?.coverageRepair !== false;
    // 纯覆盖对账（洞3 方案B，只记账不补录）默认关闭；coverageRepair 开时对账自然会跑。
    // 单独需要观测数据时显式传 reconcileCoverage:true。
    const reconcileCoverage = options?.reconcileCoverage === true;
    try {
      console.log(`[Brief Generation] 开始生成简报，输入 ${reports.reports.length} 个报告（接地自纠=${selfCorrect}）`);

      // 增强输入验证
      if (!reports.reports.length) {
        console.warn('[Brief Generation] 拒绝生成：没有情报报告');
        return { 
          success: false, 
          error: "No intelligence reports provided. Brief generation requires at least one valid story analysis."
        };
      }

      // 验证报告质量
      const completeReports = reports.reports.filter(report => report.status === 'COMPLETE');
      if (completeReports.length === 0) {
        console.warn('[Brief Generation] 拒绝生成：没有完整的情报报告');
        return { 
          success: false, 
          error: `All ${reports.reports.length} intelligence reports are incomplete. Brief generation requires at least one complete story analysis.`
        };
      }

      console.log(`[Brief Generation] 使用 ${completeReports.length}/${reports.reports.length} 完整报告生成简报`);

      // AI生成（带重试策略，失败时直接抛出错误）
      const aiOperation = async () => {
        // 转换情报报告为Markdown格式
        const storiesMarkdown = this.convertReportsToMarkdown(reports.reports);
        const previousContext = context ? this.formatPreviousContext(context) : '';
        
        // 生成简报内容
        const briefPrompt = getBriefGenerationPrompt(storiesMarkdown, previousContext);
        const systemPrompt = getBriefGenerationSystemPrompt();
        
        // 多故事合成：输入是所有情报报告拼接的 Markdown + 前日简报上下文。原先覆盖成 qwen-long
        // 是因为要躲开 qwen-plus 的上下文上限；现 phase 默认已是 131k 上下文的模型，
        // 不再需要在此覆盖 model——留着覆盖会与 PHASE_DEFAULTS 的 provider 打架（组合无效）。
        const briefResponse = await this.callAI(briefPrompt, systemPrompt, {
          temperature: 0.7,
          maxTokens: 16000,
          phase: 'brief_generation',
          callIndex: 0
        });

        // 提取简报内容
        let content = briefResponse;
        if (content.includes('<final_brief>')) {
          content = content.split('<final_brief>')[1]?.split('</final_brief>')[0]?.trim() || content;
        }

        // RARR 接地校验-改正：拿 storiesMarkdown(源 oracle)核对草稿、贴源修正。
        // 在抽取后、标题生成前做，标题基于修正后的正文。
        if (selfCorrect) {
          content = await this.verifyAndCorrect(content, storiesMarkdown);
        }

        // 两遍法覆盖补录（治合成漏报的硬保证）：对账判官找出 dropped 的 story，
        // 程序化从该 story 自己的 executiveSummary 取首句补插 noteworthy 区。
        // 顺序有讲究（对标 uMedSum）：RARR 去编造在前、补漏在后——补录内容是上游
        // 报告原文逐字拷贝(by-construction 零新编造)，不需要也不应再过 RARR。
        // prompt 覆盖契约只能压均值（A/B 13.4%→6.2%），temp0.7 下偶发整期失守，
        // 这一步用程序强制把残余漏报兜住。best-effort：对账失败则跳过，不拖垮主流程。
        let coverage: CoverageEntry[] = [];
        if (coverageRepair || reconcileCoverage) {
          coverage = await this.reconcileCoverage(content, reports.reports);
        }
        // 补录**前**的去向快照。补录按构造把 dropped 推到 0，落盘的 coverage 是补录后的，
        // 于是"合成这一遍到底漏了多少"在持久化数据里完全看不见——只剩一行日志。
        // 而这恰恰是唯一能区分不同生成模型合成质量的信号（补录只是兜底网，不改善上游）。
        // 只存汇总不存全量：明细在补录后的 coverage 里已有，这里多存一份纯属撑大 step 输出。
        const tallyOf = (list: CoverageEntry[], d: string) => list.filter((c) => c.disposition === d).length;
        const coverageBeforeRepair = coverage.length
          ? {
              total: coverage.length,
              headline: tallyOf(coverage, 'headline'),
              noteworthy: tallyOf(coverage, 'noteworthy'),
              dropped: tallyOf(coverage, 'dropped'),
            }
          : null;
        if (coverageRepair && coverage.length) {
          const repaired = this.repairCoverage(content, coverage, reports.reports);
          content = repaired.content;
          coverage = repaired.coverage;
        }

        // 目录锚点补齐。放在补录之后、卫生检查之前 = 作用于真正交付的那份正文。
        // 留痕：模型多久违反一次这个软约定，是"prompt 约定该不该继续靠自觉"的唯一信号。
        const titleMarkers = normalizeStoryTitleMarkers(content);
        content = titleMarkers.content;
        if (titleMarkers.fixed) {
          console.warn(`[Brief Generation] TOC_ANCHOR_REPAIR ${titleMarkers.fixed} 个故事标题缺 ** → 已补齐（缺则前端目录里该故事消失）`);
        }

        // 简报卫生检查（确定性传感器，零 LLM）。放在补录之后 = 检查真正交付给读者的那份正文。
        // 覆盖的是忠实度判官结构上抓不到的一类：专名拼写损坏、整句重复、元标签泄漏、缺主区标题。
        // 只报不改——误报由人一眼判掉，静默修正才是真风险。
        const hygiene = checkBriefHygiene(content, storiesMarkdown);
        if (hygiene.length) {
          console.warn(`[Brief Generation] BRIEF_HYGIENE ${hygiene.length} 条：` +
            hygiene.map((h) => `${h.kind}(${h.detail})`).join(' | '));
        }
        // 落 R2：console 的保留期有限且无法按 run 关联，而"卫生问题发生率随时间怎么变"
        // 正是 error-analysis 要问的。零命中也落，否则"没问题"与"没跑"无法区分。
        await recordSensor(this.env, this.traceContext, 'brief_hygiene', {
          findingCount: hygiene.length,
          findings: hygiene,
          briefChars: content.length,
          // console 保留期有限；"模型遵守 <u>**…**</u> 约定的比例随时间怎么变"要能回溯
          tocAnchorRepairs: titleMarkers.fixed,
        });

        // 生成标题（基于补录后的最终正文）
        const titlePrompt = getBriefTitlePrompt(content);
        const titleResponse = await this.callAI(titlePrompt, undefined, {
          temperature: 0,
          phase: 'brief_generation',
          callIndex: 1
        });

        const titleData = this.parseJSONFromResponse(titleResponse);
        // 解析失败/缺 title → 用通用标题兜底（轻微）。留痕以区分"模型没给标题"与"静默套通用名"。
        if (!titleData?.title) {
          console.warn('[Brief Generation] 标题解析失败或缺 title 字段 → 用通用标题 "Daily Intelligence Brief"（非模型生成）');
        }
        const title = titleData?.title || 'Daily Intelligence Brief';

        return { content, title, coverage, coverageBeforeRepair };
      };

      const result = await BriefErrorHandler.retryWithBackoff(aiOperation);

      // 构建符合契约的响应
      const finalBrief: FinalBrief = {
        metadata: {
          title: result.title,
          createdAt: new Date().toISOString(),
          model: PHASE_DEFAULTS.brief_generation.model, // 上报实际使用的模型，别写死

          tldr: '', // 将通过单独的TLDR端点生成
        },
        content: {
          sections: this.parseBriefSections(result.content),
          format: "MARKDOWN",
        },
        statistics: {
          totalArticlesProcessed: this.calculateTotalArticles(reports.reports),
          totalSourcesUsed: this.calculateTotalSources(reports.reports),
          articlesUsedInBrief: this.calculateUsedArticles(reports.reports),
          sourcesUsedInBrief: this.calculateUsedSources(reports.reports),
          clusteringParameters: {},
        },
      };

      console.log(`[Brief Generation] 简报生成完成，标题: "${result.title}"`);
      return { success: true, data: finalBrief, coverage: result.coverage, coverageBeforeRepair: result.coverageBeforeRepair };

    } catch (error) {
      console.error('[Brief Generation] 生成失败:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }

  /**
   * 生成TLDR摘要 - 生产环境版本，直接抛出错误
   */
  async generateTLDR(
    briefTitle: string, 
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldr: string }; error?: string }> {
    try {
      console.log(`[TLDR Generation] 为简报生成TLDR`);

      // AI生成（带重试策略，失败时直接抛出错误）
      const aiOperation = async () => {
        const tldrPrompt = getTldrGenerationPrompt(briefTitle, briefContent);
        
        const response = await this.callAI(tldrPrompt, undefined, {
          temperature: 0,
          phase: 'tldr_generation',
          callIndex: 0
        });
        
        // 清理TLDR内容
        let content = response.trim();
        if (content.startsWith('```') && content.endsWith('```')) {
          content = content.slice(3, -3).trim();
        }

        return content;
      };

      const tldrContent = await BriefErrorHandler.retryWithBackoff(aiOperation);

      console.log(`[TLDR Generation] TLDR生成完成`);
      return {
        success: true,
        data: { tldr: tldrContent }
      };

    } catch (error) {
      console.error('[TLDR Generation] 生成失败:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  private async callAI(
    prompt: string,
    systemPrompt?: string,
    options: { provider?: string; model?: string; temperature?: number; maxTokens?: number; phase?: LLMCallPhase; callIndex?: number } = {}
  ): Promise<string> {
    const messages = systemPrompt
      ? [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt }
        ]
      : [{ role: 'user' as const, content: prompt }];

    try {
      // 配置走 call-llm 单一入口按 phase 定默认；temperature ?? 语义保留（5 处显式 0 不被吞）。
      const result = await callLLM(
        this.aiGatewayService,
        this.env,
        this.traceContext,
        options.phase ?? 'brief_generation',
        messages,
        {
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          callIndex: options.callIndex ?? this.traceContext.callIndex,
          metadata: {
            requestId: `brief_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            timestamp: Date.now(),
          },
        }
      );
      
      // 检查结果是否存在
      if (!result) {
        throw new Error('AI Gateway request failed: No response received');
      }
      
      // 检查响应类型
      if (result.capability !== 'chat') {
        throw new Error(`Unexpected response type from chat service: ${result.capability || 'undefined'}`);
      }

      const content = (result as ChatResponse).choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI Gateway returned empty content');
      }

      return content;
    } catch (error) {
      // 改善错误消息，提供更多上下文
      const errorMessage = error instanceof Error ? error.message : 'Unknown AI Gateway error';
      throw new Error(`AI Gateway request failed: ${errorMessage}`);
    }
  }

  /**
   * RARR 式接地校验-改正：拿 storiesMarkdown（源报告 = gold-article oracle）逐条核对草稿，
   * 让模型只回 edit-list（verbatim span → 接地修正，空串=删除），由本地精确子串 apply。
   * 沿用 faithfulness-check.ts reviseBrief 的防漂移做法：只动命中的 flagged 片段，brief 其余逐字不变，
   * 不让 LLM 重吐整篇（避免好内容被漂改）。没精确命中的 edit 宁可跳过（防误伤），记入 skipped。
   * 校验要喂全部源，需要长上下文模型——现由 phase 默认提供（131k），不再在此覆盖 model。
   */
  private async verifyAndCorrect(draft: string, storiesMarkdown: string): Promise<string> {
    try {
      const raw = await this.callAI(getBriefVerificationPrompt(draft, storiesMarkdown), undefined, {
        temperature: 0,
        maxTokens: 4000,
        phase: 'brief_generation',
        callIndex: 2,
      });

      const parsed = this.parseJSONFromResponse(raw);
      // 区分「解析失败/无 edits 字段」与「模型判定 0 处要改」：两者都会走成 edits=[]（0 修正、发原草稿），
      // 但前者是"没校验成、草稿未被 RARR 核过"、后者是"核过且干净"。不区分则一次坏响应=静默发布未校验草稿。
      // 仍返回草稿不阻断（门作末端兜底，同 catch 分支），只让"未校验"可见——参照隔壁 reconcileCoverage 的做法。
      if (!parsed || !Array.isArray(parsed.edits)) {
        console.warn('[Brief Generation] 接地校验响应解析失败或无 edits 字段 → 未做任何修正、发布未经 RARR 核验的草稿（非"模型判定 0 处要改"）');
      }
      const edits: Array<{ brief_span?: string; replacement?: string; reason?: string }> =
        Array.isArray(parsed?.edits) ? parsed.edits : [];

      let revised = draft;
      let applied = 0;
      let skipped = 0;
      let deleted = false;
      for (const e of edits) {
        if (!e || typeof e.brief_span !== 'string' || e.brief_span.length === 0) continue;
        const replacement = typeof e.replacement === 'string' ? e.replacement : '';
        // 只认精确子串命中：命中才改，没命中宁可不动（避免误伤）。
        if (revised.includes(e.brief_span)) {
          revised = revised.replace(e.brief_span, replacement);
          applied++;
          if (replacement === '') deleted = true;
        } else {
          skipped++;
        }
      }
      if (deleted) revised = this.tidyAfterDelete(revised);

      console.log(`[Brief Generation] 接地校验-改正：edits ${edits.length}，applied ${applied}，skipped ${skipped}`);
      return revised;
    } catch (error) {
      // 校验失败不应拖垮整条生成：退回未修订草稿（门仍作末端兜底）。
      console.error('[Brief Generation] 接地校验-改正失败，退回草稿:', error);
      return draft;
    }
  }

  /**
   * 覆盖对账（洞3 方案B）：喂"候选 story 枚举清单 + 成品简报"，让模型逐条判去向。
   * 用枚举下标 [S1..Sn] 做稳定键（story 短标题取 executiveSummary 前缀），回来按 S{i} 映回 storyId。
   * best-effort：任何失败返回 []，绝不拖垮简报生成（observability 不反噬主流程，同 verifyAndCorrect）。
   */
  private async reconcileCoverage(content: string, reports: IntelligenceReport[]): Promise<CoverageEntry[]> {
    try {
      // 候选清单：[S{i}] <短标题>。短标题取 executiveSummary 前 ~160 字（含关键实体，足以在简报里识别）。
      const labels = reports.map((r) => (r.executiveSummary || '').replace(/\s+/g, ' ').trim().slice(0, 160));
      const storyList = labels.map((t, i) => `[S${i + 1}] ${t}`).join('\n');

      // 可靠性加固：区分「0 行解析」与「个别 story 漏判」。
      //   - 0 行 = 空/坏响应（间歇 API 抖动）= **call 失败，不是判决**。若直接走下面的兜底，会把整篇
      //     story 全判 dropped → 一次抖动 = 一整篇假合成漏报（无重试、无 RUNS 的单次调用尤其脆）。
      //   - ≥1 行 = 有效判决，此时个别未列出的 story 才兜底 dropped（正常语义）。
      // 故 0 行时重试；重试仍 0 行 → 返回 []（宁可这次不记覆盖账，也不记假漏报）。
      let rows: Array<{ story?: string; disposition?: string; section?: string | null; reason?: string }> = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const raw = await this.callAI(getBriefCoverageReconciliationPrompt(storyList, content), undefined, {
          // 需吃全篇简报，与 verify 同用长上下文模型——由 phase 默认给，不在此覆盖
          temperature: 0,
          maxTokens: 4000,
          phase: 'brief_generation',
          callIndex: 3,
        });
        const parsed = this.parseJSONFromResponse(raw);
        rows = Array.isArray(parsed?.coverage) ? parsed.coverage : [];
        if (rows.length > 0) break;
        console.warn(
          `[Brief Generation] 覆盖对账返回 0 行(空/坏响应)，第 ${attempt}/3 次重试（避免把 call 失败误记为整篇漏报）`
        );
      }
      if (rows.length === 0) {
        console.error('[Brief Generation] 覆盖对账重试后仍 0 行，返回空（不记假漏报账）');
        return [];
      }

      const valid = new Set(['headline', 'noteworthy', 'dropped']);
      const byIdx = new Map<number, CoverageEntry>();
      for (const row of rows) {
        const m = /S(\d+)/i.exec(row?.story || '');
        if (!m) continue;
        const idx = Number(m[1]) - 1;
        const report = reports[idx];
        if (!report) continue;
        const disposition = valid.has(row.disposition as string)
          ? (row.disposition as CoverageEntry['disposition'])
          : 'dropped';
        byIdx.set(idx, {
          storyId: report.storyId,
          storyLabel: labels[idx],
          disposition,
          section: typeof row.section === 'string' && row.section.trim() ? row.section.trim() : null,
          reason: typeof row.reason === 'string' ? row.reason : '',
          reasonInferred: true,
        });
      }
      // 模型漏判的 story 补一条 dropped（清单必须全覆盖，否则对账留洞失去意义）
      const coverage: CoverageEntry[] = reports.map((r, i) =>
        byIdx.get(i) ?? {
          storyId: r.storyId,
          storyLabel: labels[i],
          disposition: 'dropped' as const,
          section: null,
          reason: '对账未返回该 story（默认判 dropped）',
          reasonInferred: true,
        }
      );

      const n = (d: string) => coverage.filter((c) => c.disposition === d).length;
      console.log(
        `[Brief Generation] 覆盖对账：${coverage.length} story → headline ${n('headline')} / noteworthy ${n('noteworthy')} / dropped ${n('dropped')}`
      );
      return coverage;
    } catch (error) {
      console.error('[Brief Generation] 覆盖对账失败，返回空:', error);
      return [];
    }
  }

  /**
   * 两遍法第二遍：覆盖补录。对账判 dropped 的 story，从其 executiveSummary 逐字取首句
   * 补插 noteworthy 区——纯程序拼装(不经 LLM)，by-construction 不引入新编造，
   * 这正是选它而非"让模型重写"的原因（A/B 已证补覆盖会推高失真）。
   * 局限：文风比模型写的生硬；判官 precision=1.0(κ验)故误补极少，最坏=多一条冗余 bullet。
   */
  /**
   * 剥掉情报报告的内部措辞，再放进给人读的简报。
   *
   * 情报 prompt 要求每句都能读回「According to these articles, …」——那是治世界知识注入的
   * 手段(941c827，unsupported 56%→6%)，只对情报报告这一层有意义。补录逐字拷贝摘要首句，
   * 于是这个内部措辞被原样印到读者眼前：2026-08-12 的 report 55 里 noteworthy 四条**全部**
   * 以 "According to these articles," 开头，且是 Title Case，与简报全小写文风割裂。
   * 一个修复的产物成了另一个修复的输入——剥前缀是纯字符串处理，不改事实，by-construction 安全。
   */
  private stripReportVoice(sentence: string): string {
    const stripped = sentence.replace(/^\s*according to (?:these|the) articles,?\s*/i, '');
    if (stripped === sentence) return sentence;
    // 剥掉前缀后原句的首词是小写(它本在从句里)，与简报的小写文风一致，无需再动大小写。
    return stripped;
  }

  private repairCoverage(
    content: string,
    coverage: CoverageEntry[],
    reports: IntelligenceReport[]
  ): { content: string; coverage: CoverageEntry[] } {
    const dropped = coverage.filter((c) => c.disposition === 'dropped');
    if (!dropped.length) return { content, coverage };

    const byId = new Map(reports.map((r) => [r.storyId, r]));
    const patchedIds = new Set<string>();
    const bullets: string[] = [];
    for (const entry of dropped) {
      const report = byId.get(entry.storyId);
      const sentence = this.firstSentence(report?.executiveSummary || entry.storyLabel);
      if (!sentence) continue;
      bullets.push(`- ${this.stripReportVoice(sentence)}`);
      patchedIds.add(entry.storyId);
    }
    if (!bullets.length) return { content, coverage };
    const block = bullets.join('\n');

    // 有 noteworthy 区 → 追加到该区末尾（下一个 ## 头之前）；没有 → 建区，
    // 插在 positive developments 之前（若有），否则追加文末。
    let newContent: string;
    const noteHeader = /^##\s*noteworthy[^\n]*$/im.exec(content);
    if (noteHeader) {
      const sectionStart = noteHeader.index + noteHeader[0].length;
      const nextHeaderOffset = content.slice(sectionStart).search(/\n##\s/);
      const insertAt = nextHeaderOffset === -1 ? content.length : sectionStart + nextHeaderOffset;
      newContent =
        content.slice(0, insertAt).replace(/\s*$/, '') + '\n' + block + '\n' + content.slice(insertAt);
    } else {
      const section = `\n\n## noteworthy & under-reported\n${block}\n`;
      const posDev = content.search(/^##\s*positive developments/im);
      newContent =
        posDev === -1
          ? content.replace(/\s*$/, '') + section
          : content.slice(0, posDev).replace(/\s*$/, '') + section + '\n\n' + content.slice(posDev);
    }

    const updatedCoverage = coverage.map((c) =>
      patchedIds.has(c.storyId)
        ? {
            ...c,
            disposition: 'noteworthy' as const,
            section: 'noteworthy & under-reported',
            reason: `覆盖补录：对账判 dropped(${c.reason})，程序从该 story 摘要首句逐字补插`,
          }
        : c
    );
    console.log(
      `[Brief Generation] 覆盖补录：${bullets.length}/${dropped.length} 条 dropped story 补插 noteworthy（程序拼装，零新编造）`
    );
    return { content: newContent, coverage: updatedCoverage };
  }

  // 取一段文本的首句（逐字，不改写）。句末=[.!?]后跟空格且前面不是大写缩写字母（防 "U.S." 误切）；
  // 找不到句界或过长时按词边界截断加省略号。补录 bullet 用。
  private firstSentence(text: string, cap = 600): string {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = t.match(/^.{20,}?(?<![A-Z])[.!?](?=\s)/);
    const s = m ? m[0] : t;
    if (s.length <= cap) return s;
    // 超限时按**子句边界**断开并补句号，不再产生 "…" 残句。
    // 旧值 cap=320 太紧：2026-08-12 生产 report 54 的 WHO 那条首句约 330 字符，被切成
    //「…the Health Secretary's promotion of the disproven…」印在读者眼前。补录的全部价值
    // 在于"逐字拷贝、零编造"，截断成残句把这个价值直接抵消掉。
    const head = s.slice(0, cap);
    const lastClause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
    if (lastClause > cap * 0.5) return head.slice(0, lastClause) + '.';
    return head.replace(/\s+\S*$/, '') + '…'; // 无子句边界的超长句：保留旧行为作最后兜底
  }

  // 删除片段后清理遗留的双空格/悬空标点；只做最轻量收尾，不动其它字符。
  private tidyAfterDelete(s: string): string {
    return s
      .replace(/ {2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\n{3,}/g, '\n\n');
  }

  private parseJSONFromResponse(response: string): any {
    try {
      // 尝试提取 JSON 代码块
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      // 尝试直接解析
      return JSON.parse(response);
    } catch {
      return null;
    }
  }

  private convertReportsToMarkdown(reports: IntelligenceReport[]): string {
    // [story k/N] 序号标记：k 即重要性排名（backend 已按 importance+覆盖度降序喂入），
    // 供 prompt 的覆盖契约（每条 story 必须有去向）做"全部安置"自查；N 让模型能数总数。
    const total = reports.length;
    return reports.map((report, index) => {
      let markdown = index > 0 ? '\n---\n\n' : '';
      markdown += `# [story ${index + 1}/${total}] ${report.executiveSummary}\n\n`;

      // 时间线（带时间戳，事件顺序的唯一权威来源）——必须喂给生成器，否则它只能从散文里猜
      // 事件先后，常把"X 在 Y 之后/之前/数日内"写反、把早发生的事折进晚发生事件的因果链。
      const timeline = (report as any).timeline;
      if (Array.isArray(timeline) && timeline.length) {
        markdown += '## 时间线（事件按此时间戳顺序发生，叙述时序/因果必须与此一致，不得重排）\n';
        timeline.forEach((ev: any) => {
          const ts = ev.timestamp || ev.date || '';
          // date 为空（LLM 未给绝对日期）时不渲染 [] 空壳，避免生成器把空时间戳当权威；
          // 事件日期改由 description 文本承载（其中含"周四/9 July"等原文措辞）。
          markdown += ts ? `* [${ts}] ${ev.description}\n` : `* ${ev.description}\n`;
        });
        markdown += '\n';
      }

      if (report.factualBasis?.length) {
        markdown += '## 关键发展\n';
        report.factualBasis.forEach((fact) => {
          const line = renderListItem(fact);
          if (line) markdown += `* ${line}\n`;
        });
        markdown += '\n';
      }

      // 相关方（含各自角色/言行描述）——归属"谁说了什么/谁做了什么"的权威来源；
      // 缺它生成器会把引语或行动安到错误主体上。兼容 entities 与上游原始 keyEntities。
      const ents = (report.entities && report.entities.length) ? report.entities : (report as any).keyEntities;
      if (Array.isArray(ents) && ents.length) {
        markdown += '## 相关方（角色与言行须严格对应，勿张冠李戴）\n';
        ents.forEach((entity: any) => {
          const role = entity.role || entity.type || '';
          const desc = entity.description ? `：${entity.description}` : '';
          markdown += `* ${entity.name}${role ? ` (${role})` : ''}${desc}\n`;
        });
        markdown += '\n';
      }
      
      if (report.informationGaps?.length) {
        markdown += '## 影响评估\n';
        report.informationGaps.forEach((gap) => {
          const line = renderListItem(gap);
          if (line) markdown += `* ${line}\n`;
        });
        markdown += '\n';
      }
      
      if (report.significance) {
        markdown += `## 前景展望\n${report.significance.reasoning}\n\n`;
      }
      
      return markdown;
    }).join('');
  }

  private formatPreviousContext(context: PreviousBriefContext): string {
    return `\n## 前日简报上下文 (${context.date})\n${context.summary}\n主要话题: ${context.coveredTopics.join(', ')}\n`;
  }

  private parseBriefSections(briefContent: string): Array<{
    sectionType: "WHAT_MATTERS_NOW" | "FRANCE_FOCUS" | "GLOBAL_LANDSCAPE" | "CHINA_MONITOR" | "TECH_SCIENCE" | "NOTEWORTHY" | "POSITIVE_DEVELOPMENTS";
    title: string;
    content: string;
    priority: number;
  }> {
    // 将简报内容作为单一section返回
    return [{
      sectionType: "WHAT_MATTERS_NOW" as const,
      title: "What Matters Now", 
      content: briefContent,
      priority: 1,
    }];
  }

  private calculateTotalArticles(reports: IntelligenceReport[]): number {
    return reports.reduce((total, report) => {
      return total + report.sources.reduce((sourceTotal, source) => sourceTotal + source.articleIds.length, 0);
    }, 0);
  }

  private calculateTotalSources(reports: IntelligenceReport[]): number {
    const uniqueSources = new Set<string>();
    reports.forEach(report => {
      report.sources.forEach(source => uniqueSources.add(source.sourceName));
    });
    return uniqueSources.size;
  }

  private calculateUsedArticles(reports: IntelligenceReport[]): number {
    // 对于完整的报告，假设所有文章都被使用
    return reports
      .filter(report => report.status === 'COMPLETE')
      .reduce((total, report) => {
        return total + report.sources.reduce((sourceTotal, source) => sourceTotal + source.articleIds.length, 0);
      }, 0);
  }

  private calculateUsedSources(reports: IntelligenceReport[]): number {
    const uniqueSources = new Set<string>();
    reports
      .filter(report => report.status === 'COMPLETE')
      .forEach(report => {
        report.sources.forEach(source => uniqueSources.add(source.sourceName));
      });
    return uniqueSources.size;
  }
} 