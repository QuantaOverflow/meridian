import { AIGatewayService } from './ai-gateway';
import { TraceContext } from './llm-call-logger';
import { callLLM, PHASE_DEFAULTS } from './call-llm';
import { recordSensor } from './sensor-log';
import { getIntelligenceAnalysisPrompt, getIntelReportVerificationPrompt } from '../prompts/intelligenceAnalysis';
import { CloudflareEnv, ChatResponse } from '../types';
import { 
  ArticleDataset, 
  ValidatedStories, 
  IntelligenceReports, 
  IntelligenceReport, 
  Story, 
  Article,
  LegacyIntelligenceAnalysisRequestSchema
} from '../types/intelligence-types';
import { IntelligenceReportBuilder } from '../utils/intelligence-report-builder';
import { AIResponseParser } from '../utils/ai-response-parser';
import { QuotaHandler } from '../utils/quota-handler';

// 情报 prompt 的 token 预算。原值 850000（≈340 万字符）是按 qwen-long 的 10M 上下文设的，
// 对 131k 上下文的模型形同虚设——超限时 Workers AI 直接报 AiError 5021，整条 story 丢失。
// 推导：门限用的是**估算值** ≈ 字符数/4.2，且把 max_tokens 一起算进上下文总额，故
// 可用输入 ≈ (131072 − 8192) × 4.2 ≈ 51.6 万字符；取 45 万留 13% 余量。
// limitTokens 内部按 maxTokens×4 换算字符，故这里填 112500。
// 截断优于报错：半份报告仍能进简报，报错则整条 story 消失（截断有日志留痕，见调用处）。
const INTEL_PROMPT_TOKEN_BUDGET = 112500;

// 情报分析格式失败的重采样上限。失败是**采样噪声**不是模型理解错（同一输入 20 次里
// 16 次成功），故盲重采样有效：单次成功率 ~80% → 4 次尝试残余 ~0.16%。
// 不带错误反馈重问（业界对"模型没读懂 schema"的默认做法），因为对随机滑手无理论优势且更贵。
// 不加退避延迟：失败与负载无关，等待纯属浪费。
const INTEL_PARSE_MAX_ATTEMPTS = 4;

// 导出类型以保持兼容性
export type {
  ArticleDataset, 
  ValidatedStories, 
  IntelligenceReports, 
  IntelligenceReport, 
  Story, 
  Article 
};

/**
 * 情报分析服务
 * 提供基于AI的深度情报分析功能，生产环境版本，直接抛出错误
 */
export class IntelligenceService {
  private aiGatewayService: AIGatewayService;
  private traceContext: TraceContext;
  // RARR 式接地校验-改正开关：默认开（与环2 简报生成的 selfCorrect 同款语义），
  // eval baseline 臂传 false 关掉做对照。
  private selfCorrect: boolean;
  // 跳过 AI Gateway 缓存：默认 false（生产照常，且每 story 文章不同→缓存键本就不撞）。
  // eval 重问同一 story 必须传 true：否则 n 次采样静默退化成 1 次（见 memory:
  // ai-gateway-cache-eval-trap；本轮实测 B/C 臂 4 次输出逐字节相同即此因）。
  private skipCache: boolean;

  constructor(
    private env: CloudflareEnv,
    traceContext: TraceContext = {},
    options: { selfCorrect?: boolean; skipCache?: boolean } = {}
  ) {
    this.aiGatewayService = new AIGatewayService(env);
    this.traceContext = traceContext;
    this.selfCorrect = options.selfCorrect !== false;
    this.skipCache = options.skipCache === true;
  }

