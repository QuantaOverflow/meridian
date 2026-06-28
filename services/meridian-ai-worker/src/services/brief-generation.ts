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
  getBriefVerificationPrompt
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
    options?: { selfCorrect?: boolean }
  ): Promise<{ success: boolean; data?: FinalBrief; error?: string }> {
    // RARR 式接地校验-改正默认开启（选项2）；eval baseline 臂可传 selfCorrect:false 关掉做对照。
    const selfCorrect = options?.selfCorrect !== false;
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

        // 生成标题
        const titlePrompt = getBriefTitlePrompt(content);
        const titleResponse = await this.callAI(titlePrompt, undefined, {
          temperature: 0,
          phase: 'brief_generation',
          callIndex: 1
        });
        
        const titleData = this.parseJSONFromResponse(titleResponse);
        const title = titleData?.title || 'Daily Intelligence Brief';

        return { content, title };
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
      return { success: true, data: finalBrief };

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
      temperature: options.temperature || 0.1,
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
    return reports.map((report, index) => {
      let markdown = index > 0 ? '\n---\n\n' : '';
      markdown += `# ${report.executiveSummary}\n\n`;

      // 时间线（带时间戳，事件顺序的唯一权威来源）——必须喂给生成器，否则它只能从散文里猜
      // 事件先后，常把"X 在 Y 之后/之前/数日内"写反、把早发生的事折进晚发生事件的因果链。
      const timeline = (report as any).timeline;
      if (Array.isArray(timeline) && timeline.length) {
        markdown += '## 时间线（事件按此时间戳顺序发生，叙述时序/因果必须与此一致，不得重排）\n';
        timeline.forEach((ev: any) => {
          const ts = ev.timestamp || ev.date || '';
          markdown += `* [${ts}] ${ev.description}\n`;
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