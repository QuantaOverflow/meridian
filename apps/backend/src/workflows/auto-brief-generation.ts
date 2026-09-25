import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/database';
import { $articles, $reports, $sources, $brief_runs, $brief_stories, gte, lte, isNotNull, isNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { assignStoryClustersForWorkflow } from '../lib/story-clusters';
import { DEFAULT_ARTICLE_CAP, pickSpreadArticles } from '../lib/core/story-dedup';
import {
  assembleBlocks,
  planBlocksFromJudgements,
  type JudgeResult,
  type PendingBlock,
} from '../lib/core/cluster-blocks';
import {
  PER_EVENT_BLOCK_CAP,
} from '../lib/core/storyline';
import { BRIEF_CLUSTERING_OPTIONS } from '../lib/core/constants';
import { createWorkflowObservability } from '../lib/observability';
import { createClusteringService, type ClusteringResult } from '../lib/services/clustering';
import { createAIServices, type BriefBlockV6Sentence } from '../lib/services/ai-services';
import { generateSearchText } from '../lib/core/utils';
import { looksLikeExtractionFailure } from '../lib/core/extraction-quality';
import { rankStoriesForIntelligence } from '../lib/core/story-ranking';
import { assignTiers, renderBriefV3, type Tier } from '../lib/core/brief-v3';
import type { Env } from '../index';

// ============================================================================
// 数据接口定义 - 轻量级版本，避免SQLITE_TOOBIG错误
// ============================================================================

// validateContentQuality 读的那几个字段（入参是库里整行，这里只声明被读到的）
interface ArticleRecord {
  title: string;
  completeness?: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS' | null;
  content_quality?: 'OK' | 'LOW_QUALITY' | 'JUNK' | null;
}

// 轻量级数据集接口 - 不包含完整内容，只保留引用
interface LightweightArticleDataset {
  articles: Array<{
    id: number;
    title: string;
    contentFileKey: string;  // R2存储引用
    publishDate: string;
  }>;
  embeddings: Array<{
    articleId: number;
    embedding: number[];
  }>;
  // embeddings 卸载到 R2 的 key（避开 CF Workflow 单 step ~1MB 输出上限）
  embeddingsR2Key?: string;
}

// 工作流参数接口
export interface BriefGenerationParams {
  article_ids?: number[];  // 从上游工作流传入的文章ID列表
  triggeredBy?: string;
  dateFrom?: Date;
  dateTo?: Date;
  
  // 简化的配置参数
  articleLimit?: number;
  timeRangeDays?: number;
  
  // 聚类配置选项
  clusteringOptions?: {
    agglomerativeThreshold?: number;
    agglomerativeLinkage?: string;
    agglomerativeMinClusterSize?: number;
  };
  
  // 业务控制参数
  maxStoriesToGenerate?: number;
}

// 简报生成结果接口
interface BriefGenerationResultData {
  title: string;
  content: string;
  /** 面向读者的散文摘要；生成失败时为 null（不阻断简报落库） */
  tldrProse: string | null;
  stats: {
    total_articles: number;
    used_articles: number;
    clusters_found: number;
    stories_identified: number;
    intelligence_analyses: number;
    content_length: number;
    model_used?: string;
  };
}

// ============================================================================
// 工作流步骤配置
// ============================================================================

// 现仅由「准备文章数据集」与「执行聚类分析」两步使用（合成步已拆出独立配置，见 briefSynthesisStepConfig）。
// 2 → 5 分钟：两步的耗时都随文章量线性涨，而 2026-08-17 扩源后窗口从 149 篇跳到 505 篇、
// 源池满负荷后 2 天窗口预计约 1200 篇。数据集步要读回全部带 384 维向量的行并卸载到 R2；
// 聚类步打的是 0.5 vCPU 容器，sleepAfter 到期后首调含冷启动（embedding 补算已在同工作流内跑过时
// 容器是热的，无补算可做的那天就是冷的——run 74 热、run 75 冷，同规模两种时间分布）。
const defaultStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
};

const dbStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '1 second', backoff: 'linear' },
  timeout: '30 seconds',
};

// 簇判定：每簇 1 次调用。全量一期约 70 个簇（不降维凝聚 + 最小 3 篇成簇），并发 6 下
// 约 1 分钟；30 分钟有大量余量。上一代 storyline 两段式是每篇一次归类、约 480 次调用、
// 约 4 分钟，换掉之后这一步的时间与成本都降了一个量级。
// retries 降到 1：重试代价是整期 LLM 重跑（无断点），而这一步失败等于当天没有简报——
// 与其烧三轮不如失败一次看日志。
const storylineStepConfig: WorkflowStepConfig = {
  retries: { limit: 1, delay: '10 seconds', backoff: 'linear' },
  timeout: '30 minutes',
};

/**
 * 簇判定调用的并发。与情报分析、简报块写作同档：不让 N 路同时打 provider，撞限流由
 * AIGateway 配额退避兜底。不能再提：判定 1-5 秒/次 × 并发 6 ≈ 100-300 rpm，
 * Workers AI 限流 300 rpm。
 */
const STORYLINE_CONCURRENCY = 6;

/**
 * 簇判定调用最多喂多少条标题。**这是输入侧的封顶。**
 *
 * 上一代（命名主线）时它是输出侧封顶——那时模型会逐篇起名、输出随输入线性涨。现在一次
 * 判定只吐一个 verdict + 一个标题 + 一句话，输出恒定，封顶是为了不让 81 篇的大簇把输入
 * 撑爆。下面这段是上一代的实测来历，保留备查：**这是输出侧的封顶，不是省钱。**
 *
 * 2026-09-04 起 prompt 要求「一件事一条主线、起不出具体名字就继续拆」，于是在垃圾袋簇上
 * 模型会逐篇起名，输出量随输入篇数线性涨（实测约 47 token/篇）：58 篇的袋子吐 2700-3500
 * token，147 篇的要 ~7000，必然撑爆 storyline_plan 的 maxTokens=4000 → JSON 截断 → 解析 0 条
 * → 走退化。**抬上限不解决**：实测把 4000 抬到 8000，同一个簇照样打满，还触发间歇性复读，
 * 单次调用从 40 秒变成 150 秒。
 *
 * 封 60 条：最坏 60 条主线 ≈ 2800 token，留足余量。超出的文章第 1 步看不见，但第 2 步照样
 * 逐篇归类——真事件簇 60 条标题足够把角度都命名出来（91 篇的尼泊尔簇本来也只出 5 条主线）；
 * 垃圾袋簇里没被采样到的文章会被塞进某个小块，仍然是小块，仍然排不上去。
 *
 * 取样按发表时间等距（复用 pickSpreadArticles），不是取前 60 条——取前 N 会让命名只看见
 * 事件早期的报道。
 */
const PLAN_TITLE_CAP = 60;

// ============================================================================
// R2并行读取配置
// ============================================================================

/**
 * R2内容读取并发批量大小
 * 控制同时进行的R2读取操作数量，避免过度并发导致的性能问题
 * 推荐值: 3-8, 根据R2性能和网络状况调整
 */
const R2_BATCH_SIZE = 5;

// ============================================================================
// 自动简报生成工作流
// 
// 性能优化说明：
// - 聚类分析步骤使用轻量级数据集，不获取完整文章内容
// - 聚类算法仅依赖embedding向量，避免不必要的R2读取和内存开销
// - 下游步骤（故事验证、情报分析等）通过getArticleContents按需获取内容
// ============================================================================

export class AutoBriefGenerationWorkflow extends WorkflowEntrypoint<Env, BriefGenerationParams> {
  
  // ============================================================================
  // R2并行读取工具函数
  // ============================================================================