  /**
   * 分析多个故事并生成情报报告 - 主要方法
   * 基于 intelligence-pipeline.test.ts 契约
   */
  async analyzeStories(
    stories: ValidatedStories, 
    dataset: ArticleDataset
  ): Promise<{ success: boolean; data?: IntelligenceReports; error?: string }> {
    console.log(`[Intelligence] 开始分析 ${stories.stories.length} 个故事...`);
    
    try {
      const reports: IntelligenceReport[] = [];
      let completedAnalyses = 0;
      let failedAnalyses = 0;

      for (const story of stories.stories) {
        try {
          const report = await this.processStory(story, dataset);
          reports.push(report);
          completedAnalyses++;
        } catch (error) {
          console.error(`[Intelligence] 故事 "${story.title}" 分析失败:`, error);
          failedAnalyses++;
          
          // 生产环境：真实报告错误，不创建fallback报告
          console.error(`[Intelligence] 故事分析失败: ${story.title}`, {
            error: error instanceof Error ? error.message : String(error),
            storyTitle: story.title,
            articleIds: story.articleIds,
            timestamp: new Date().toISOString()
          });
          // 跳过此故事，不添加任何报告
        }
      }

      const result: IntelligenceReports = {
        reports,
        processingStatus: {
          totalStories: stories.stories.length,
          completedAnalyses,
          failedAnalyses,
        },
      };

      // 如果有失败的分析，明确报告错误
      if (failedAnalyses > 0) {
        console.error(`[Intelligence] 严重错误: ${failedAnalyses}/${stories.stories.length} 故事分析失败`);
        return { 
          success: false, 
          error: `Analysis failed for ${failedAnalyses} out of ${stories.stories.length} stories. Check AI Gateway configuration and model availability.`,
          data: result // 仍然返回部分结果用于诊断
        };
      }

      console.log(`[Intelligence] 分析完成: ${completedAnalyses} 成功, ${failedAnalyses} 失败`);
      return { success: true, data: result };

    } catch (error: any) {
      console.error('[Intelligence] 批量分析失败:', error);
      return { success: false, error: `Failed to analyze stories: ${error.message}` };
    }
  }

