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
import {
  getBriefSkeletonPlanPrompt,
  getBlockTitlePrompt,
  getBriefBlockPrompt,
  type BlockSectionContext
} from '../prompts/briefSkeleton';
import { applyGroundedEdits, tallyGuards } from '../utils/grounded-edits';
import { checkBlockConsistency, type ConsistencyFinding } from '../utils/block-consistency';
import {
  ISOLATED_HEADING,
  CALL_INDEX,
  shapeSkeleton,
  parseLooseJSON,
  toProse,
  cleanTitle,
  mapLimit,
  renderBriefMarkdown,
  type SkeletonRef,
  type BriefSkeleton,
  type BriefBlockResult
} from './brief-skeleton';

// 供 index.ts 与既有调用方从本模块取（b′ 的结构类型实现在 brief-skeleton.ts）
export type { SkeletonRef, SkeletonSection, BriefSkeleton, BriefBlockResult } from './brief-skeleton';
export { shapeSkeleton, renderBriefMarkdown, toProse, parseLooseJSON } from './brief-skeleton';
import { getTldrGenerationPrompt, getTldrProsePrompt } from '../prompts/tldrGeneration';
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

/**
 * 把上游 intel 端点产出的原始分析（R2 里那份，或 backend 回灌的 analysisData）归一成
 * IntelligenceReport。
 *
 * 抽成函数是因为 b′ 的三个端点直接从 R2 读报告，必须跟 `/meridian/generate-final-brief`
 * 走**同一套**归一逻辑——它承载了几个真实 bug 的修复：keyEntities→entities 的接线
 * （漏接会让相关方在简报输入里整段丢失，归属类错误由此而来）、significance 的两种形状、
 * legacy 字段名兜底。两份实现迟早会漂，而漂的表现是"简报里的人名开始张冠李戴"。
 *
 * 内容与原先内联在 index.ts 里的那段逐字相同，只是换了位置。
 */