  /**
   * 批量并行处理函数，控制并发数量
   * @param items 要处理的项目数组
   * @param batchSize 批量大小，控制并发数量
   * @param processor 处理单个项目的异步函数
   * @returns 处理结果数组
   */
  private async batchProcessParallel<T, R>(
    items: T[],
    batchSize: number,
    processor: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      console.log(`[AutoBrief] 并行处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}, 大小: ${batch.length}`);
      
      // 并行处理当前批次
      const batchPromises = batch.map((item, batchIndex) => 
        processor(item, i + batchIndex)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果，只保留成功的结果
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.warn(`[AutoBrief] 批次处理项目失败:`, result.reason);
        }
      }
    }
    
    return results;
  }

  /**
   * 按需从R2获取文章内容的辅助函数 (并行化版本)
   * 避免在工作流状态中存储大量内容数据
   */
  private async getArticleContents(articleIds: number[], lightweightDataset: LightweightArticleDataset): Promise<Array<{
    id: number;
    title: string;
    content: string;
    publishDate: string;
    /**
     * 正文取用结果。OK 之外都是失败。
     * 以前这里把「取不到」「取到空」「抛异常」一律糊成空字符串返回，调用方无法分辨，
     * 而同一件事在初始数据质量门那边（processArticleContent）是显式分因上报的——
     * 按严格那版统一口径，失败不再吞。
     */
    contentStatus: 'OK' | 'MISSING_CONTENT_KEY' | 'R2_CONTENT_MISSING' | 'EMPTY_R2_CONTENT' | 'R2_FETCH_ERROR';
  }>> {
      console.log(`[AutoBrief] 开始并行获取 ${articleIds.length} 篇文章内容，批量大小: ${R2_BATCH_SIZE}`);
  
  // 过滤出有效的文章信息
  const validArticleInfos = articleIds
    .map(articleId => lightweightDataset.articles.find(a => a.id === articleId))
    .filter((article): article is NonNullable<typeof article> => !!article);
  
  console.log(`[AutoBrief] 有效文章信息: ${validArticleInfos.length} 篇`);
  
  // 并行处理函数
  const processArticle = async (lightweightArticle: typeof validArticleInfos[0], index: number) => {
    const base = {
      id: lightweightArticle.id,
      title: lightweightArticle.title,
      publishDate: lightweightArticle.publishDate,
    };
    if (!lightweightArticle.contentFileKey) {
      console.warn(`[AutoBrief] 取正文失败 MISSING_CONTENT_KEY (ID: ${lightweightArticle.id})`);
      return { ...base, content: '', contentStatus: 'MISSING_CONTENT_KEY' as const };
    }
    try {
      const contentObject = await this.env.ARTICLES_BUCKET.get(lightweightArticle.contentFileKey);
      if (!contentObject) {
        console.warn(`[AutoBrief] 取正文失败 R2_CONTENT_MISSING (ID: ${lightweightArticle.id}, key: ${lightweightArticle.contentFileKey})`);
        return { ...base, content: '', contentStatus: 'R2_CONTENT_MISSING' as const };
      }
      const content = await contentObject.text();
      if (!content.trim()) {
        console.warn(`[AutoBrief] 取正文失败 EMPTY_R2_CONTENT (ID: ${lightweightArticle.id}, key: ${lightweightArticle.contentFileKey})`);
        return { ...base, content: '', contentStatus: 'EMPTY_R2_CONTENT' as const };
      }
      return { ...base, content, contentStatus: 'OK' as const };
    } catch (error) {
      console.warn(`[AutoBrief] 取正文失败 R2_FETCH_ERROR (ID: ${lightweightArticle.id}):`, error);
      return { ...base, content: '', contentStatus: 'R2_FETCH_ERROR' as const };
    }
  };

  // 使用批量并行处理，控制并发数量
  const articlesWithContent = await this.batchProcessParallel(
    validArticleInfos,
    R2_BATCH_SIZE, // 使用配置的批量大小
    processArticle
  );
  
  const contentFailures = articlesWithContent.filter(a => a.contentStatus !== 'OK');
  console.log(`[AutoBrief] 并行获取文章内容完成: ${articlesWithContent.length} 篇（取正文失败 ${contentFailures.length} 篇）`);
  if (contentFailures.length > 0) {
    const byReason: Record<string, number> = {};
    for (const a of contentFailures) byReason[a.contentStatus] = (byReason[a.contentStatus] ?? 0) + 1;
    console.warn(`[AutoBrief] 取正文失败分因: ${JSON.stringify(byReason)}`);
  }
    return articlesWithContent;
  }
  
  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      article_ids = [],
      triggeredBy = 'system', 
      dateFrom, 
      dateTo, 
      
      articleLimit = 30, // 降低默认限制以避免SQLITE_TOOBIG错误
      timeRangeDays = 2,
      clusteringOptions,
      maxStoriesToGenerate = 25
    } = event.payload;

    // 使用 Cloudflare Workflow 实例的真实ID，而不是自生成的UUID
    const workflowId = event.instanceId;
    const observability = createWorkflowObservability(workflowId, this.env);
    
    await observability.logStep('workflow_start', 'started', {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      customClusteringOptions: !!clusteringOptions,
      maxStoriesToGenerate,
      article_ids_provided: article_ids.length
    });

    // 观测性：写入 brief_runs(status=RUNNING)。step.do 包裹保证重试时幂等（workflow_id unique）
    await step.do('persist:brief_run_start', dbStepConfig, async () => {
      const db = getDb(this.env.HYPERDRIVE);
      await db
        .insert($brief_runs)
        .values({
          workflow_id: workflowId,
          status: 'RUNNING',
          params: event.payload as any,
        })
        .onConflictDoNothing({ target: $brief_runs.workflow_id });
    });

    try {
      console.log(`[AutoBriefGeneration] 开始简报生成工作流, 参数:`, event.payload);

      // =====================================================================
      // 步骤 1: 获取文章数据并构建 ArticleDataset
      // =====================================================================
      await observability.logStep('prepare_dataset', 'started');
      
      // 简化的质量控制指标 - 只记录工作流特有的R2内容获取统计
      const r2ContentMetrics = {
        r2FetchAttempts: 0,
        r2FetchSuccesses: 0,
        r2FetchFailures: 0,
        qualityFilteredOut: 0
      };
      
      // 补算缺失 embedding（成本优化 2026-07-08）：进稿侧不再逐篇实时算——那会让 ml-service
      // 容器的 10min sleepAfter 被全天进稿反复重置而 24/7 常驻（账单实证 ~$31/月）。embedding
      // 的唯一消费者就是本工作流的聚类，故聚类前在此批量补算，容器每天只醒这几分钟。
      // 结构：清单查询一个轻 step（只回 id，防 1MB step 输出上限）+ 每批一个独立 step——
      // 0.5 vCPU 容器上百篇批量推理 + 首批冷启动会超默认 2min step 超时（生产首跑实测
      // WorkflowTimeoutError），故每批 50 篇、批 step 单独给 5min 超时。
      // 单批重试后仍失败则 catch 跳过不拖垮工作流（该批文章保持 NULL，被数据集查询天然排除
      // ——与旧 EMBEDDING_FAILED 语义等价的降级）；批内先按 isNull 复查保证重试幂等。
      const pendingIds: number[] = await step.do('补算:查缺失清单', dbStepConfig, async (): Promise<number[]> => {
        const db = getDb(this.env.HYPERDRIVE);
        const timeConditions = [];
        if (article_ids.length === 0) {
          if (dateFrom) timeConditions.push(gte($articles.publishDate, new Date(dateFrom)));
          if (dateTo) timeConditions.push(lte($articles.publishDate, new Date(dateTo)));
          if (!dateFrom && !dateTo && timeRangeDays && timeRangeDays > 0) {
            timeConditions.push(gte($articles.publishDate, new Date(Date.now() - timeRangeDays * 24 * 60 * 60 * 1000)));
          }
        }
        const rows = await db
          .select({ id: $articles.id })
          .from($articles)
          .innerJoin($sources, eq($articles.sourceId, $sources.id))
          .where(
            and(
              isNull($articles.embedding),
              eq($articles.status, 'PROCESSED'),
              isNotNull($articles.contentFileKey),
              ...(article_ids.length > 0
                ? [inArray($articles.id, article_ids)]
                : [eq($sources.category, 'news'), ...timeConditions])
            )
          )
          .orderBy(desc($articles.publishDate))
          .limit(articleLimit || 100);
        console.log(`[AutoBrief] embedding 补算：窗口内缺失 ${rows.length} 篇`);
        return rows.map(r => r.id);
      });

      const EMBED_BATCH = 50;
      const embedBatchStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
        timeout: '5 minutes', // 0.5 vCPU 批量推理 + 首批含容器冷启动，2min 不够（生产实测）
      };
      let embedBackfilled = 0;
      let embedFailed = 0;
      for (let i = 0; i < pendingIds.length; i += EMBED_BATCH) {
        const batchIds = pendingIds.slice(i, i + EMBED_BATCH);
        const batchNo = Math.floor(i / EMBED_BATCH) + 1;
        try {
          const written = await step.do(`补算 embedding 批次 ${batchNo}`, embedBatchStepConfig, async (): Promise<number> => {
            const db = getDb(this.env.HYPERDRIVE);
            // isNull 复查保证重试幂等（前次尝试已写库的文章不再重算）
            const batch = await db
              .select({
                id: $articles.id,
                title: $articles.title,
                primary_location: $articles.primary_location,
                event_summary_points: $articles.event_summary_points,
                thematic_keywords: $articles.thematic_keywords,
                topic_tags: $articles.topic_tags,
                key_entities: $articles.key_entities,
                content_focus: $articles.content_focus,
              })
              .from($articles)
              .where(and(inArray($articles.id, batchIds), isNull($articles.embedding)));
            if (!batch.length) return 0;

            const texts = batch.map(a =>
              generateSearchText({
                title: a.title ?? '',
                primary_location: a.primary_location,
                event_summary_points: a.event_summary_points,
                thematic_keywords: a.thematic_keywords,
                topic_tags: a.topic_tags,
                key_entities: a.key_entities,
                content_focus: a.content_focus,
              } as Parameters<typeof generateSearchText>[0])
            );
            const aiServices = createAIServices(this.env, workflowId);
            const embResult = await aiServices.aiWorker.generateEmbedding(texts);
            if (!embResult.ok) {
              throw new Error(`批量 embedding 返回异常: ${embResult.error}`);
            }
            const embeddings = embResult.value.embeddings;
            if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
              throw new Error(`批量 embedding 返回异常: 期望 ${batch.length} 条，实得 ${embeddings?.length ?? 0}`);
            }
            let ok = 0;
            for (let j = 0; j < batch.length; j++) {
              const emb = embeddings[j]?.embedding;
              if (!Array.isArray(emb) || emb.length !== 384) {
                console.error(`[AutoBrief] embedding 维度异常(文章 ${batch[j].id})：期望 384，实得 ${Array.isArray(emb) ? emb.length : '非数组'}`);
                continue;
              }
              await db.update($articles).set({ embedding: emb }).where(eq($articles.id, batch[j].id));
              ok++;
            }
            return ok;
          });
          embedBackfilled += written;
        } catch (error) {
          embedFailed += batchIds.length;
          console.error(`[AutoBrief] embedding 批次 ${batchNo} 重试后仍失败(${batchIds.length} 篇，跳过不中断): ${String(error)}`);
        }
      }
      if (pendingIds.length > 0) {
        console.log(`[AutoBrief] embedding 补算完成: 成功 ${embedBackfilled} / 失败 ${embedFailed} / 待补 ${pendingIds.length}`);
      }

      const dataset: LightweightArticleDataset = await step.do('准备文章数据集', defaultStepConfig, async (): Promise<LightweightArticleDataset> => {
        try {
          const db = getDb(this.env.HYPERDRIVE);
          
          // 构建查询条件
          const timeConditions = [];
          
          // 如果提供了文章ID列表，优先使用
          if (article_ids.length > 0) {
            console.log(`[AutoBrief] 使用上游提供的 ${article_ids.length} 个文章ID`);
          } else {
            // 否则使用时间范围查询
            if (dateFrom) {
              timeConditions.push(gte($articles.publishDate, new Date(dateFrom)));
            }
            if (dateTo) {
              timeConditions.push(lte($articles.publishDate, new Date(dateTo)));
            }
            if (!dateFrom && !dateTo && timeRangeDays && timeRangeDays > 0) {
              const daysAgo = new Date(Date.now() - timeRangeDays * 24 * 60 * 60 * 1000);
              timeConditions.push(gte($articles.publishDate, daysAgo));
            }
          }
          console.log(`[AutoBrief] 最终时间条件数量: ${timeConditions.length}`);

                     // 查询已处理的文章
           const queryResult = await db
             .select({
               id: $articles.id,
               title: $articles.title,
               // 同源模板页去重要按「同一家媒体」分组，见 bodyFingerprint
               sourceId: $articles.sourceId,
               contentFileKey: $articles.contentFileKey,
               publish_date: $articles.publishDate,
               embedding: $articles.embedding,
               completeness: $articles.completeness,
               content_quality: $articles.content_quality,
             })
             .from($articles)
             .innerJoin($sources, eq($articles.sourceId, $sources.id))
             .where(
               and(
                 isNotNull($articles.embedding),
                 eq($articles.status, 'PROCESSED'),
                 isNotNull($articles.contentFileKey),
                 // 自动选样时只取新闻源,排除技术类(如 HN)单篇噪音——与聚类 prune 互补的上游过滤。
                 // 显式传 article_ids 时不强加(调用方/eval 自行决定样本)。
                 ...(article_ids.length > 0
                   ? [inArray($articles.id, article_ids)]
                   : [eq($sources.category, 'news'), ...timeConditions])
               )
             )
             // 按发布时间倒序：窗口内文章数常 >limit，无排序时 Postgres 按堆序(偏旧)返回，
             // 会截掉最新文章。日报必须优先最新，否则新增源/当天新闻进不了简报。
             .orderBy(desc($articles.publishDate))
             .limit(articleLimit || 100);
          console.log(`[AutoBrief] 从数据库获取到 ${queryResult.length} 篇文章`);

          // 窗口截短的判别信号。取数是「窗口内按 publish_date 倒序取前 N 篇」，取满 N 就说明
          // 窗口里还有更旧的合格文章没被看过——**时间窗被 limit 悄悄截短了**，而这在旧代码里
          // 只能靠事后翻库反推（08-15 那次 2 天窗实际只覆盖 21.1 小时就是这么发现的）。
          // 取满不等于一定出问题（正好相等也可能），但它是唯一能在日志里直接看见的信号。
          if (article_ids.length === 0 && queryResult.length >= (articleLimit || 100)) {
            console.warn(
              `[AutoBrief] ⚠️ 取数取满上限 ${articleLimit || 100} 篇，时间窗可能被截短：` +
                `窗口设定 ${timeRangeDays} 天，但更旧的合格文章不会进入本期。` +
                `若持续出现，调高 CRON_BRIEF_PARAMS.ARTICLE_LIMIT。`
            );
          }

          // 验证嵌入向量有效性
          const validArticles = queryResult.filter(row => 
            Array.isArray(row.embedding) && row.embedding.length === 384
          );
          
          if (queryResult.length !== validArticles.length) {
            console.warn(`[AutoBrief] 过滤掉 ${queryResult.length - validArticles.length} 篇无效嵌入向量的文章`);
          }

          if (validArticles.length < 2) {
            throw new Error(`文章数量不足进行聚类分析 (获取到 ${validArticles.length} 篇, 需要至少 2 篇)`);
          }

          // 从 R2 获取文章内容并进行严格质量控制 (并行化版本)
          // 显式标注：下面的同源去重会在 push 之后读这两个数组，evolving any[] 推不出类型
          const articles: LightweightArticleDataset['articles'] = [];
          const embeddings: LightweightArticleDataset['embeddings'] = [];
          
          // 内容质量验证函数
          const validateContentQuality = (content: string, article: ArticleRecord): { isValid: boolean; reason?: string } => {
            if (!content || content.trim().length === 0) {
              return { isValid: false, reason: 'EMPTY_CONTENT' };
            }
            
            // 检查内容长度 - 至少应该超过标题长度的2倍
            if (content.length < (article.title.length * 2)) {
              return { isValid: false, reason: 'INSUFFICIENT_LENGTH' };
            }
            
            // 检查内容是否只是标题重复
            if (content.trim() === article.title.trim()) {
              return { isValid: false, reason: 'TITLE_ONLY' };
            }

            // 抓取/解析失败签名兜底:抽到的是拦截页/视频stub/登录墙/限流页(非真正文)。
            // processArticles 已在抓取后前置拦截,这里兜历史数据 + 任何残留。
            const extractionFail = looksLikeExtractionFailure(content);
            if (extractionFail.fail) {
              return { isValid: false, reason: `EXTRACTION_JUNK_${extractionFail.reason}` };
            }

            // 检查内容质量标记 - 类型安全检查
            if (article.content_quality && (article.content_quality === 'LOW_QUALITY' || article.content_quality === 'JUNK')) {
              return { isValid: false, reason: 'MARKED_LOW_QUALITY' };
            }
            
            // 检查完整性标记  - 类型安全检查
            if (article.completeness && article.completeness === 'PARTIAL_USELESS') {
              return { isValid: false, reason: 'MARKED_INCOMPLETE' };
            }
            
            return { isValid: true };
          };

          /**
           * 同源模板页指纹：正文折叠空白、小写后取 sha1。**多行正文先去掉第一行**
           * （常是 "Updated: 19/09/2026 - 7:00 GMT+2" 这类每篇都不同的时间戳）。
           *
           * 治的是 Euronews 日播栏目那种：Morning / Midday / Evening 三篇都是视频页，抓到的
           * "正文" 只有 575 字符的栏目宣传语、除首行时间戳外一字不差 → 必然聚成一簇 → 下游
           * 当真事写进简报（2026-09-19 实测）。`looksLikeExtractionFailure` 的六条签名一条都
           * 不命中（不是 YouTube 提示词、不算极短、文案是正经英文句子），属于它已知会漏的那 7%。
           *
           * 分组键必须带 sourceId：通讯社转载会让**不同媒体**正文高度相似（当天 Pakistan 那条
           * 就是 SCMP + AP 两版），那是合法的多源佐证，这条规则不该碰它。
           *
           * **单行正文用全文、不去首行**：整篇只有一行时「去掉第一行」会把正文删光，同一家的
           * 所有单行文章共用一个空指纹、彼此互判重复。2026-09-19 那天 458 篇里 414 篇是单行，
           * 无条件去首行 + 不挡空串 = 丢 407 篇。改成按行数分支后这 414 篇照常参与比对，
           * 当天读数：命中 2 组、丢 3 篇（Euronews bulletin ×3、The Independent 同一篇被抓两次
           * ×2），误杀方向为零。仍保留空串返回 null 的兜底——正文为空本就不该进去重。
           */
          const bodyFingerprint = async (content: string): Promise<string | null> => {
            const lines = content.split('\n');
            const body = lines.length > 1 ? lines.slice(1).join('\n') : content;
            const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();
            if (!normalized) return null;
            const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(normalized));
            return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
          };

          // 并行处理文章内容获取的函数
          const processArticleContent = async (article: typeof validArticles[0], index: number) => {
            let content = '';
            
            try {
              // 严格要求必须有 contentFileKey
              if (!article.contentFileKey) {
                r2ContentMetrics.r2FetchFailures++;
                return {
                  success: false,
                  reason: 'MISSING_CONTENT_KEY',
                  article: null,
                  embedding: null
                };
              }

              // 严格从 R2 获取内容，不允许回退
              r2ContentMetrics.r2FetchAttempts++;
              const contentObject = await this.env.ARTICLES_BUCKET.get(article.contentFileKey);
              if (!contentObject) {
                r2ContentMetrics.r2FetchFailures++;
                return {
                  success: false,
                  reason: 'R2_CONTENT_MISSING',
                  article: null,
                  embedding: null
                };
              }

              content = await contentObject.text();
              if (!content) {
                r2ContentMetrics.r2FetchFailures++;
                return {
                  success: false,
                  reason: 'EMPTY_R2_CONTENT',
                  article: null,
                  embedding: null
                };
              }
              
              r2ContentMetrics.r2FetchSuccesses++;
              
            } catch (error) {
              r2ContentMetrics.r2FetchFailures++;
              return {
                success: false,
                reason: 'R2_FETCH_ERROR',
                error: error,
                article: null,
                embedding: null
              };
            }

            // 严格的内容质量验证
            const qualityCheck = validateContentQuality(content, article as ArticleRecord);
            if (!qualityCheck.isValid) {
              r2ContentMetrics.qualityFilteredOut++;
              return {
                success: false,
                reason: `QUALITY_FILTER_${qualityCheck.reason}`,
                article: null,
                embedding: null
              };
            }

            // 只有通过所有质量检查的文章才会被返回。
            // 指纹在这里算掉（正文在手），**正文本身不带出循环**——整天几百篇正文没必要占内存。
            const dedupKey = await (async () => {
              const fp = await bodyFingerprint(content);
              return fp ? `${article.sourceId ?? 'null'}:${fp}` : null;
            })();
            return {
              success: true,
              dedupKey,
              article: {
                id: article.id,
                title: article.title,
                contentFileKey: article.contentFileKey!, // 确保非空
                publishDate: article.publish_date?.toISOString() || new Date().toISOString(),
              },
              embedding: {
                articleId: article.id,
                embedding: article.embedding as number[]
              }
            };
          };
          
          console.log(`[AutoBrief] 开始并行获取 ${validArticles.length} 篇文章内容，批量大小: ${R2_BATCH_SIZE}`);
          
          // 使用批量并行处理 R2 内容获取
          const processResults = await this.batchProcessParallel(
            validArticles,
            R2_BATCH_SIZE, // 使用配置的批量大小
            processArticleContent
          );
          
          // 处理结果并构建最终数据集
          let successCount = 0;
          let failuresByReason: Record<string, number> = {};
          // 与 articles 同下标的同源指纹（null = 不参与去重）
          const dedupKeys: Array<string | null> = [];

          for (const result of processResults) {
            if (result.success && result.article && result.embedding) {
              articles.push(result.article);
              embeddings.push(result.embedding);
              dedupKeys.push(result.dedupKey ?? null);
              successCount++;
            } else {
              const reason = result.reason || 'UNKNOWN_ERROR';
              failuresByReason[reason] = (failuresByReason[reason] || 0) + 1;
              
              if (result.reason === 'MISSING_CONTENT_KEY') {
                console.warn(`[AutoBrief] 文章缺少内容文件键，跳过 (索引: ${processResults.indexOf(result)})`);
              } else if (result.reason === 'R2_CONTENT_MISSING') {
                console.error(`[AutoBrief] R2内容缺失，跳过文章 (索引: ${processResults.indexOf(result)})`);
              } else if (result.reason === 'EMPTY_R2_CONTENT') {
                console.error(`[AutoBrief] R2返回空内容，跳过文章 (索引: ${processResults.indexOf(result)})`);
              } else if (result.reason?.startsWith('QUALITY_FILTER_')) {
                const qualityReason = result.reason.replace('QUALITY_FILTER_', '');
                console.warn(`[AutoBrief] 内容质量不符合要求，跳过文章 (索引: ${processResults.indexOf(result)}, 原因: ${qualityReason})`);
              } else if (result.reason === 'R2_FETCH_ERROR') {
                console.error(`[AutoBrief] R2内容获取异常，跳过文章 (索引: ${processResults.indexOf(result)}):`, result.error);
              }
            }
          }
          
          // 同源模板页去重：同一个 source 下、正文去掉首行后完全相同的，只留 id 最小的一篇。
          // 2026-09-19 全天 458 篇上实测：命中 1 组 3 篇（Euronews bulletin），丢弃 2 篇，
          // 误杀方向为零（只有这 1 组命中，所以谈不上统计意义上的精度）。
          {
            const keeperByKey = new Map<string, number>();
            const dropIdx = new Set<number>();
            for (let i = 0; i < articles.length; i++) {
              const key = dedupKeys[i];
              if (!key) continue;
              const keeper = keeperByKey.get(key);
              if (keeper === undefined) {
                keeperByKey.set(key, i);
                continue;
              }
              // 保留 id 最小的那篇：结果不依赖 R2 并行返回的先后
              if (articles[keeper].id <= articles[i].id) {
                dropIdx.add(i);
              } else {
                dropIdx.add(keeper);
                keeperByKey.set(key, i);
              }
            }
            if (dropIdx.size > 0) {
              const dropped = Array.from(dropIdx).sort((a, b) => a - b);
              console.warn(
                `[AutoBrief] 同源重复正文丢弃 ${dropped.length} 篇 (DUPLICATE_BODY_SAME_SOURCE): ` +
                dropped.map(i => `${articles[i].id} "${articles[i].title}"`).join(' | ')
              );
              // 倒序删，免得前面的 splice 挪动后面的下标
              for (const i of [...dropped].reverse()) {
                articles.splice(i, 1);
                embeddings.splice(i, 1);
                dedupKeys.splice(i, 1);
              }
              failuresByReason['DUPLICATE_BODY_SAME_SOURCE'] =
                (failuresByReason['DUPLICATE_BODY_SAME_SOURCE'] || 0) + dropped.length;
              successCount -= dropped.length;
            }
            // articles 与 embeddings 按下标一一对应，只删一个会让 embedding 错位**且不报错**
            if (articles.length !== embeddings.length || articles.some((a, i) => a.id !== embeddings[i].articleId)) {
              throw new Error(
                `同源去重后 articles/embeddings 错位: ${articles.length} vs ${embeddings.length}`
              );
            }
          }

          console.log(`[AutoBrief] 📊 并行内容获取统计:`);
          console.log(`  - 成功处理: ${successCount} 篇`);
          console.log(`  - 失败分布: ${JSON.stringify(failuresByReason, null, 2)}`);
          console.log(`  - 总体成功率: ${((successCount / validArticles.length) * 100).toFixed(1)}%`);

          // 记录详细的质量控制日志
          console.log(`[AutoBrief] ✅ 并行内容质量控制完成:`);
          console.log(`  - 初始文章数: ${validArticles.length}`);
          console.log(`  - 最终有效文章: ${articles.length}`);
          console.log(`  - R2获取尝试: ${r2ContentMetrics.r2FetchAttempts}`);
          console.log(`  - R2获取成功: ${r2ContentMetrics.r2FetchSuccesses}`);
          console.log(`  - R2获取失败: ${r2ContentMetrics.r2FetchFailures}`);
          console.log(`  - 质量过滤: ${r2ContentMetrics.qualityFilteredOut}`);
          console.log(`  - 总过滤数: ${validArticles.length - articles.length}`);
          console.log(`  - 质量通过率: ${((articles.length / validArticles.length) * 100).toFixed(1)}%`);
          console.log(`  - 并行批次处理效率: 批量大小${R2_BATCH_SIZE}, 减少网络延迟`);
          
          // 记录具体的失败原因分布，用于监控和优化
          console.log(`[AutoBrief] 📋 失败原因详细分布:`);
          Object.entries(failuresByReason).forEach(([reason, count]) => {
            const percentage = ((count / validArticles.length) * 100).toFixed(1);
            console.log(`  - ${reason}: ${count} 篇 (${percentage}%)`);
          });

          // 卸载 embeddings 到 R2：CF Workflow 把 step 输出存进 SQLite，单 step ~1MB 上限；
          // 500 篇 × 384 维 ≈ 2.5MB 会触发 WorkflowInternalError/SQLITE_TOOBIG。
          // 只让轻量 articles 走 step 输出，embeddings 走 R2，step 后再读回。
          // 只在本次运行里读回一次；R2 桶上的生命周期规则 `expire-datasets` 让 datasets/ 7 天后自动删除
          const embeddingsR2Key = `datasets/${workflowId}/embeddings.json`;
          await this.env.ARTICLES_BUCKET.put(embeddingsR2Key, JSON.stringify(embeddings));

          console.log(`[AutoBrief] 成功构建数据集: ${articles.length} 篇文章 (embeddings 卸载至 ${embeddingsR2Key})`);
          return { articles, embeddings: [], embeddingsR2Key };
          
        } catch (error) {
          console.error('[AutoBrief] 准备数据集失败:', error);
          throw new Error(`数据集准备失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 从 R2 读回 embeddings（它们未走 step 输出以避开 1MB 限制），供聚类使用
      if (dataset.embeddingsR2Key && dataset.embeddings.length === 0) {
        const embObj = await this.env.ARTICLES_BUCKET.get(dataset.embeddingsR2Key);
        dataset.embeddings = embObj ? JSON.parse(await embObj.text()) : [];
        console.log(`[AutoBrief] 从 R2 读回 ${dataset.embeddings.length} 个 embedding`);
      }

      await observability.logStep('prepare_dataset', 'completed', {
        articleCount: dataset.articles.length,
        r2ContentMetrics: {
          fetchAttempts: r2ContentMetrics.r2FetchAttempts,
          fetchSuccesses: r2ContentMetrics.r2FetchSuccesses,
          fetchFailures: r2ContentMetrics.r2FetchFailures,
          qualityFilteredOut: r2ContentMetrics.qualityFilteredOut,
          successRate: r2ContentMetrics.r2FetchAttempts > 0 
            ? ((r2ContentMetrics.r2FetchSuccesses / r2ContentMetrics.r2FetchAttempts) * 100).toFixed(1) + '%'
            : '0%'
        }
      });

      // =====================================================================
      // 步骤 2: 聚类分析 (ML Service)
      // =====================================================================
      await observability.logStep('clustering_analysis', 'started');

      // 优先使用用户传入的 clusteringOptions（来自 generate API 的 body），否则用 BRIEF_CLUSTERING_OPTIONS。
      // 2026-09-05:启发式默认改成直接用 BRIEF_CLUSTERING_OPTIONS。
      //
      // 放在 step **外**：它只是取值，而 step 重放时回调不会再执行，
      // 写在步内的话下面落盘用的 configSent 会是 undefined。
      const effectiveClusteringOptions = clusteringOptions ?? BRIEF_CLUSTERING_OPTIONS;

      const clusteringResult = await step.do('执行聚类分析', defaultStepConfig, async (): Promise<ClusteringResult> => {
        console.log(`[AutoBrief] 开始聚类分析，处理 ${dataset.articles.length} 篇文章`);
        
        // 创建聚类服务实例
        const clusteringService = createClusteringService(this.env, workflowId);
        
        // 聚类只依赖 embedding，给 ml 侧只发 {id, embedding}
        const clusteringDataset = {
          articles: dataset.articles.map(article => ({ id: article.id })),
          embeddings: dataset.embeddings
        };
        
        // effectiveClusteringOptions 在 step 外取值（原因见那里的注释）
        console.log(`[AutoBrief] 使用聚类参数 (${clusteringOptions ? 'user-provided' : 'BRIEF_CLUSTERING_OPTIONS'}):`, JSON.stringify(effectiveClusteringOptions));

        const response = await clusteringService.analyzeClusters(clusteringDataset, effectiveClusteringOptions);
        
        if (!response.success) {
          throw new Error(`聚类分析失败: ${response.error || '未知错误'}`);
        }

        const st = response.data!.statistics;
        console.log(
          `[AutoBrief] 聚类分析完成: ${st.totalClusters} 个真簇 + 1 个噪声组(${st.noisePoints} 篇, ` +
          `占 ${((st.noisePoints / Math.max(st.totalArticles, 1)) * 100).toFixed(0)}%)，噪声组同样作为候选下传`
        );
        return response.data!;
      });

      // clustersFound 用 statistics.totalClusters（已排除噪声组）。此前用 clusters.length，
      // 把 -1 噪声组也算成一个簇，每次多报 1 个。
      await observability.logStep('clustering_analysis', 'completed', {
        clustersFound: clusteringResult.statistics.totalClusters,
        candidateGroupsSentToValidation: clusteringResult.clusters.length,
        totalArticles: clusteringResult.statistics.totalArticles,
        noisePoints: clusteringResult.statistics.noisePoints
      });

      // 观测性：落一份 cluster_id → article_ids 映射到 R2。
      // 簇成员在 workflow 内是临时数据，被毙簇的文章无处可查；持久化后
      // story-validation eval 才能按 cluster_id 取回被拒簇的原文做二审。
      //
      // configSent / configUsed **必须并排记**：2026-09 生产 ml-service 镜像停在 6-25，
      // 聚类算法换了却没生效，三个半月无人发现——病正是这两者不一致，而落盘里一个都没有。
      // 只记其中一个看不出错位。mlStats 只是诊断旁证：statistics 仍从 clusters 自推
      // （原因见 clustering.ts 的 statistics 注释）。
      try {
        await this.env.ARTICLES_BUCKET.put(
          `observability/clustering/${workflowId}.json`,
          JSON.stringify({
            workflowId,
            createdAt: new Date().toISOString(),
            statistics: clusteringResult.statistics,
            configSent: effectiveClusteringOptions,
            configUsed: clusteringResult.configUsed ?? null,
            mlStats: clusteringResult.clusteringStats ?? null,
            buildIdentityCheck: clusteringResult.buildIdentityCheck,
            clusters: clusteringResult.clusters.map(c => ({
              clusterId: c.clusterId,
              articleIds: c.articleIds,
            })),
          }, null, 2)
        );
      } catch (persistErr) {
        console.warn(`[AutoBrief] clustering 映射落盘失败 (workflow=${workflowId}):`, persistErr);
      }

      // ── 文章去向表 ────────────────────────────────────────────────────────
      // 回答业务上最常问的「某件大事为什么没进简报」：一篇文章一条记录，记它走到哪一关、
      // 被哪一关拦下、进了简报的话在哪一块。
      //
      // 刻意**不新增 step**：CF Workflow 单 step 输出约 1MB 上限，上千篇文章的表容易顶上去；
      // 多一个 step 也多一份平台 canceled 的风险。改成在 run() 作用域里随各步结果累积，
      // 最后一次性落 R2。累积用的全部是 step 的**输出**（重放时由引擎回放），故可重放。
      const ARTICLE_JOURNEY_STAGES = ['clustered', 'judged', 'selected', 'written'] as const;
      type ArticleJourneyEntry = {
        clusterId: number | null;
        reachedStage: string;
        droppedAt: string | null;
        dropReason: string | null;
        blockIdx: number | null;
      };
      const articleJourney = new Map<number, ArticleJourneyEntry>();
      const persistArticleJourney = async () => {
        try {
          await this.env.ARTICLES_BUCKET.put(
            `observability/article-journey/${workflowId}.json`,
            JSON.stringify({
              workflowId,
              createdAt: new Date().toISOString(),
              stages: ARTICLE_JOURNEY_STAGES,
              articles: Object.fromEntries(articleJourney),
            }, null, 2)
          );
          console.log(`[AutoBrief] 文章去向表落盘: ${articleJourney.size} 篇`);
        } catch (persistErr) {
          console.warn(`[AutoBrief] 文章去向表落盘失败 (workflow=${workflowId}):`, persistErr);
        }
      };

      // 第 1 关 clustered：记归属簇。-1 噪声桶在簇判定里被显式跳过（`clusterId < 0 continue`），
      // 所以它**就是**这一关的拦下原因，记 noise。
      for (const article of dataset.articles) {
        articleJourney.set(article.id, {
          clusterId: null,
          reachedStage: 'clustered',
          droppedAt: 'clustered',
          dropReason: 'not_in_any_cluster',
          blockIdx: null,
        });
      }
      for (const c of clusteringResult.clusters) {
        for (const id of c.articleIds) {
          const entry = articleJourney.get(id);
          if (!entry) continue; // ml 侧回传了不属于本窗口的 id，忽略
          entry.clusterId = c.clusterId;
          if (c.clusterId < 0) {
            entry.droppedAt = 'clustered';
            entry.dropReason = 'noise';
          } else {
            entry.droppedAt = null;
            entry.dropReason = null;
          }
        }
      }

      // =====================================================================
      // 步骤 3: 故事验证 (AI Worker)
      // =====================================================================
      await observability.logStep('story_validation', 'started');

      // 一簇 = 一份情报报告 = 简报里一块。2026-09-05 起不再切分：聚类换成不降维凝聚后
      // 一簇 ≈ 一件事（两窗人读金标实测簇纯度 0.864/0.913），切分的必要性没有了。
      //
      // 失败不连坐：判定调用失败 → 该簇退化成一块、名字用零 LLM 的主导专名（不丢文章）。
      // 这不是「静默降级成安全默认值」：judgeFailures / pocketFlagged / unsureClusters
      // 都是可判别的信号，正常值为 0，且都进了 observability。
      type StoryBlock = {
        title: string;
        importance: number;
        articleIds: number[];
        storyType: string;
        clusterId: number;
        /** 主线的 covers 一句话，纯观测 */
        covers: string;
        /** 跨簇事件键（块内文章标题的主导专有名词），选择层的同事件配额用它 */
        eventKey: string;
      };
      const validatedStories = await step.do('簇判定', storylineStepConfig, async (): Promise<{
        stories: StoryBlock[];
        judgeCalls: number;
        judgeFailures: number;
        pocketFlagged: number;
        unsureClusters: number;
        cappedBlocks: number;
        droppedArticles: number;
        judgeTitleCapped: number;
        crossClusterMerges: number;
      }> => {
        // 整步重跑留痕：2026-09-03 真实 workflow 实测这一步执行了两遍（每个簇的日志都出现两次），
        // 原因未查明。step.do 不暴露 attempt 序号，故用进入时刻区分两次执行。
        console.log(`[AutoBrief] 簇判定 step 进入 @ ${new Date().toISOString()}`);
        const titleOf = new Map<number, string>();
        for (const a of dataset.articles) titleOf.set(a.id, a.title ?? '');

        // 独立源数：blockImportance 的输入。选择层排序也用它（story-ranking 那边独立再查一次，
        // 这里只为落库的 importance 字段，两边口径相同）。
        const db = getDb(this.env.HYPERDRIVE);
        const srcRows = await db
          .select({ id: $articles.id, sourceId: $articles.sourceId })
          .from($articles)
          .where(inArray($articles.id, dataset.articles.map(a => a.id)));
        const srcOf = new Map<number, number | null>(srcRows.map(r => [r.id, r.sourceId]));
        const distinctSources = (ids: number[]) =>
          new Set(ids.map(i => srcOf.get(i)).filter(x => x != null)).size;

        const aiw = createAIServices(this.env, workflowId).aiWorker;
        const stories: StoryBlock[] = [];
        let judgeCalls = 0;
        let judgeFailures = 0;
        let pocketFlagged = 0;
        let unsureClusters = 0;

        // 块的物化（30 篇截断、算分、事件键）与跨簇同名合并都在 lib/core/cluster-blocks.ts，
        // 抽出去是为了能单测——那两段的失败（判定失败被读成 NO_EVENT、先截后合导致重复采样）
        // 在生产日志里都不显眼。
        const publishedAt = new Map<number, number>();
        for (const a of dataset.articles) {
          const t = Date.parse(a.publishDate);
          if (Number.isFinite(t)) publishedAt.set(a.id, t);
        }

        // ── 逐簇判定：一簇一次调用，同时判「是不是一件事」与起名 ───────────────
        // 2026-09-05 取代 storyline 两段式（命名主线 + 逐篇归类）。前提是聚类换成不降维凝聚
        // （余弦阈值 0.10、最小 3 篇成簇）之后一簇 ≈ 一件事：两窗人读全覆盖金标实测
        // 簇纯度 0.864/0.913、题材袋率 0.072/0.000（旧的 UMAP+HDBSCAN 是 0.354/0.408 与
        // 0.286/0.273）。簇内已经基本只有一件事，就不需要再让模型切分了。
        // 调用量随之从每期 430+ 次（每篇一次归类）降到约 70 次（每簇一次）。
        //
        // NO_EVENT **只标记不丢弃**。让 LLM 毙掉整簇 = 簇级硬门的 LLM 版，全有全无；
        // 零 LLM 的硬门就这么把 8 篇的 NASA 望远镜簇、11 篇的阿富汗驱逐簇整个抹掉过。
        // 而且实测题材袋在 3 篇截断之后只剩 0-5 个、blockScore 全在前 25 之外，
        // 丢与不丢对读者没有差别，先留着看生产数据。
        type Target = { clusterId: number; ids: number[]; judgeIds: number[] };
        const targets: Target[] = [];
        // ml-service 已保证 <3 篇的簇记为噪声；真收到小簇不浪费一次调用，直接成块
        const soloBlocks: PendingBlock[] = [];
        let judgeTitleCapped = 0;
        for (const cluster of clusteringResult.clusters) {
          if (cluster.clusterId < 0) continue; // -1 噪声桶不进简报
          const ids = [...new Set(cluster.articleIds)].filter(id => titleOf.has(id)).sort((x, y) => x - y);
          if (ids.length === 0) continue;
          // ml-service 已保证 <3 篇的簇记为噪声；真收到小簇也不浪费一次调用
          if (ids.length < 2) { soloBlocks.push({ clusterId: cluster.clusterId, title: titleOf.get(ids[0])!, covers: '', ids }); continue; }
          // 判定只喂 PLAN_TITLE_CAP 条标题（按时间等距取样），封住输入规模
          const judgeIds = pickSpreadArticles(ids, publishedAt, PLAN_TITLE_CAP);
          if (judgeIds.length < ids.length) judgeTitleCapped++;
          targets.push({ clusterId: cluster.clusterId, ids, judgeIds });
        }

        // 并发 6：判定实测 1-5 秒/次，6 路约 100-300 rpm，Workers AI 限流 300 rpm 内。
        // ⚠️ processor 内必须自己接住异常：batchProcessParallel 对 rejected 的项只 console.warn
        // 然后**丢弃**，那样这个簇会从结果里整个消失、它的文章静默不进简报。
        const judged = await this.batchProcessParallel(targets, STORYLINE_CONCURRENCY, async (t: Target) => {
          const articles = t.judgeIds.map(id => ({ id, title: titleOf.get(id)! }));
          try {
            let res = await aiw.judgeCluster(articles, t.clusterId);
            if (!res.ok) {
              console.warn(`[AutoBrief] 簇判定：簇 ${t.clusterId} 首次失败，重试一次 — ${res.error}`);
              res = await aiw.judgeCluster(articles, t.clusterId);
            }
            return { t, res };
          } catch (e) {
            return { t, res: { ok: false as const, error: `判定调用抛异常: ${e instanceof Error ? e.message : String(e)}` } };
          }
        });
        judgeCalls += targets.length;
        // 覆盖断言：判定阶段不许吞掉任何簇。丢了就是静默丢内容，宁可整步失败重试。
        if (judged.length !== targets.length) {
          throw new Error(`簇判定：丢失 ${targets.length - judged.length} 个簇（${targets.length} → ${judged.length}），拒绝静默继续`);
        }

        for (const { t, res } of judged) {
          if (!res.ok) {
            console.warn(`[AutoBrief] 簇判定：簇 ${t.clusterId}（${t.ids.length} 篇）判定失败，退化成一块 — ${res.error}`);
          } else if (res.value.verdict !== 'EVENT') {
            console.warn(
              `[AutoBrief] 簇判定：簇 ${t.clusterId}（${t.ids.length} 篇）判为 ${res.value.verdict} — ${res.value.reason}`
            );
          }
        }

        const { pending: judgedBlocks, stats: planStats } = planBlocksFromJudgements(
          judged.map(({ t, res }) => ({ clusterId: t.clusterId, ids: t.ids, res: res as JudgeResult })),
          titleOf
        );
        judgeFailures = planStats.judgeFailures;
        pocketFlagged = planStats.pocketFlagged;
        unsureClusters = planStats.unsureClusters;

        const { blocks, stats: asmStats } = assembleBlocks([...soloBlocks, ...judgedBlocks], {
          publishedAt,
          titleOf,
          distinctSources,
        });
        stories.push(...blocks);
        const { cappedBlocks, droppedArticles, crossClusterMerges } = asmStats;

        console.log(
          `[AutoBrief] 簇判定完成：${stories.length} 块（判定调用 ${judgeCalls} 次，判定失败退化 ${judgeFailures} 簇，` +
            `判为 NO_EVENT ${pocketFlagged} 簇、UNSURE ${unsureClusters} 簇（均只标记不丢弃），` +
            `判定输入超 ${PLAN_TITLE_CAP} 条被取样 ${judgeTitleCapped} 簇，跨簇同名合并 ${crossClusterMerges} 次，` +
            `超 ${DEFAULT_ARTICLE_CAP} 篇被截 ${cappedBlocks} 块共丢 ${droppedArticles} 篇）`
        );
        // 不拒绝整簇：整簇拒绝随 story-validation 一起退役，垃圾簇由选择层的
        // 显著性排序自然沉底（源数少、篇数少 → blockScore 低）。
        return { stories, judgeCalls, judgeFailures, pocketFlagged, unsureClusters,
          cappedBlocks, droppedArticles, judgeTitleCapped, crossClusterMerges };
      });

      // NO_EVENT 率断言。簇判定大面积判「不是单一事件」是上游退化的可判别信号，
      // 而 2026-09-15~09-19 连续五天它一半的簇判成 NO_EVENT（簇退化成单词标题、平均篇数翻倍、
      // 简报质量真实下降），brief_runs.status 却全程 COMPLETED、error 全空，数据只躺在 R2 里没人去看。
      // 阈值 0.15 的依据（生产实测分布，正常与故障之间空得很宽）：
      //   09-15  judgeCalls 73  NO_EVENT 38  52%   旧聚类（镜像没推成功）
      //   09-17  judgeCalls 79  NO_EVENT 43  54%   同上
      //   09-20  judgeCalls 51  NO_EVENT  1   2%   新聚类
      //   09-21  judgeCalls 50  NO_EVENT  1   2%   同上
      //   09-22  judgeCalls 32  NO_EVENT  1   3%   同上
      const NO_EVENT_RATE_ALERT = 0.15;
      const noEventRate = validatedStories.judgeCalls > 0
        ? validatedStories.pocketFlagged / validatedStories.judgeCalls
        : 0;
      const noEventRateDegraded = noEventRate > NO_EVENT_RATE_ALERT;
      if (noEventRateDegraded) {
        console.error(
          `[AutoBrief] NO_EVENT 率超阈值：${(noEventRate * 100).toFixed(1)}%` +
            `（${validatedStories.pocketFlagged}/${validatedStories.judgeCalls} 簇，阈值 ${(NO_EVENT_RATE_ALERT * 100).toFixed(0)}%，正常 2-3%）。` +
            `簇判定大面积判不是单一事件，通常意味着聚类退化或 ml-service 跑的不是预期算法` +
            `（先核 ml-service 版本与聚类参数，再看本次 R2 observability 的簇篇数分布）。本次 run 记 DEGRADED。`
        );
      }

      await observability.logStep('story_validation', noEventRateDegraded ? 'degraded' : 'completed', {
        noEventRate: Number(noEventRate.toFixed(4)),
        noEventRateThreshold: NO_EVENT_RATE_ALERT,
        validStoriesCount: validatedStories.stories.length,
        judgeCalls: validatedStories.judgeCalls,
        judgeFailures: validatedStories.judgeFailures,
        pocketFlagged: validatedStories.pocketFlagged,
        unsureClusters: validatedStories.unsureClusters,
        judgeTitleCapped: validatedStories.judgeTitleCapped,
        cappedBlocks: validatedStories.cappedBlocks,
        droppedArticles: validatedStories.droppedArticles,
        stories: validatedStories.stories,
      });

      // 观测性：写入 brief_stories。delete+insert 保证 step 重试时幂等。
      //
      // 返回插入行的自增主键(按 validatedStories.stories 顺序)：下游 mark_selected_for_intel
      // 要精确标记「被选中送情报分析的那几条」，而 cluster_id 在 2026-08-21 换架构后**不再唯一**
      // （一个簇现在会产出多个故事），按 cluster_id 更新会把该簇的全部故事一并标成已选中。
      // 换架构前 Story 上没有 clusterId、落库恒走 `i + 1`，与故事序号一一对应，是歪打正着。
      const briefStoryRowIds = await step.do('persist:brief_stories_and_rejections', dbStepConfig, async (): Promise<number[]> => {
        const db = getDb(this.env.HYPERDRIVE);
        await db.delete($brief_stories).where(eq($brief_stories.workflow_id, workflowId));
        let insertedIds: number[] = [];
        if (validatedStories.stories.length > 0) {
          const inserted = await db.insert($brief_stories).values(
            validatedStories.stories.map((s: any, i: number) => ({
              workflow_id: workflowId,
              // 2026-08-21：Story 现在带真实来源簇。此前 Story 上根本没有 clusterId 字段，
              // 这里恒走 `i + 1` 兜底 → 落库的 cluster_id 实为**故事序号**，与聚类快照对不上
              // （08-20 生产抽查 7 条全错）。i 保留只为极端兜底，正常不再触发。
              cluster_id: typeof s.clusterId === 'number' ? s.clusterId : i + 1,
              title: s.title ?? null,
              importance: typeof s.importance === 'number' ? s.importance : null,
              article_count: Array.isArray(s.articleIds) ? s.articleIds.length : null,
              article_ids: Array.isArray(s.articleIds) ? s.articleIds : null,
              selected_for_intel: false,
            }))
          ).returning({ id: $brief_stories.id });
          insertedIds = inserted.map(r => r.id);
        }
        return insertedIds;
      });

      // 第 2 关 judged：进了某一块 = 过关。
      // ⚠️ 这一关**没有**「被判官毙掉」这条去向：不拒绝整簇，NO_EVENT / UNSURE
      // 只标记不丢弃（见上方簇判定的注释）。所以过了聚类却不在任何块里，只可能是块物化时
      // 被 DEFAULT_ARTICLE_CAP 截掉或跨簇同名合并时去重掉——两者都发生在「簇判定」step
      // **内部**（assembleBlocks），步外只拿得到合计数 droppedArticles，分不出是哪一种，
      // 故合记为 block_article_cap。
      const judgedPassArticleIds = new Set<number>(
        (validatedStories.stories as any[]).flatMap((s: any) =>
          Array.isArray(s.articleIds) ? (s.articleIds as number[]) : []
        )
      );
      for (const [id, entry] of articleJourney) {
        if (entry.droppedAt) continue;
        if (judgedPassArticleIds.has(id)) {
          entry.reachedStage = 'judged';
        } else {
          entry.droppedAt = 'judged';
          entry.dropReason = 'block_article_cap';
        }
      }

      // =====================================================================
      // 检查故事质量阈值 - 如果没有有效故事则停止工作流
      // =====================================================================
      if (validatedStories.stories.length === 0) {
        const noStoriesReport = {
          workflowId,
          reason: 'INSUFFICIENT_QUALITY_STORIES',
          analysis: {
            totalArticles: dataset.articles.length,
            clustersFound: clusteringResult.statistics.totalClusters,
            validStories: 0
          },
          recommendations: [
            '增加文章数据的时间范围 (timeRangeDays)',
            '调整聚类参数以产生更大的聚类',
            '检查文章质量和多样性'
          ],
          timestamp: new Date().toISOString()
        };

        console.log('[AutoBrief] ❌ 工作流终止：未发现有效故事');
        console.log('[AutoBrief] 📊 详细分析:', JSON.stringify(noStoriesReport.analysis, null, 2));
        console.log('[AutoBrief] 💡 优化建议:', noStoriesReport.recommendations);

        await observability.logStep('workflow_terminated', 'completed', noStoriesReport);

        // 观测性：标记 brief_runs 为 TERMINATED_NO_STORIES
        await step.do('persist:brief_run_terminated', dbStepConfig, async () => {
          const db = getDb(this.env.HYPERDRIVE);
          await db
            .update($brief_runs)
            .set({
              status: 'TERMINATED_NO_STORIES',
              finished_at: new Date(),
              total_articles: dataset.articles.length,
              clusters_found: clusteringResult.statistics.totalClusters,
              stories_identified: 0,
              intelligence_analyses: 0,
            })
            .where(eq($brief_runs.workflow_id, workflowId));
        });

        // 一块都没出的这一期最该有去向表：此时每篇都停在 clustered / judged 两关之一。
        await persistArticleJourney();

        return {
          success: false,
          reason: 'NO_VALID_STORIES_FOUND',
          data: noStoriesReport,
          message: `工作流终止：在 ${dataset.articles.length} 篇文章中未发现符合质量标准的故事。所有 ${clusteringResult.clusters.length} 个聚类都被拒绝。请参考分析报告和优化建议。`
        };
      }

      // 记录故事质量统计
      const storyQualityMetrics = {
        averageImportance: validatedStories.stories.reduce((sum: number, story: any) => sum + story.importance, 0) / validatedStories.stories.length,
        importanceDistribution: validatedStories.stories.reduce((dist: Record<string, number>, story: any) => {
          const range = story.importance >= 8 ? 'high' : story.importance >= 5 ? 'medium' : 'low';
          dist[range] = (dist[range] || 0) + 1;
          return dist;
        }, {}),
        totalArticlesInStories: validatedStories.stories.reduce((sum: number, story: any) => sum + story.articleIds.length, 0)
      };

      console.log('[AutoBrief] ✅ 故事质量检查通过');
      console.log(`[AutoBrief] 📈 故事统计: 平均重要性 ${storyQualityMetrics.averageImportance.toFixed(2)}, 分布: ${JSON.stringify(storyQualityMetrics.importanceDistribution)}`);

      // =====================================================================
      // 步骤 4: 简报块生成 (AI Worker)
      // 报告层与写作层合成一步后，观测只剩 brief_blocks 一条（在下面块生成完成处记），
      // 旧的 intelligence_analysis 随报告层一并退役。
      // =====================================================================

      // story 去重层（story-dedup）与「去重后再分主线」的两段式都已退役：文章级划分下
      // 每篇文章恰好属于一块，块间重复由构造消除，没有可去的重。
      //
      // 这里只补 __briefStoryRowIds：下游 mark_selected_for_intel
      // 落库靠它精确定位主键，不能靠 stories.indexOf。
      validatedStories.stories = validatedStories.stories.map((st: any, i: number) => ({
        ...st, __briefStoryRowIds: [briefStoryRowIds[i]].filter(x => typeof x === 'number'),
      }));

      // 多源覆盖度客观锚：聚类后每个 story 天然知道来自几个独立源。distinct_source_count 是最强的
      // 客观显著性信号(GDELT breaking-news 检测同源)——一个事件被多少家独立媒体报道 ≈ 它多重要，
      // 用来补正 storyValidation 那个一行定义、LLM 纯主观的 importance(1-10)。详见 roadmap 选择层。
      const sourceCoverage = await step.do('compute:source_coverage', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        const allIds: number[] = Array.from(new Set(
          validatedStories.stories.flatMap((s: any) => (Array.isArray(s.articleIds) ? s.articleIds : []) as number[])
        ));
        const cov: Record<number, number> = {};
        if (allIds.length === 0) return cov;
        const rows = await db
          .select({ id: $articles.id, sourceId: $articles.sourceId })
          .from($articles)
          .where(inArray($articles.id, allIds));
        const id2src = new Map(rows.map(r => [r.id, r.sourceId]));
        validatedStories.stories.forEach((s: any, i: number) => {
          const srcs = new Set(
            (Array.isArray(s.articleIds) ? s.articleIds : [])
              .map((id: number) => id2src.get(id))
              .filter((x: any) => x != null)
          );
          cov[i] = srcs.size;
        });
        return cov;
      });

      // 选择分 = LLM importance + 覆盖度加权。打分/排序/取 top-N 抽到 lib/core/story-ranking
      // （纯函数，可独立测）；COVERAGE_WEIGHT 是 NDCG eval 上线前的保守默认，做成参数便于校准。
      const COVERAGE_WEIGHT = 1.0;
      // 同事件配额：分块层按簇独立工作，同一个事件被聚类分到多个簇时会各占多格
      // （2026-09-04 实测尼泊尔洪灾 7 格），超过验收目标 ①「一件大事不刷屏」的 4 格。
      // 超额的**跳过**而不是截断，位置让给后面的其他事件。
      // LLM 重要性排序。**对全部候选跑，不是对选材后的子集**：机械选择分量的是报道热度，
      // 2026-09-20 那期实测最终前 12 里有两条（美批 27 亿乌防空、沙特断供原油）落在机械
      // top-25 之外，接在选材后面就永远看不到它们。
      //
      // 失败不静默降级：拿不到排序就照旧走机械序，但要在日志和观测里响亮地记一笔
      // ——否则「排序没生效」和「排序生效了但结果一样」分不开。
      const llmOrder = await step.do('故事重要性排序', { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '5 minutes' }, async (): Promise<{
        order: number[];
        roundsOk: number;
        intersectionSize: number;
        picks: Array<{ id: number; eventKey: string; category: string; why: string; borda: number; timesSelected: number }>;
        failed?: string;
      }> => {
        const candidates = validatedStories.stories.map((s: any, i: number) => ({
          id: i,
          title: String(s.title ?? '').trim(),
          articles: Array.isArray(s.articleIds) ? s.articleIds.length : 0,
        })).filter(c => c.title.length > 0);
        if (candidates.length < 12) {
          return { order: [], roundsOk: 0, intersectionSize: 0, picks: [], failed: `候选只有 ${candidates.length} 条，不足 12，跳过 LLM 排序` };
        }
        const res = await createAIServices(this.env, workflowId).aiWorker.rankStories(candidates);
        if (!res.ok) {
          return { order: [], roundsOk: 0, intersectionSize: 0, picks: [], failed: res.error };
        }
        return {
          order: res.value.picks.map((p: { id: number }) => p.id),
          roundsOk: res.value.roundsOk,
          intersectionSize: res.value.intersectionSize,
          picks: res.value.picks,
        };
      });
      if (llmOrder.failed) {
        console.warn(`[AutoBrief] ⚠️ LLM 重要性排序未生效，本期退回机械序：${llmOrder.failed}`);
      } else {
        console.log(
          `[AutoBrief] LLM 重要性排序：${llmOrder.order.length} 条进前列（三轮成功 ${llmOrder.roundsOk}/3，三轮交集 ${llmOrder.intersectionSize}）：` +
            llmOrder.picks.slice(0, 5).map(p => `${validatedStories.stories[p.id]?.title}(x${p.timesSelected})`).join('，')
        );
      }
      await observability.logStep('story_rank', llmOrder.failed ? 'failed' : 'completed', {
        candidates: validatedStories.stories.length,
        ranked: llmOrder.order.length,
        roundsOk: llmOrder.roundsOk,
        intersectionSize: llmOrder.intersectionSize,
        error: llmOrder.failed,
      });

      const { ranked, selected: storiesForIntelligence, capped } = rankStoriesForIntelligence(
        validatedStories.stories,
        sourceCoverage,
        {
          coverageWeight: COVERAGE_WEIGHT,
          maxStories: maxStoriesToGenerate,
          perEventCap: PER_EVENT_BLOCK_CAP,
          eventKeyOf: (story) => String((story as { eventKey?: string }).eventKey ?? ''),
          llmOrder: llmOrder.order,
        }
      );
      if (capped.length > 0) {
        console.log(
          `[AutoBrief] 同事件配额（每事件 ≤${PER_EVENT_BLOCK_CAP} 格）挤掉 ${capped.length} 块：` +
            capped.map(x => `${(x.story as { eventKey?: string }).eventKey}/${x.story.title}`).join('，')
        );
      }

      console.log('[AutoBrief] 选择层(importance + 多源覆盖度) top-N:');
      ranked.slice(0, maxStoriesToGenerate).forEach((x, rank) => console.log(
        `  ${rank + 1}. imp=${x.story.importance} 源=${x.srcs} → 分=${x.score.toFixed(2)} | ${x.story.title}`
      ));

      // 第 3 关 selected：排名信息在 ranked 里是完整的（全量候选按分降序），
      // 所以被截断的能记下**真实名次**，不必记 unknown；被同事件配额挤掉的在 capped 里，
      // 两种落选原因分开记——「排不进前 N」和「同一件事已经占满格」对读者是两回事。
      const selectedArticleIds = new Set<number>(
        (storiesForIntelligence as any[]).flatMap((s: any) =>
          Array.isArray(s.articleIds) ? (s.articleIds as number[]) : []
        )
      );
      const cappedStories = new Set<any>(capped.map(x => x.story));
      const rankDropReason = new Map<number, string>();
      ranked.forEach((r, i) => {
        const reason = cappedStories.has(r.story)
          ? `per_event_cap_${PER_EVENT_BLOCK_CAP}`
          : `rank_${i + 1}_beyond_top${maxStoriesToGenerate}`;
        const ids: number[] = Array.isArray((r.story as any).articleIds) ? (r.story as any).articleIds : [];
        for (const id of ids) if (!rankDropReason.has(id)) rankDropReason.set(id, reason);
      });
      for (const [id, entry] of articleJourney) {
        if (entry.droppedAt) continue;
        if (selectedArticleIds.has(id)) {
          entry.reachedStage = 'selected';
          continue;
        }
        entry.droppedAt = 'selected';
        // ranked 覆盖全部候选块，所以正常一定取得到；取不到说明两处口径对不上，标 unknown 不猜。
        entry.dropReason = rankDropReason.get(id) ?? 'unknown';
      }

      // 观测性：标记被选中跑 intel 的 stories
      await step.do('persist:mark_selected_for_intel', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        // 按 brief_stories 的自增主键精确标记。**不能按 cluster_id**：换架构后一个簇会产出
        // 多个故事、共享同一个 cluster_id，按它更新会把整簇的故事都标成已选中，
        // 让 selected_for_intel 虚高（下游观测与 eval 都读这个字段）。
        // 去重层引入后不能再按 stories.indexOf 取主键：合并会重排数组，下标与
        // briefStoryRowIds 不再对应，而条数仍然对得上——下面那个告警根本不会响，
        // 结果是**静默标错行**。故每条 story 自带 __briefStoryRowIds（合并的带全部成员）。
        const selectedRowIds = storiesForIntelligence
          .flatMap((s: any) => (Array.isArray(s.__briefStoryRowIds) ? s.__briefStoryRowIds : []))
          .filter((id: any) => typeof id === 'number');
        // 去重后每条 story 恒好一个主行 id（合并组只留主行），故这里是严格相等而非 <。
        if (selectedRowIds.length !== storiesForIntelligence.length) {
          // 对不上说明插入顺序与 stories 顺序错位，标记会漏/错。宁可显式告警也不静默少标。
          console.warn(
            `[AutoBrief] mark_selected_for_intel: ${storiesForIntelligence.length} 个选中故事只解析出 ` +
            `${selectedRowIds.length} 个 brief_stories 主键，selected_for_intel 可能不完整`
          );
        }
        if (selectedRowIds.length > 0) {
          await db
            .update($brief_stories)
            .set({ selected_for_intel: true })
            .where(
              and(
                eq($brief_stories.workflow_id, workflowId),
                inArray($brief_stories.id, selectedRowIds)
              )
            );
        }
      });

      // 【简报块 v6 · 每故事一个 step】簇原文 → 一块 3–5 句、逐句带出处的高管简报
      // （ai-worker /meridian/brief-block-v6）。2026-09-21 取代「报告层 v3 + 写作层 v3」两步：
      // 标重点 → 写作 → 补出处全在端点内部完成，backend 侧只剩这一个 step。
      //
      // fan-out 必须留在 backend：CF 侧约 2% 的 invocation 会被平台 canceled，N 次调用挤进
      // 一个 step 就是「一次抖动丢整期」。
      //
      // ⚠️ step 返回值里**不许**带端点响应的 `sentences`（切句表 = 整簇原文，一个簇几百句）：
      // CF Workflow 单 step 输出约 1MB 上限，十几个块就是几 MB。只带写出来的那 3–5 句。
      console.log(`[AutoBrief] 开始生成简报块（brief-block-v6）：从 ${validatedStories.stories.length} 个候选故事中选取 top-${storiesForIntelligence.length}`);

      // 与旧报告层同档（不是与旧写作层同档）：v6 一个簇 4 个窗口实测约 70 秒，大簇更久。
      const briefBlockStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' },
        timeout: '15 minutes',
      };
      // 不让 N 路同时打 provider，撞限流由 AIGateway 配额退避兜底。
      const BRIEF_BLOCK_CONCURRENCY = 6;

      // 独立源数按 story 对象取：sourceCoverage 的键是 validatedStories.stories 的下标，
      // 而 storiesForIntelligence 是排序 + 配额之后的子集，下标对不上。
      const sourcesOf = new Map<any, number>(
        validatedStories.stories.map((s: any, i: number) => [s, sourceCoverage[i] ?? 0])
      );

      // 分层必须在**写作之前**：tier 决定篇幅（brief 档只写 1–2 句），端点要先知道这块是哪一档。
      // 分层规则（纯函数，见 lib/core/brief-v3.ts）：按「独立源数 × 篇数」降序，
      // 前 4 头条 / 接着 10 要闻 / 其余简讯。
      //
      // ⚠️ 篇数口径与旧代码不同：旧代码用 withBody.length（R2 里真取到正文的篇数），那要等到
      // 块 step 内部才知道，写作前拿不到。这里改用 story.articleIds.length。
      // articleIds.length ≥ withBody.length，所以个别簇的分数会略高、可能跨过档位边界。
      // **这是本轮有意接受的偏差**（契约 §修改二）。源数的钳位同理改用 articleIds.length。
      //
      // LLM 排序生效时 preserveOrder=true：选择层已经把 LLM 序（前 12）与机械序（其余）
      // 拼好，这里再按「源数 × 篇数」重排会把它整个盖掉。排序未生效（三轮全败）时退回
      // 旧的重排行为，保持与老链路一致。
      const tierPlan = assignTiers(
        (storiesForIntelligence as any[]).map((s: any, i: number) => {
          const articles = Math.max(1, Array.isArray(s.articleIds) ? s.articleIds.length : 0);
          return { idx: i, articles, sources: Math.max(1, Math.min(sourcesOf.get(s) ?? 1, articles)) };
        }),
        { preserveOrder: llmOrder.order.length > 0 }
      );
      const planOf = new Map<number, (typeof tierPlan)[number]>(tierPlan.map((p) => [p.idx, p]));
      console.log(
        `[AutoBrief] 分层（写作前）：头条 ${tierPlan.filter((x) => x.tier === 'lead').length} / ` +
          `要闻 ${tierPlan.filter((x) => x.tier === 'more').length} / ` +
          `简讯 ${tierPlan.filter((x) => x.tier === 'brief').length}` +
          `（分 = 源数 × 篇数，篇数取 articleIds：${tierPlan.slice(0, 5).map((x) => `${x.score}`).join(',')}…）`
      );

      type WrittenBlock = {
        idx: number;
        clusterId: number | null;
        /** 渲染用标题：继续用 story.title，与管理页/验收的对账口径不变 */
        blockTitle: string;
        /** v6 自己起的块标题，只进观测，不进正文 */
        v6Title: string;
        /** 真正喂进端点的篇数（R2 取到正文的那些） */
        articles: number;
        /** 分层用的三元组：篇数取 articleIds.length，故与上面的 articles 可能差一两篇 */
        tierArticles: number;
        sources: number;
        tier: Tier;
        score: number;
        text: string;
        /** 写出来的 3–5 句，每句带出处。小，可以跨 step 传 */
        sentences: BriefBlockV6Sentence[];
        anchors: number;
        windows: number;
        windowFailures: number;
        citationsRepaired: number;
        /** 写作步被确定性校验拒收的原因（`#尝试次 原因码…`）。空数组 = 一次过。 */
        writeRejects: string[];
        llmCalls: number;
        neurons: number;
      };
      type BlockOutcome = { block: WrittenBlock } | { failure: { idx: number; title: string; reason: string } };

      // 取正文失败的跨块合计，按原因分因（进 brief_blocks 的 logStep）。
      // 正常值全 0；非 0 说明块是拿不全的材料写出来的。
      const blockContentFailures: Record<string, number> = {};
      const countContentFailures = (items: Array<{ contentStatus: string }>) => {
        const byReason: Record<string, number> = {};
        for (const a of items) {
          if (a.contentStatus === 'OK') continue;
          byReason[a.contentStatus] = (byReason[a.contentStatus] ?? 0) + 1;
          blockContentFailures[a.contentStatus] = (blockContentFailures[a.contentStatus] ?? 0) + 1;
        }
        return byReason;
      };

      const writeOneBlock = async (story: any, idx: number): Promise<BlockOutcome> => {
        try {
          const clusterArticles = await this.getArticleContents(story.articleIds, dataset);
          const withBody = clusterArticles.filter((a) => a.contentStatus === 'OK');
          const failuresByReason = countContentFailures(clusterArticles);
          if (withBody.length === 0) {
            return { failure: { idx, title: story.title, reason: `簇内没有一篇文章取到正文（${JSON.stringify(failuresByReason)}）` } };
          }
          if (withBody.length < clusterArticles.length) {
            // 取不到正文的被丢掉，而块只能从剩下的里写。不留痕就只剩"这块怎么少了半件事"。
            console.warn(
              `[AutoBrief] 块材料不全 (idx=${idx}, "${story.title}"): ` +
              `${clusterArticles.length} 篇里只有 ${withBody.length} 篇取到正文，失败分因 ${JSON.stringify(failuresByReason)}`
            );
          }
          const aiw = createAIServices(this.env, workflowId).aiWorker;
          const plan = planOf.get(idx);
          if (!plan) {
            // 分层表按 storiesForIntelligence 的下标建，取不到说明两处口径对不上。宁可失败也不猜档位。
            return { failure: { idx, title: story.title, reason: `分层表里没有 idx=${idx}` } };
          }
          const res = await aiw.briefBlockV6(
            withBody.map((a) => ({ id: a.id, title: a.title, publishDate: a.publishDate, content: a.content })),
            plan.tier,
            idx
          );
          if (!res.ok) {
            console.error(`[AutoBrief] 简报块生成失败 (idx=${idx}, "${story.title}"): ${res.error}`);
            return { failure: { idx, title: story.title, reason: res.error } };
          }
          const v = res.value;
          // verdict=not_a_single_event：端点判这一簇不是一件事、不出块。按**块失败**处置
          // （不进正文、进失败清单），与块写作失败同一条路。
          if (v.verdict !== 'written' || !v.block) {
            const reason = `not_a_single_event: ${v.reason ?? '（端点未给原因）'}`;
            console.warn(`[AutoBrief] 简报块未出块 (idx=${idx}, "${story.title}"): ${reason}`);
            return { failure: { idx, title: story.title, reason } };
          }
          // renderBriefV3 要一段 text，而端点给的是结构化句子数组。exec 档本来就是一段话，直接拼。
          const text = v.block.sentences.map((s) => s.text).join(' ').trim();
          if (!text) {
            return { failure: { idx, title: story.title, reason: '端点回了 written 但正文为空' } };
          }
          const t = v.trace;
          return {
            block: {
              idx,
              clusterId: typeof story.clusterId === 'number' ? story.clusterId : null,
              blockTitle: String(story.title ?? ''),
              v6Title: String(v.block.title ?? ''),
              articles: withBody.length,
              // 分层（写作前）算出来的三元组，原样带下来——不要再按 withBody 重算，
              // 否则记录里的 score 与真正决定篇幅的那个分数对不上。
              tierArticles: plan.articles,
              sources: plan.sources,
              tier: plan.tier,
              score: plan.score,
              text,
              sentences: v.block.sentences,
              anchors: t.anchors,
              windows: t.windows,
              windowFailures: t.windowFailures,
              citationsRepaired: t.citationsRepaired,
              writeRejects: Array.isArray(t.writeRejects) ? t.writeRejects : [],
              llmCalls: t.llmCalls,
              neurons: t.neurons,
            },
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[AutoBrief] 简报块生成异常 (idx=${idx}): ${reason}`);
          return { failure: { idx, title: story.title, reason } };
        }
      };

      const blockOutcomes = await this.batchProcessParallel(
        storiesForIntelligence,
        BRIEF_BLOCK_CONCURRENCY,
        (story: any, idx: number): Promise<BlockOutcome> =>
          step
            .do(`简报块:${idx}`, briefBlockStepConfig, () => writeOneBlock(story, idx))
            // 重试耗尽后 step 会 reject，而 batchProcessParallel 用 allSettled 且只 console.warn
            // ——不接住的话这个故事会静默消失。
            .catch((e: unknown): BlockOutcome => {
              const reason = `step 重试耗尽: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`[AutoBrief] 简报块 step 最终失败 (idx=${idx}, "${story.title}"): ${reason}`);
              return { failure: { idx, title: story.title, reason } };
            })
      );

      const writtenBlocks = blockOutcomes
        .filter((r): r is { block: WrittenBlock } => 'block' in r)
        .map((r) => r.block);
      const blockFailures = blockOutcomes
        .filter((r): r is { failure: { idx: number; title: string; reason: string } } => 'failure' in r)
        .map((r) => r.failure);

      if (writtenBlocks.length === 0) {
        throw new Error(`全部 ${storiesForIntelligence.length} 个故事的简报块生成都失败（详见上方各块错误日志）`);
      }

      // =====================================================================
      // 步骤 5: 分层 → 拼装（v3 渲染）
      // =====================================================================
      await observability.logStep('brief_generation', 'started');

      // 分层已经在写作之前算好（tier 决定篇幅），这里只按分层顺序把**出了块的**挑出来。
      // 不要再对写完的块跑一次 assignTiers——那会用另一套输入重新分档，与实际写作用的档位脱节。
      // 代价：若排在前面的故事写块失败，头条那一节会少于 4 条（旧写法是从成功的块里补满）。
      const blockByIdx = new Map<number, WrittenBlock>(writtenBlocks.map((b) => [b.idx, b]));
      const tiered = tierPlan
        .map((p) => blockByIdx.get(p.idx))
        .filter((b): b is WrittenBlock => b !== undefined);
      const tierCount = (t: string) => tiered.filter((x) => x.tier === t).length;
      console.log(
        `[AutoBrief] 分层（出块后实际入节）：头条 ${tierCount('lead')} / 要闻 ${tierCount('more')} / 简讯 ${tierCount('brief')}`
      );
      console.log(
        `[AutoBrief] 简报块完成: ${writtenBlocks.length}/${storiesForIntelligence.length}` +
          (blockFailures.length ? `，${blockFailures.length} 个块失败` : '') +
          `，重点合计 ${writtenBlocks.reduce((n, b) => n + b.anchors, 0)}` +
          `，窗口失败合计 ${writtenBlocks.reduce((n, b) => n + b.windowFailures, 0)}` +
          `，补出处 ${writtenBlocks.reduce((n, b) => n + b.citationsRepaired, 0)} 处`
      );
      // 报告层与写作层合并成一步后，观测也合并成这一条（旧的 intelligence_analysis 随报告层退役）。
      await observability.logStep('brief_blocks', blockFailures.length > 0 ? 'degraded' : 'completed', {
        path: 'brief-block-v6',
        expected: storiesForIntelligence.length,
        written: writtenBlocks.length,
        failedCount: blockFailures.length,
        failures: blockFailures,
        /** 取正文失败分因合计（正常全 0）；空串不再当"取到了" */
        contentFetchFailures: blockContentFailures,
        tiers: { lead: tierCount('lead'), more: tierCount('more'), brief: tierCount('brief') },
        anchors: writtenBlocks.reduce((n, b) => n + b.anchors, 0),
        windows: writtenBlocks.reduce((n, b) => n + b.windows, 0),
        windowFailures: writtenBlocks.reduce((n, b) => n + b.windowFailures, 0),
        citationsRepaired: writtenBlocks.reduce((n, b) => n + b.citationsRepaired, 0),
        writeRejects: writtenBlocks.reduce((n, b) => n + b.writeRejects.length, 0),
        llmCalls: writtenBlocks.reduce((n, b) => n + b.llmCalls, 0),
        neurons: Math.round(writtenBlocks.reduce((n, b) => n + b.neurons, 0)),
      });

      // 第 4 关 written：一块 = 一个被选中的 story，两者用同一个 idx（storiesForIntelligence
      // 的下标）串起来。走到这里还没被拦下的文章，去向只有两种：块生成失败、进了某一块。
      // （报告层退役后不再有 report_generation_failed 这条去向，统一记 block_write_failed。）
      // blockIdx 取它在 tiered 里的位置——renderBriefV3 就是按这个顺序渲染的，
      // 所以它就是读者看到的块序。
      const blockIdxByStoryIdx = new Map<number, number>();
      tiered.forEach((b, k) => blockIdxByStoryIdx.set(b.idx, k));
      const storyIdxByArticle = new Map<number, number>();
      (storiesForIntelligence as any[]).forEach((s: any, i: number) => {
        const ids: number[] = Array.isArray(s.articleIds) ? s.articleIds : [];
        for (const id of ids) if (!storyIdxByArticle.has(id)) storyIdxByArticle.set(id, i);
      });
      for (const [id, entry] of articleJourney) {
        if (entry.droppedAt) continue;
        const storyIdx = storyIdxByArticle.get(id);
        if (storyIdx === undefined) {
          // 上一关判它进了选择层，这一关却找不到归属块，说明两处口径对不上。宁可标 unknown 也不猜。
          entry.droppedAt = 'written';
          entry.dropReason = 'unknown';
          continue;
        }
        const blockIdx = blockIdxByStoryIdx.get(storyIdx);
        if (blockIdx === undefined) {
          entry.droppedAt = 'written';
          entry.dropReason = 'block_write_failed';
          continue;
        }
        entry.reachedStage = 'written';
        entry.blockIdx = blockIdx;
      }

      await persistArticleJourney();

      // 拼装：三节 markdown 全由代码渲染（见 lib/core/brief-v3.ts），唯一的调用是给整篇起标题。
      const briefAssembleStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      // 条目标题小写是本简报的 house style（renderBriefV3 里做）。记录里存的必须是**读者看到的那个**，
      // 否则管理页/验收拿记录去对正文会对不上（2026-09-12 M3 就挂在这里）。
      const displayTitle = (t: string) => t.trim().toLowerCase();
      const rendered = renderBriefV3(
        tiered.map((b) => ({ title: displayTitle(b.blockTitle), text: b.text, tier: b.tier }))
      );
      const titled = await step.do('简报标题', briefAssembleStepConfig, async () => {
        const aiw = createAIServices(this.env, workflowId).aiWorker;
        const r = await aiw.briefTitle(rendered.content);
        if (!r.ok) throw new Error(`简报标题生成失败: ${r.error}`);
        return r.value;
      });
      const assembled = {
        title: titled.title,
        content: rendered.content,
        model_used: 'glm-4.7-flash (brief-block-v6)',
      };

      // 每期一份 v3 记录：分层、每块的正文/出处与成本。管理页读它，验收（accept.ts M3）也读它。
      // 失败的块以 ok:false 留在记录里——不写进正文，但绝不静默消失。失败的块没有正文，
      // 故单列在成功块之后（它其实有 tier/score，只是没写出东西来）。
      try {
        await this.env.ARTICLES_BUCKET.put(
          `observability/brief-v3/${workflowId}.json`,
          JSON.stringify(
            {
              workflowId,
              createdAt: new Date().toISOString(),
              title: assembled.title,
              sections: rendered.sections,
              blocks: [
                ...tiered.map((b) => ({
                  clusterId: b.clusterId,
                  storyIdx: b.idx,
                  title: displayTitle(b.blockTitle),
                  /** v6 自己起的标题，与上面那个渲染用标题并排存，便于回看两者差多少 */
                  v6Title: b.v6Title,
                  tier: b.tier,
                  articles: b.articles,
                  /** 分层用的篇数（articleIds.length），score = tierArticles × sources */
                  tierArticles: b.tierArticles,
                  sources: b.sources,
                  score: b.score,
                  ok: true,
                  text: b.text,
                  /** 逐句出处：句子 → [{articleId, sentence}]，出处校验读它 */
                  sentences: b.sentences,
                  anchors: b.anchors,
                  windows: b.windows,
                  windowFailures: b.windowFailures,
                  citationsRepaired: b.citationsRepaired,
                  writeRejects: b.writeRejects,
                  llmCalls: b.llmCalls,
                  neurons: b.neurons,
                })),
                ...blockFailures.map((f) => ({
                  storyIdx: f.idx,
                  title: displayTitle(String(f.title ?? '')),
                  ok: false,
                  error: f.reason,
                })),
              ],
            },
            null,
            1
          )
        );
      } catch (persistErr) {
        console.warn(`[AutoBrief] v3 记录落盘失败 (workflow=${workflowId}):`, persistErr);
      }

      console.log(
        `[AutoBrief] 成功生成简报: ${assembled.title}（${assembled.content.length} 字符，${rendered.sections} 节）`
      );

      // 5d 摘要：读者端展示的散文导语。与拼装分开成 step，
      // 是为了让"简报正文已经生成好了"这件事不被摘要环节的失败拖累。
      const briefSummaryStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      const summaries = await step.do('简报摘要', briefSummaryStepConfig, async () => {
        const aiServices = createAIServices(this.env, workflowId);
        // 读者端展示用的散文摘要。刻意 best-effort：摘要只影响读者端标题下那一段的显示，
        // 为它整步失败、丢掉一份已经生成好的简报是不划算的。失败留 null，前端自然不渲染。
        const tldrProse = await aiServices.aiWorker.generateBriefSummary(assembled.title, assembled.content);
        if (!tldrProse.ok) {
          console.warn(`[AutoBrief] 散文摘要生成失败（不阻断简报）: ${tldrProse.error}`);
        }
        return { tldrProse: tldrProse.ok ? tldrProse.value.tldrProse : null };
      });

      // used_articles 是真正喂进简报的去重文章数 = 出了块的那些 story 的 articleIds 并集
      // （失败的 story 不算，它没进简报）。failures[].idx 是 storiesForIntelligence 的
      // 全局下标（batchProcessParallel 传的是 i + batchIndex）。
      // ⚠️ 语义变更：reports 表 51-59 期存的仍是旧值（故事数），跨期比较需注意。
      const failedIdx = new Set(blockFailures.map(f => f.idx));
      const usedArticleIds = new Set<number>(
        storiesForIntelligence
          .filter((_: any, i: number) => !failedIdx.has(i))
          .flatMap((s: any) => (Array.isArray(s.articleIds) ? s.articleIds : []))
      );

      const briefResult: BriefGenerationResultData = {
        title: assembled.title,
        content: assembled.content,
        tldrProse: summaries.tldrProse,
        stats: {
          total_articles: dataset.articles.length,
          used_articles: usedArticleIds.size,
          clusters_found: clusteringResult.statistics.totalClusters,
          stories_identified: validatedStories.stories.length,
          // 字段名沿用（reports 表与管理页读它）：报告层退役后它的口径是"出了块的故事数"
          intelligence_analyses: writtenBlocks.length,
          content_length: assembled.content.length,
          model_used: assembled.model_used,
        },
      };

      await observability.logStep('brief_generation', 'completed', briefResult.stats);

      // =====================================================================
      // 步骤 6: 保存简报到数据库
      // =====================================================================
      await observability.logStep('save_brief', 'started');
      
      const reportId = await step.do('保存简报', dbStepConfig, async (): Promise<number> => {
        try {
          const db = getDb(this.env.HYPERDRIVE);

          // usedSources 必须和 used_articles 同一个文章集合口径：出了块的 story 的 articleIds
          // 并集（失败的 story 不算），复用外层已算好的 usedArticleIds，不再对全部候选 story 重算。
          let usedSources = 0;
          if (usedArticleIds.size > 0) {
            const usedSourcesResult = await db
              .selectDistinct({ count: sql<number>`count(distinct ${$articles.sourceId})` })
              .from($articles)
              .where(inArray($articles.id, Array.from(usedArticleIds)));
            usedSources = usedSourcesResult[0]?.count || 0;
          }
          
          const insertResult = await db
            .insert($reports)
            .values({
              title: briefResult.title,
              content: briefResult.content,
              usedArticles: briefResult.stats.used_articles,
              usedSources: usedSources,
              tldr_prose: briefResult.tldrProse,
            })
            .returning({ id: $reports.id });

          const reportId = insertResult[0]?.id;
          if (!reportId) {
            throw new Error('简报保存失败：未返回ID');
          }

          console.log(`[AutoBrief] 简报已保存到数据库，ID: ${reportId}`);
          return reportId;
        } catch (error) {
          console.error('[AutoBrief] 保存简报失败:', error);
          throw new Error(`数据库保存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      await observability.logStep('save_brief', 'completed', { reportId });

      // 读者端「事件追踪」：把今天的 story 归并到跨期线索上。
      //
      // best-effort：归并只影响 /stories 两个页面，简报本身已经落库了，
      // 为它把整个工作流判失败不划算。失败时这批 story 的 story_cluster_id 留空，
      // 下次跑（或补跑 scripts/assign-story-clusters.ts）会重新捡起来——
      // 归并按 story_cluster_id IS NULL 选行，天然可续。
      await step.do('persist:story_clusters', dbStepConfig, async () => {
        try {
          const db = getDb(this.env.HYPERDRIVE);
          const stats = await assignStoryClustersForWorkflow(db, workflowId);
          console.log(
            `[AutoBrief] 事件追踪归并: 入选 ${stats.briefed} 条 → 并入 ${stats.joined} · ` +
            `新建 ${stats.created} · 候选挂靠 ${stats.attachedCandidates}`
          );
        } catch (error) {
          console.warn('[AutoBrief] 事件追踪归并失败（不阻断工作流）:', error);
        }
      });

      // 观测性：标记 brief_runs 完成状态并填充全部统计。
      // 有可对账的局部失败 → DEGRADED 而非 COMPLETED，使"头条静默消失""簇大面积判不是事件"
      // 这类在 DB status 层就可见（不只在 R2 step metrics），便于监控/巡检。
      // ⚠️ 新的降级信号一律并进 degradedReasons，**不要再开第二处 status 赋值**，否则口径分叉。
      const degradedReasons = [
        ...(blockFailures.length > 0 ? [`块生成失败 ${blockFailures.length} 个（选中 ${storiesForIntelligence.length}）`] : []),
        ...(noEventRateDegraded
          ? [`NO_EVENT 率 ${(noEventRate * 100).toFixed(1)}%（${validatedStories.pocketFlagged}/${validatedStories.judgeCalls}）超阈值 ${(NO_EVENT_RATE_ALERT * 100).toFixed(0)}%`]
          : []),
        // ml 镜像身份：missing = 跑的是旧镜像（2026-09-15~19 连续五天跑旧算法、status 全程 COMPLETED
        // 的那种）。not_injected 是本地直起服务（replay 即此），不算降级。
        ...(clusteringResult.buildIdentityCheck.status === 'missing'
          ? [`ml 镜像身份 ${clusteringResult.buildIdentityCheck.status}：${clusteringResult.buildIdentityCheck.detail}`]
          : []),
      ];
      if (degradedReasons.length > 0) {
        console.error(`[AutoBrief] 本次 run 记 DEGRADED：${degradedReasons.join('；')}`);
      }
      await step.do('persist:brief_run_complete', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        await db
          .update($brief_runs)
          .set({
            status: degradedReasons.length > 0 ? 'DEGRADED' : 'COMPLETED',
            finished_at: new Date(),
            report_id: reportId,
            total_articles: briefResult.stats.total_articles,
            clusters_found: briefResult.stats.clusters_found,
            stories_identified: briefResult.stats.stories_identified,
            intelligence_analyses: briefResult.stats.intelligence_analyses,
            brief_content_length: briefResult.stats.content_length,
          })
          .where(eq($brief_runs.workflow_id, workflowId));
      });

      // =====================================================================
      // 完成工作流
      // =====================================================================
      await observability.logStep('workflow_complete', 'completed', {
        reportId,
        title: briefResult.title,
        contentLength: briefResult.content.length,
        tldrProseLength: briefResult.tldrProse?.length || 0,
        stats: briefResult.stats
      });

      // 保存可观测性数据到R2存储
      await observability.complete();

      console.log(`[AutoBrief] 端到端简报生成工作流完成! 报告ID: ${reportId}, 标题: ${briefResult.title}`);

      return {
        success: true,
        data: {
          reportId,
          title: briefResult.title,
          contentLength: briefResult.content.length,
          stats: briefResult.stats
        }
      };

    } catch (error) {
      console.error('[AutoBrief] 工作流执行失败:', error);
      await observability.fail(error instanceof Error ? error.message : String(error));

      // 观测性：标记 brief_runs 为 FAILED。step.do 防止本身抖动；失败也不再 throw
      try {
        await step.do('persist:brief_run_failed', dbStepConfig, async () => {
          const db = getDb(this.env.HYPERDRIVE);
          await db
            .update($brief_runs)
            .set({
              status: 'FAILED',
              finished_at: new Date(),
              error: error instanceof Error ? error.message : String(error),
            })
            .where(eq($brief_runs.workflow_id, workflowId));
        });
      } catch (persistErr) {
        console.error('[AutoBrief] 标记 brief_runs FAILED 失败:', persistErr);
      }

      throw error;
    }
  }
}