  /**
   * 分析单个故事并生成详细情报报告
   * 基于 intelligence-pipeline.test.ts 契约
   */
  async analyzeSingleStory(
    story: Story, 
    articleData: Article[]
  ): Promise<{ success: boolean; data?: IntelligenceReport; error?: string }> {
    try {
      // 基础验证
      if (!story.articleIds.length) {
        return { success: false, error: "No articles in story" };
      }

      const relevantArticles = articleData.filter(article => 
        story.articleIds.includes(article.id)
      );
      
      if (!relevantArticles.length) {
        return { success: false, error: "No matching articles found" };
      }

      console.log(`[Intelligence] 分析故事 "${story.title}"，包含 ${relevantArticles.length} 篇文章`);

      // 执行AI分析（失败时直接抛出错误）
      const analysis = await this.performAIAnalysis(relevantArticles);
      
      // 构造符合契约的情报报告
      const report = IntelligenceReportBuilder.buildFromAnalysis(story, relevantArticles, analysis);
      console.log(`[Intelligence] 故事 "${story.title}" 分析完成，状态: ${report.status}`);

      return { success: true, data: report };

    } catch (error: any) {
      console.error(`[Intelligence] 单故事分析失败:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 兼容性方法 - 支持旧接口格式
   */
  async analyzeStory(request: unknown) {
    const { title, articles_ids, articles_data } = LegacyIntelligenceAnalysisRequestSchema.parse(request);
    
    // 转换为新格式
    const story: Story = {
      title,
      importance: 5, // 默认重要性
      articleIds: articles_ids,
      storyType: "SINGLE_STORY",
    };

    const articles: Article[] = articles_data.map(article => ({
      id: article.id,
      title: article.title,
      content: article.content,
      publishDate: article.publishDate,
      url: article.url,
      summary: article.content.substring(0, 200) + '...', // 生成简要摘要
    }));

    const result = await this.analyzeSingleStory(story, articles);
    
    if (result.success && result.data) {
      // 转换为旧格式响应
      return {
        story_title: title,
        articles_count: articles.length,
        analysis: IntelligenceReportBuilder.convertToLegacyFormat(result.data),
        metadata: {
          // 上报实际使用的模型，别写死——写死会在换 provider 后谎报，误导排错
          provider: PHASE_DEFAULTS.intelligence_analysis.provider,
          model: PHASE_DEFAULTS.intelligence_analysis.model,
          original_articles: articles_ids
        }
      };
    } else {
      throw new Error(result.error || 'Analysis failed');
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 处理单个故事（内部方法）
   */
  private async processStory(story: Story, dataset: ArticleDataset): Promise<IntelligenceReport> {
    // 获取相关文章数据
    const relevantArticles = dataset.articles.filter(article => 
      story.articleIds.includes(article.id)
    );

    if (!relevantArticles.length) {
      const errorMsg = `故事 "${story.title}" 没有找到相关文章`;
      console.error(`[Intelligence] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 分析单个故事
    const singleStoryResult = await this.analyzeSingleStory(story, relevantArticles);
    
    if (singleStoryResult.success && singleStoryResult.data) {
      return singleStoryResult.data;
    } else {
      const errorMsg = `故事 "${story.title}" 分析失败: ${singleStoryResult.error}`;
      console.error(`[Intelligence] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * 执行AI分析（内部方法）
   */
  private async performAIAnalysis(articles: Article[]): Promise<any> {
    // 构建分析输入
    const storyArticleMd = AIResponseParser.buildArticleMarkdown(articles);
    const prompt = getIntelligenceAnalysisPrompt(storyArticleMd);
    const limitedPrompt = AIResponseParser.limitTokens(prompt, INTEL_PROMPT_TOKEN_BUDGET);
    if (limitedPrompt.length < prompt.length) {
      // 截断必须留痕：静默截断会让"报告漏了某篇文章的事实"看起来像模型漏报，归因彻底跑偏。
      console.warn(`[Intelligence] 提示词超预算被截断: ${prompt.length} → ${limitedPrompt.length} 字符 ` +
        `(${articles.length} 篇文章)，尾部文章可能未进入分析`);
    }

    console.log(`[Intelligence] 提示词长度: ${limitedPrompt.length} 字符`);
    console.log(`[Intelligence] 开始调用AI Gateway...`);
    
    // 使用重试策略进行AI分析
    const aiOperation = async () => {
      // 配置走 call-llm（intelligence_analysis 默认 dashscope/qwen-long/temp0.1/8192）；
      // skipCache 保留 this.skipCache 覆盖（eval 注入用）。
      const result = await callLLM(this.aiGatewayService, this.env, this.traceContext, 'intelligence_analysis',
        [{ role: 'user' as const, content: limitedPrompt }],
        {
          skipCache: this.skipCache,
          metadata: {
            requestId: `intel-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            timestamp: Date.now(),
          },
        }
      );

      if (result.capability !== 'chat') {
        throw new Error('Unexpected response type from chat service');
      }
      
      const chatResult = result as ChatResponse;
      const responseText = chatResult.choices?.[0]?.message?.content || '';
      
      console.log(`[Intelligence] AI响应长度: ${responseText.length} 字符`);
      console.log(`[Intelligence] AI响应预览: ${responseText.substring(0, 200)}...`);
      
      return responseText;
    };

    // 格式失败重采样：解析必须在重试**之内**。原先解析在 QuotaHandler.retryWithBackoff 之外，
    // 且该 helper 只认配额错误（非配额直接 rethrow），所以格式失败一次即判死 → 整条 story
    // 从简报里消失。2026-08-12 实测该失败率 ~20%（两个真实故事各 10 次，4 次失败），
    // 两种模式：①前置分析退化成两百多个标号的枚举循环，8192 token 烧光没写到 <final_json>
    // ②字符串值里出现未转义引号。两者都是采样噪声（同输入 16/20 成功），故重采样有效。
    // 只对 parseFailed 重采样；模型**自己判定**的 incomplete（文章空/付费墙）是合法结论，
    // 重问四次只会得到同样答案并白烧四份 token。
    let analysis: any = null;
    let parseAttempts = 0;
    for (let attempt = 1; attempt <= INTEL_PARSE_MAX_ATTEMPTS; attempt++) {
      parseAttempts = attempt;
      const responseText = await QuotaHandler.retryWithBackoff(aiOperation);
      analysis = AIResponseParser.parseIntelligenceResponse(responseText);

      if (!analysis?.parseFailed) {
        if (attempt > 1) console.log(`[Intelligence] 第 ${attempt} 次重采样解析成功`);
        break;
      }
      console.warn(`[Intelligence] 响应格式解析失败，重采样 (${attempt}/${INTEL_PARSE_MAX_ATTEMPTS})`);
      if (attempt === INTEL_PARSE_MAX_ATTEMPTS) {
        // 耗尽仍失败：留一条可 grep 的定长签名，供生产查真实发作率（业界共识：重试耗尽
        // 意味着 schema/prompt 设计问题，该报出来查，而不是静默兜底）。
        console.error(`[Intelligence] INTEL_PARSE_EXHAUSTED 连续 ${INTEL_PARSE_MAX_ATTEMPTS} 次解析失败，本条 story 将被丢弃`);
      }
    }
    console.log(`[Intelligence] 解析结果状态: ${analysis?.status || 'unknown'}`);
    // 落 R2：重采样次数是衡量"模型格式稳定性"的直接指标，只写 console 就无法跨 run 统计。
    // 只在真发生过重采样时落，避免每条 story 都写一个空对象。
    if (parseAttempts > 1) {
      await recordSensor(this.env, this.traceContext, 'intel_parse', {
        attempts: parseAttempts,
        maxAttempts: INTEL_PARSE_MAX_ATTEMPTS,
        exhausted: analysis?.parseFailed === true,
        articleCount: articles.length,
      }, this.traceContext.callIndex ?? 0);
    }

    // RARR 式接地校验-改正（默认开；eval baseline 臂传 selfCorrect:false 关掉做对照）
    if (this.selfCorrect !== false && analysis && analysis.status !== 'incomplete') {
      return await this.verifyAndCorrect(analysis, storyArticleMd);
    }
    return analysis;
  }

