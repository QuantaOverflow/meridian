/**
 * 简报生成服务
 * 基于 intelligence-pipeline.test.ts 的简报生成契约
 * 生产环境错误处理，直接抛出错误而不使用fallback
 */

import { z } from 'zod';
import { AIGatewayService } from './ai-gateway';
import { loggedChat, TraceContext, LLMCallPhase } from './llm-call-logger';
import {
  getBriefGenerationSystemPrompt,
  getBriefGenerationPrompt,
  getBriefTitlePrompt,
  getBriefVerificationPrompt,
  getBriefCoverageReconciliationPrompt
} from '../prompts/briefGeneration';
import { getTldrGenerationPrompt } from '../prompts/tldrGeneration';
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
  ): Promise<{ success: boolean; data?: FinalBrief; error?: string; coverage?: CoverageEntry[] }> {
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
        
        // 多故事合成：输入是所有情报报告拼接的 Markdown + 前日简报上下文，
        // 单次合成长度容易超过 qwen-plus 的 131k 上下文，使用长文本模型 qwen-long
        const briefResponse = await this.callAI(briefPrompt, systemPrompt, {
          model: 'qwen-long',
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
        if (coverageRepair && coverage.length) {
          const repaired = this.repairCoverage(content, coverage, reports.reports);
          content = repaired.content;
          coverage = repaired.coverage;
        }

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

        return { content, title, coverage };
      };

      const result = await BriefErrorHandler.retryWithBackoff(aiOperation);

      // 构建符合契约的响应
      const finalBrief: FinalBrief = {
        metadata: {
          title: result.title,
          createdAt: new Date().toISOString(),
          model: 'qwen-long',
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
      return { success: true, data: finalBrief, coverage: result.coverage };

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

    const chatRequest = {
      capability: 'chat' as const,
      messages,
      provider: options.provider || 'dashscope',
      model: options.model || 'qwen-plus',
      // ?? 而非 ||：本文件有 5 个调用点显式传 temperature: 0（标题/覆盖对账/RARR 校验等
      // 需确定性的场景），|| 会把 0 吞成 0.1 → 这些"校验/对账"判决全跑在非确定性上。
      // 与 /meridian/chat 的同款 bug 同源（那处已修，此处漏网）。
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens || 8000,
      metadata: {
        requestId: `brief_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        timestamp: Date.now(),
      }
    };

    try {
      const phaseTrace: TraceContext = {
        ...this.traceContext,
        callIndex: options.callIndex ?? this.traceContext.callIndex,
      };
      const result = await loggedChat(
        this.aiGatewayService,
        this.env,
        phaseTrace,
        options.phase ?? 'brief_generation',
        chatRequest
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
   * 用 qwen-long：校验要喂全部源，qwen-max 30720 token 装不下多故事源（同 per-story 拆源的初衷）。
   */
  private async verifyAndCorrect(draft: string, storiesMarkdown: string): Promise<string> {
    try {
      const raw = await this.callAI(getBriefVerificationPrompt(draft, storiesMarkdown), undefined, {
        model: 'qwen-long',
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
          model: 'qwen-long', // 需吃全篇简报，与 verify 同用长文本模型
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
      bullets.push(`- ${sentence}`);
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
  private firstSentence(text: string, cap = 320): string {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = t.match(/^.{20,}?(?<![A-Z])[.!?](?=\s)/);
    const s = m ? m[0] : t;
    return s.length <= cap ? s : s.slice(0, cap).replace(/\s+\S*$/, '') + '…';
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
          markdown += `* ${fact}\n`;
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
          markdown += `* ${gap}\n`;
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