export function normalizeAnalysisToReport(analysis: any): IntelligenceReport {
  return {
    storyId: analysis.storyId || analysis.id || `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    status: analysis.status || ("COMPLETE" as const),
    executiveSummary: analysis.executiveSummary || analysis.overview || analysis.summary || '发展概述',
    storyStatus: analysis.storyStatus || ("DEVELOPING" as const),
    timeline: Array.isArray(analysis.timeline) ? analysis.timeline : [],
    significance: (analysis.significance && (analysis.significance.level || analysis.significance.reasoning))
      ? {
          level: analysis.significance.level || ("MODERATE" as const),
          reasoning: analysis.significance.reasoning || analysis.outlook || '需要持续关注的发展',
        }
      : {
          level: "MODERATE" as const,
          reasoning: analysis.outlook || '需要持续关注的发展',
        },
    entities: Array.isArray(analysis.entities) && analysis.entities.length
      ? analysis.entities.map((e: any) => ({
          name: e.name || 'Unknown Entity',
          type: e.type || 'Organization',
          role: e.role || 'Stakeholder',
          positions: Array.isArray(e.positions) ? e.positions : [],
        }))
      // 上游 intel 报告用 keyEntities（name/type/description），不是 entities。
      // 之前这里漏接 → 相关方在简报输入里整段丢失，归属类错误（引语/行动安错主体）由此而来。
      : Array.isArray(analysis.keyEntities) && analysis.keyEntities.length
      ? analysis.keyEntities.map((e: any) => ({
          name: e.name || 'Unknown Entity',
          type: e.type || 'Organization',
          role: e.description || e.role || 'Stakeholder',
          positions: [],
        }))
      : (analysis.stakeholders || []).map((name: string) => ({
          name,
          type: 'Organization',
          role: 'Stakeholder',
          positions: [],
        })),
    sources: (Array.isArray(analysis.sources) && analysis.sources.length)
      ? analysis.sources
      : [{
          sourceName: 'Multiple Sources',
          articleIds: [1, 2, 3], // 占位符
          reliabilityLevel: "HIGH" as const,
          bias: 'Minimal',
        }],
    factualBasis: analysis.factualBasis || analysis.key_developments || [],
    informationGaps: analysis.informationGaps || analysis.implications || [],
    contradictions: Array.isArray(analysis.contradictions) ? analysis.contradictions : [],
  };
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

  /**
   * 生成面向读者的散文摘要（reports.tldr_prose）。
   *
   * 与 generateTLDR 并列但用途相反：那个产出给次日模型读的机器格式，这个产出给人读的
   * 2-3 句导语。temperature 取 0 与 generateTLDR 一致——摘要要可复现，不需要创造性。
   */
  async generateProseTldr(
    briefTitle: string,
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldrProse: string }; error?: string }> {
    try {
      console.log(`[TLDR Prose] 为简报生成散文摘要`);

      const aiOperation = async () => {
        const prompt = getTldrProsePrompt(briefTitle, briefContent);

        const response = await this.callAI(prompt, undefined, {
          temperature: 0,
          phase: 'tldr_prose_generation',
          callIndex: 0
        });

        let content = response.trim();
        if (content.startsWith('```') && content.endsWith('```')) {
          content = content.slice(3, -3).trim();
        }
        // 模型偶尔会把整段包在引号里
        if (content.length > 1 && content.startsWith('"') && content.endsWith('"')) {
          content = content.slice(1, -1).trim();
        }

        // 空响应必须当失败抛出去，否则会静默写一条空摘要进库，
        // 读者端只看到标题下少了一段，没有任何报错可查。
        if (content === '') {
          throw new Error('模型返回空摘要');
        }

        return content;
      };

      const prose = await BriefErrorHandler.retryWithBackoff(aiOperation);

      console.log(`[TLDR Prose] 散文摘要生成完成 (${prose.length} 字符)`);
      return { success: true, data: { tldrProse: prose } };

    } catch (error) {
      console.error('[TLDR Prose] 生成失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // ============================================================================
  // b′ 方案：因果主线章节 + 独立事态，分段写
  //
  // 与上面 generateBrief 的整篇合成是两条并行路径。分三步、由 backend workflow 编排：
  //   planBriefSkeleton   1 次调用   规划章节与块标题
  //   writeBriefBlock     N 次调用   一份报告一个块（backend 侧 fan-out 成 N 个 step）
  //   assembleBrief       1 次调用   拼装 + 起标题 + 传感器，结构部分零 LLM
  //
  // ⚠️ fan-out 必须留在 backend，不能挪进本 service 内部并发跑：CF 侧约 2% 的 invocation
  // 会被平台 canceled，N 次调用挤在一个 step 里就是 16efc42 刚修完那个 bug 的翻版。
  // ============================================================================

  /**
   * 步骤 1：规划骨架。只喂 N 条 executiveSummary（不喂全文），产出章节结构 + 每块标题。
   * 覆盖由 shapeSkeleton 程序化保证：1..N 恰好各出现一次，规划漏掉的索引自动进独立事态。
   */
  async planBriefSkeleton(
    reports: IntelligenceReport[]
  ): Promise<{ success: boolean; data?: BriefSkeleton; error?: string }> {
    try {
      if (!reports.length) return { success: false, error: 'No intelligence reports provided' };

      const summaries = reports.map((r) => r.executiveSummary || '');
      const raw = await this.callAI(getBriefSkeletonPlanPrompt(summaries), undefined, {
        temperature: 0,
        maxTokens: 4000,
        phase: 'brief_generation',
        callIndex: CALL_INDEX.plan,
      });

      const plan = parseLooseJSON(raw);
      if (!Array.isArray(plan?.sections) || plan.sections.length === 0) {
        // 规划失败必须硬失败：静默兜底成"25 个块全进独立事态"会产出一份没有任何因果主线的
        // 简报，而它在指标上（覆盖率 25/25、块数 25）看起来完全正常——正是本项目反复栽的
        // 「失败静默降级成安全默认值」。让 step 失败去重试。
        return { success: false, error: '骨架规划解析失败：响应里没有可用的 sections 数组' };
      }

      const skeleton = shapeSkeleton(plan, reports.length);

      // 规划没给标题的（含被程序补回的索引）单独补一次，20 token 的小调用。
      // 比重跑整个规划便宜，也比拿 "story 7" 这种占位标题交付强。
      const untitled = [...skeleton.main.flatMap((s) => s.reports), ...skeleton.isolated].filter((r) => !r.title);
      if (untitled.length) {
        console.warn(`[Brief Skeleton] ${untitled.length} 个块规划未给标题 → 单独补标题: ${untitled.map((r) => r.i).join(',')}`);
        await mapLimit(untitled, 4, async (ref) => {
          try {
            const t = await this.callAI(getBlockTitlePrompt(reports[ref.i - 1].executiveSummary || ''), undefined, {
              temperature: 0,
              maxTokens: 60,
              phase: 'brief_generation',
              callIndex: CALL_INDEX.titleFillBase + ref.i,
            });
            ref.title = cleanTitle(t);
          } catch (e) {
            console.warn(`[Brief Skeleton] 补标题失败 (story ${ref.i}):`, e);
          }
          // 补标题调用失败/回空 → 用 executiveSummary 首句截断兜底。这里的兜底是安全的：
          // 标题缺失不会静默（正文照写），而没有标题的块在拼装时无法渲染成 <u> 条目。
          if (!ref.title) ref.title = this.firstSentence(reports[ref.i - 1].executiveSummary || `story ${ref.i}`, 80).toLowerCase();
        });
      }

      // 覆盖是 by construction 的，但断言必须直接查产出、不能同义反复：
      // 「blocks.size + missing.length === N」恒真（missing 是补集），0/25 全失败也不报警。
      const all = [...skeleton.main.flatMap((s) => s.reports), ...skeleton.isolated].map((r) => r.i);
      if (new Set(all).size !== reports.length) {
        return { success: false, error: `骨架覆盖断言失败：分节后索引不是恰好覆盖 1..${reports.length}（得到 ${new Set(all).size} 个）` };
      }
      const titles = [...skeleton.main.flatMap((s) => s.reports), ...skeleton.isolated].map((r) => r.title.toLowerCase());
      const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
      if (dupes.length) {
        // 只报不改：重复标题会让读者端目录出现两条一模一样的条目，但自动改写标题
        // 比暴露问题更糟。两轮原型实测 0 次。
        console.warn(`[Brief Skeleton] BLOCK_TITLE_DUPLICATE ${dupes.length} 条重复标题: ${[...new Set(dupes)].join(' | ')}`);
      }

      console.log(
        `[Brief Skeleton] 规划完成：主线 ${skeleton.main.length} 节 / 独立事态 ${skeleton.isolated.length} 条` +
          (skeleton.repaired.length ? `（规划漏掉 ${skeleton.repaired.join(',')}，已补进独立事态）` : '')
      );
      return { success: true, data: skeleton };
    } catch (error) {
      console.error('[Brief Skeleton] 规划失败:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
    }
  }

  /**
   * 步骤 2：写一个块。**写作只看自己那份报告**（防串源），**校验看全量源**（防误删）。
   *
   * oracle 宽窄三档实测（第 75 期，删除/真误删/专名嫁接）：
   *   own      44 / 11 / 0      跨报告的正确内容被当成无据删掉
   *   full     17-18 / 3-2 / 1  两轮稳定，嫁接那 1 条被 G1 守卫拦住  ← 采用
   *   section  46 / 15 / 2      远在波动范围外
   * 注：section 档曾用离线反事实推算预测能救回 11/11 误删，真跑出来是 15 条误删——
   * **反事实推算不能当结论**，别再据此改回去。
   *
   * @param index 0 基，这个块对应 reports 里的第几份
   */
  async writeBriefBlock(
    reports: IntelligenceReport[],
    index: number,
    title: string,
    section?: BlockSectionContext,
    options?: { selfCorrect?: boolean }
  ): Promise<{ success: boolean; data?: BriefBlockResult; error?: string }> {
    try {
      const report = reports[index];
      if (!report) return { success: false, error: `index ${index} 超出报告范围（共 ${reports.length} 份）` };
      const selfCorrect = options?.selfCorrect !== false;

      const storyMarkdown = this.convertReportsToMarkdown([report], index, reports.length);
      // 刻意不带 system prompt。getBriefGenerationSystemPrompt() 讲的是整篇尺度的规矩
      // （"创建 3-6 个章节"、"每条 story 必须有去向"、"没内容就整节省略"），喂给只写一个块的
      // 调用会反过来诱发它去写章节标题——正是 b′ 要消灭的那个失败模式。文风与接地规则
      // 都已经在 block prompt 里了。原型实测的 100% 落地率也是不带 system prompt 跑出来的。
      const raw = await this.callAI(getBriefBlockPrompt(storyMarkdown, title, section), undefined, {
        temperature: 0.7,
        maxTokens: 2500,
        phase: 'brief_generation',
        callIndex: CALL_INDEX.blockWriteBase + index,
      });

      const prose = toProse(raw);
      if (!prose) {
        // 回了 200 但剥完标记没剩正文 = 这个块作废。硬失败让 step 重试，
        // 静默返回空串会让拼装步少一个块而覆盖率读数照样好看。
        return { success: false, error: `块正文为空（原始 ${raw.length} 字符）` };
      }

      if (!selfCorrect) {
        return { success: true, data: { index, title, text: prose, verified: false, edits: 0, applied: 0, skipped: 0, blocked: { noop: 0, bad_delete: 0, graft: 0, bloat: 0 } } };
      }

      // RARR 接地校验-改正。oracle = 全量 25 份报告；守卫也查全量源。
      // 失败不阻断（同既有 verifyAndCorrect 的 fail-open），但 verified 标出来，
      // 免得"没校验成"与"校验过且干净"在数据里长得一样。
      const oracle = this.convertReportsToMarkdown(reports);
      try {
        const verifyRaw = await this.callAI(getBriefVerificationPrompt(prose, oracle), undefined, {
          temperature: 0,
          maxTokens: 4000,
          phase: 'brief_generation',
          callIndex: CALL_INDEX.blockVerifyBase + index,
        });
        const parsed = parseLooseJSON(verifyRaw);
        if (!parsed || !Array.isArray(parsed.edits)) {
          console.warn(`[Brief Block ${index}] 接地校验响应解析失败或无 edits 字段 → 发未经 RARR 核验的块（非"判定 0 处要改"）`);
          return { success: true, data: { index, title, text: prose, verified: false, edits: 0, applied: 0, skipped: 0, blocked: { noop: 0, bad_delete: 0, graft: 0, bloat: 0 } } };
        }
        const result = applyGroundedEdits(prose, parsed.edits, oracle);
        const tidied = result.deleted ? this.tidyAfterDelete(result.text) : { text: result.text, repairs: 0 };
        const text = tidied.text;
        if (tidied.repairs) console.warn(`[Brief Block ${index}] PUNCT_REPAIR ${tidied.repairs} 处删除残渣（RARR 删完留下的标点断裂）`);
        const blocked = tallyGuards(result.blocked);
        console.log(
          `[Brief Block ${index}] 接地校验：edits ${parsed.edits.length}，applied ${result.applied}，skipped ${result.skipped}，` +
            `守卫拦下 G1嫁接 ${blocked.graft} / G2误删 ${blocked.bad_delete} / G3空转 ${blocked.noop} / G4膨胀 ${blocked.bloat}` +
            (result.recased ? `，${result.recased} 条替换压回全小写文风` : '')
        );
        return {
          success: true,
          data: {
            index, title, text, verified: true,
            edits: parsed.edits.length, applied: result.applied, skipped: result.skipped, blocked,
            blockedDetail: result.blocked,
          },
        };
      } catch (verifyError) {
        console.error(`[Brief Block ${index}] 接地校验失败，退回未校验草稿:`, verifyError);
        return { success: true, data: { index, title, text: prose, verified: false, edits: 0, applied: 0, skipped: 0, blocked: { noop: 0, bad_delete: 0, graft: 0, bloat: 0 } } };
      }
    } catch (error) {
      console.error(`[Brief Block ${index}] 写作失败:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
    }
  }

  /**
   * 步骤 3：拼装。`<u>**title**</u>` 包装、章节归属、章节内顺序全由代码做，
   * 唯一的 LLM 调用是起整篇标题。
   *
   * 覆盖对账在这里也是**程序化**的：b′ 每份报告恰好一个块，成功的判 headline、
   * 调用失败没交回块的判 dropped。不再需要 qwen 判官事后猜去向，也不需要两遍法补录
   * （补录治的是"整篇合成静默丢 story"，b′ 从结构上没有这个自由度）。
   */
  async assembleBrief(
    reports: IntelligenceReport[],
    skeleton: BriefSkeleton,
    blocks: Array<{ index: number; title: string; text: string }>
  ): Promise<{
    success: boolean;
    data?: { title: string; content: string; coverage: CoverageEntry[]; model: string };
    error?: string;
    hygiene?: unknown[];
    consistency?: ConsistencyFinding[];
  }> {
    try {
      const byIndex = new Map<number, { title: string; text: string }>();
      for (const b of blocks) {
        if (typeof b?.index !== 'number' || !b.text?.trim()) continue;
        byIndex.set(b.index, { title: (b.title || '').trim(), text: b.text.trim() });
      }
      if (byIndex.size === 0) return { success: false, error: '没有任何可用的简报块' };

      const { content: rendered, sectionCount } = renderBriefMarkdown(skeleton, byIndex);
      let content = rendered;

      // 目录锚点补齐。上面本来就按 <u>**…**</u> 渲染，这里恒为 0——留着是因为
      // 块标题万一自带 ** 会走进 normalize 的豁免分支，出现即说明拼装逻辑漂了。
      const titleMarkers = normalizeStoryTitleMarkers(content);
      content = titleMarkers.content;
      if (titleMarkers.fixed) {
        console.warn(`[Brief Assemble] TOC_ANCHOR_REPAIR ${titleMarkers.fixed} 个块标题缺 ** → 已补齐（拼装逻辑异常，正常应为 0）`);
      }

      // 覆盖对账：程序化，零 LLM。成功交回块的 = headline，没交回的 = dropped。
      const storiesMarkdown = this.convertReportsToMarkdown(reports);
      const sectionOf = new Map<number, string>();
      for (const s of skeleton.main) for (const r of s.reports) sectionOf.set(r.i, s.heading.toLowerCase());
      for (const r of skeleton.isolated) sectionOf.set(r.i, ISOLATED_HEADING);
      const coverage: CoverageEntry[] = reports.map((r, i) => {
        const covered = byIndex.has(i);
        return {
          storyId: r.storyId,
          storyLabel: (r.executiveSummary || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          disposition: covered ? ('headline' as const) : ('dropped' as const),
          section: covered ? sectionOf.get(i + 1) ?? null : null,
          // 与整篇合成路径不同：这里的理由不是事后推断出来的编辑判断，而是**确定已知**的
          // 调用结果。字段名沿用 reasonInferred 是为了不改 CoverageEntry 契约。
          reason: covered ? 'b′ 每份报告一个块' : '块写作调用失败，未交回正文',
          reasonInferred: true as const,
        };
      });
      const dropped = coverage.filter((c) => c.disposition === 'dropped');
      if (dropped.length) {
        console.warn(`[Brief Assemble] ${dropped.length}/${reports.length} 份报告没有块（块 step 失败）: ${dropped.map((c) => c.storyId).join(', ')}`);
      }

      // 传感器（确定性，只报不改）
      // requireCatchAll:false —— b′ 没有 "## noteworthy & under-reported" 区：每份报告
      // 都拿到完整分析块，一句话降级条目这个形态在 b′ 里不存在。不关掉的话这条会 100% 命中，
      // 把整个卫生传感器淹掉。
      const hygiene = checkBriefHygiene(content, storiesMarkdown, { requireCatchAll: false });
      if (hygiene.length) {
        console.warn(`[Brief Assemble] BRIEF_HYGIENE ${hygiene.length} 条：` + hygiene.map((h) => `${h.kind}(${h.detail})`).join(' | '));
      }
      const consistency = checkBlockConsistency(content);
      if (consistency.length) {
        console.warn(
          `[Brief Assemble] BLOCK_CONSISTENCY ${consistency.length} 处疑似跨块数值冲突：` +
            consistency.map((c) => `${c.kind} ${c.a.raw} vs ${c.b.raw}`).join(' | ')
        );
      }
      await recordSensor(this.env, this.traceContext, 'brief_hygiene', {
        findingCount: hygiene.length,
        findings: hygiene,
        briefChars: content.length,
        tocAnchorRepairs: titleMarkers.fixed,
        path: 'bprime',
      });
      await recordSensor(this.env, this.traceContext, 'block_consistency', {
        findingCount: consistency.length,
        findings: consistency,
        blockCount: byIndex.size,
      });

      // 起标题喂的是**骨架摘要**而不是 34K 字的全文。2026-08-29 dry-run 实证：喂全文时
      // 模型会把 15 个板块逐一列进标题，产出 247 字符、14 个逗号短语的怪物
      // （"us israel iran stalemate, nepal tibet glacial collapse, … uefa fifa"）。
      // 老路径没这个病纯粹因为整篇合成只产出 1-4 个板块，题材少到列不长。
      // 主线章节的标题本来就是"按当天实际发生的事命名"的，正是 prompt 要的 major topics；
      // 主线不足时才用独立事态的块标题补位。
      const titleTopics = [
        ...skeleton.main.map((sec) => sec.heading.toLowerCase()),
        ...skeleton.isolated.map((r) => (byIndex.get(r.i - 1)?.title || r.title).toLowerCase()),
      ].filter(Boolean);
      const titleDigest = titleTopics
        .slice(0, Math.max(5, skeleton.main.length))
        .map((t) => `- ${t}`)
        .join('\n');
      const titleResponse = await this.callAI(getBriefTitlePrompt(titleDigest), undefined, {
        temperature: 0,
        phase: 'brief_generation',
        callIndex: CALL_INDEX.assembleTitle,
      });
      const titleData = this.parseJSONFromResponse(titleResponse);
      if (!titleData?.title) {
        console.warn('[Brief Assemble] 标题解析失败或缺 title 字段 → 用通用标题 "Daily Intelligence Brief"（非模型生成）');
      }
      const title = titleData?.title || 'Daily Intelligence Brief';
      // 只报不改：截断会静默产出半截标题，比一个过长标题更难发现。
      if (title.length > 120) {
        console.warn(
          `[Brief Assemble] BRIEF_TITLE_TOO_LONG ${title.length} 字符（喂进去的题材 ${titleTopics.length} 条，正常应产出 3-6 个短语）: ${title.slice(0, 160)}`
        );
      }

      console.log(`[Brief Assemble] 拼装完成：${sectionCount} 节 / ${byIndex.size} 块 / ${content.length} 字符，标题 "${title}"`);
      return { success: true, data: { title, content, coverage, model: PHASE_DEFAULTS.brief_generation.model }, hygiene, consistency };
    } catch (error) {
      console.error('[Brief Assemble] 拼装失败:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
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

      // 四条确定性守卫（G1 专名嫁接 / G2 误删 / G3 空转 / G4 膨胀）与 b′ 分块路径共用
      // 同一个应用器。守卫是严格保护性的——每条拦的都是实测有害或无用的一类 edit，
      // 尤其 G1「把源里对的专名改成另一份报告里的名字」是把对的改成错的，比漏改严重。
      const result = applyGroundedEdits(draft, edits, storiesMarkdown);
      const tidied = result.deleted ? this.tidyAfterDelete(result.text) : { text: result.text, repairs: 0 };
      const revised = tidied.text;
      if (tidied.repairs) console.warn(`[Brief Generation] PUNCT_REPAIR ${tidied.repairs} 处删除残渣（RARR 删完留下的标点断裂）`);
      const blocked = tallyGuards(result.blocked);

      console.log(
        `[Brief Generation] 接地校验-改正：edits ${edits.length}，applied ${result.applied}，skipped ${result.skipped}，` +
          `守卫拦下 G1嫁接 ${blocked.graft} / G2误删 ${blocked.bad_delete} / G3空转 ${blocked.noop} / G4膨胀 ${blocked.bloat}` +
          (result.recased ? `，${result.recased} 条替换压回全小写文风` : '')
      );
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
  /**
   * 收拾删除留下的残渣。返回值带修补计数——修好不留痕的话，"RARR 删完有多脏"这个信号
   * 就在数据里消失了（同 TOC_ANCHOR_REPAIR 的做法）。
   */
  private tidyAfterDelete(s: string): { text: string; repairs: number } {
    let repairs = 0;
    const text = s
      .replace(/ {2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      // 标点挨着标点：删掉一个从句后剩下 "shipping needs,." 这种。原实现只管"标点前的
      // 空格"，管不到这类——2026-08-29 dry-run 在成品里实测到 2 处，读者直接看得见。
      // 只收敛"逗号/分号/冒号 紧跟 句号"这一种确定形态，句中悬空的 "and," 之类
      // 机械改不安全（改法取决于删掉的是什么），留给卫生传感器报。
      .replace(/([,;:])\s*\./g, () => { repairs++; return '.'; })
      .replace(/,{2,}/g, () => { repairs++; return ','; })
      // 双句号：删掉一句后与前句句末的点撞在一起（"…respective shares of the strait's
      // waters and revenues.. meanwhile…"）。两条路径都会出，@15 实测各 2 处。
      // 三点省略号由前后 lookaround 排除，不误伤。
      .replace(/(?<!\.)\.\.(?!\.)/g, () => { repairs++; return '.'; })
      .replace(/\n{3,}/g, '\n\n');
    return { text, repairs };
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

  /**
   * @param startIndex 这批报告在**全量**报告里的起始下标（0 基）。b′ 逐块写作时只传一份
   *                   报告，但序号必须仍是它在全量里的真实排名，否则块内看到的是 [story 1/1]
   *                   而校验用的全量 oracle 里同一份是 [story 7/25]，两边对不上。
   * @param totalCount 全量报告总数。缺省时按本批数量算（整篇合成路径的既有行为）。
   */
  private convertReportsToMarkdown(reports: IntelligenceReport[], startIndex = 0, totalCount?: number): string {
    // [story k/N] 序号标记：k 即重要性排名（backend 已按 importance+覆盖度降序喂入），
    // 供 prompt 的覆盖契约（每条 story 必须有去向）做"全部安置"自查；N 让模型能数总数。
    const total = totalCount ?? reports.length;
    return reports.map((report, i) => {
      const index = startIndex + i;
      let markdown = i > 0 ? '\n---\n\n' : '';
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