  // 报告里「对事实有断言」的可核字段。纯枚举/分类标签（importance/score 之类）不进校验，
  // 它们不是对源的事实断言。口径对齐 scripts/eval/intel-grounding/intel-source.ts 的 prose 摊平。
  private static readonly CHECKABLE: Array<{ path: string; get: (r: any) => string | undefined; set: (r: any, v: string) => void }> = [
    { path: 'executiveSummary', get: (r) => r.executiveSummary, set: (r, v) => { r.executiveSummary = v; } },
    { path: 'significance.reasoning', get: (r) => r.significance?.reasoning, set: (r, v) => { if (r.significance) r.significance.reasoning = v; } },
    { path: 'signalStrength.reasoning', get: (r) => r.signalStrength?.reasoning, set: (r, v) => { if (r.signalStrength) r.signalStrength.reasoning = v; } },
  ];

  /**
   * 拿报告回到它唯一允许的源（RSS 原文）前逐条核对，模型只回 edit-list，本地程序化 apply。
   * 强制力留在代码里：模型只提议，替换由此处执行；没精确命中的 edit 宁可跳过（防误伤）。
   * ——这正是「生成时证据账本」失败的反面：那里强制力交给了模型，它建完账本就绕过。
   */
  private async verifyAndCorrect(analysis: any, storyArticleMd: string): Promise<any> {
    try {
      // 摊平可核字段（含 timeline/entities 的文本项），每行带路径标记供模型定位
      const lines: string[] = [];
      const targets: Array<{ get: () => string; set: (v: string) => void }> = [];
      for (const f of IntelligenceService.CHECKABLE) {
        const v = f.get(analysis);
        if (typeof v === 'string' && v.trim()) {
          lines.push(`[${f.path}] ${v}`);
          targets.push({ get: () => f.get(analysis) as string, set: (nv) => f.set(analysis, nv) });
        }
      }
      const tl = Array.isArray(analysis.timeline) ? analysis.timeline : [];
      tl.forEach((e: any, i: number) => {
        if (typeof e?.description === 'string' && e.description.trim()) {
          lines.push(`[timeline[${i}].description] ${e.description}`);
          targets.push({ get: () => e.description, set: (nv) => { e.description = nv; } });
        }
      });
      const ents = Array.isArray(analysis.keyEntities) ? analysis.keyEntities : (analysis.keyEntities?.list ?? []);
      ents.forEach((e: any, i: number) => {
        const d = e?.description ?? e?.role;
        if (typeof d === 'string' && d.trim()) {
          lines.push(`[keyEntities[${i}].description] ${d}`);
          targets.push({ get: () => (e.description ?? e.role) as string, set: (nv) => { if (e.description !== undefined) e.description = nv; else e.role = nv; } });
        }
      });
      if (!targets.length) return analysis;

      // 独立 phase：模型/温度/预算见 PHASE_DEFAULTS.intel_grounding_verify。
      // 复用 'intelligence_analysis' 会和分析本体撞同一个 R2 key（见 llm-call-logger 的 phase 注释）。
      const raw = await callLLM(this.aiGatewayService, this.env, this.traceContext, 'intel_grounding_verify',
        [{ role: 'user' as const, content: getIntelReportVerificationPrompt(lines.join('\n'), storyArticleMd) }],
        {
          skipCache: this.skipCache,
          metadata: { requestId: `intel-rarr-${Date.now()}`, timestamp: Date.now() },
        }
      );
      const text = (raw as ChatResponse).choices?.[0]?.message?.content || '';
      const { edits, salvaged } = IntelligenceService.parseEditList(text);
      // 区分「一条 edit 都没解析出来」与「模型判定 0 处要改」：两者都走成 0 修正，但前者是
      // "这篇报告根本没被 RARR 核过"。不说出来就是静默降级——同 brief-generation.ts 的做法。
      if (edits.length === 0) {
        console.warn('[Intelligence] 接地校验响应未解析出任何 edit → 本篇报告未经 RARR 核验（非"模型判定 0 处要改"）');
      }

      let applied = 0, noop = 0, skipped = 0;
      for (const e of edits) {
        if (!e || typeof e.span !== 'string' || !e.span.length) continue;
        const rep = typeof e.replacement === 'string' ? e.replacement : '';
        // 只认精确子串命中：命中才改，没命中宁可不动（避免误伤）。逐字段试，改第一个命中的。
        const hit = targets.find((t) => (t.get() || '').includes(e.span!));
        if (hit) {
          const before = hit.get() || '';
          const after = before.replace(e.span, rep).replace(/\s{2,}/g, ' ').trim();
          // 分出 noop：复读产出的拷贝里有 replacement 与 span 逐字相同的（实测 010 号响应 64 条如此），
          // 一律记 applied 会让"改了 66 处"的日志对应实际 2 处改动——写回同一个值本就是空操作，
          // 故行为不变，只是计数不再说谎。
          if (after !== before) { hit.set(after); applied++; } else { noop++; }
        } else {
          skipped++;
        }
      }
      // uniqueSpans 是复读探针：正常响应 unique == edits，复读时会塌成个位数（实测 66→3）。
      // 只报数不改行为——判定"这次校验是否可信"要的是这个比值，不是被清洗过的漂亮计数。
      const uniqueSpans = new Set(edits.map((e) => e?.span).filter((s) => typeof s === 'string')).size;
      console.log(
        `[Intelligence] 接地校验-改正：edits ${edits.length}（unique span ${uniqueSpans}），applied ${applied}，noop ${noop}，skipped ${skipped}` +
        `${salvaged ? '，响应截断已救回完整部分' : ''}`
      );
      return analysis;
    } catch (error) {
      // 校验失败不应拖垮整条生成：退回未修订报告（下游忠实度门仍作末端兜底）。
      console.error('[Intelligence] 接地校验-改正失败，退回原报告:', error);
      return analysis;
    }
  }

  /**
   * 从校验响应里取 edit-list。严格 JSON.parse 优先；解析不了就退到括号配平扫描，
   * 把 `"edits": [` 之后**已经写完整**的对象逐个捞出来。
   *
   * 为什么需要救回：glm-4.7-flash 在 temp 0 下会陷入复读退化——同一条 edit 反复写到把
   * max_tokens 烧光，响应截断成非法 JSON，原实现整份丢弃 → 退回未校验报告。
   * 2026-08-15 生产 run 14 次校验里 4 次如此（近 7 天 71 次里 10 次），而这 4 份响应在
   * 陷入循环前已各写出 17/44/66/69 条完整 edit，去重后是 1/1/3/3 条真实修正，全被扔了。
   *
   * **不去重**：重复 span 看着像复读垃圾，但去掉会改行为——同一句话可能同时出现在
   * executiveSummary 和某条 timeline.description 里，而 apply 是"找第一个命中的 target"，
   * 靠后的那条重复 edit 才是去修第二处的；实测 012 号响应里还有同 span 不同 replacement 的情形。
   * 重复份本就是无害的：命中过的 span 已被替换，后续必然落空、记进 skipped。
   * 复读信号改为在日志里报去重后的条数（见调用处），只让它可见，不动行为。
   */
  private static parseEditList(text: string): { edits: Array<{ span?: string; replacement?: string; reason?: string }>; salvaged: boolean } {
    // 容忍 ```json 围栏 / 裸对象两种形态（与 AIResponseParser 同款容错思路）
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try {
      const parsed = JSON.parse(body);
      return { edits: Array.isArray(parsed?.edits) ? parsed.edits : [], salvaged: false };
    } catch {
      const edits = IntelligenceService.salvageEdits(fenced ? fenced[1] : text);
      return { edits, salvaged: edits.length > 0 };
    }
  }

  /** 括号配平扫描（跳过字符串内的括号与转义），逐个 JSON.parse 已闭合的对象。 */
  private static salvageEdits(body: string): Array<any> {
    const at = body.indexOf('"edits"');
    if (at < 0) return [];
    const start = body.indexOf('[', at);
    if (start < 0) return [];
    const out: Array<any> = [];
    let depth = 0, objStart = -1, inStr = false, esc = false;
    for (let p = start + 1; p < body.length; p++) {
      const c = body[p];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') { if (depth === 0) objStart = p; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          try { out.push(JSON.parse(body.slice(objStart, p + 1))); } catch { /* 半条，丢弃 */ }
          objStart = -1;
        }
      } else if (c === ']' && depth === 0) break;
    }
    return out;
  }
}