import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/database';
import { $articles, $reports, $sources, $brief_runs, $brief_stories, $cluster_rejections, gte, lte, isNotNull, isNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { assignStoryClustersForWorkflow } from '../lib/story-clusters';
import { DEFAULT_ARTICLE_CAP, pickSpreadArticles } from '../lib/core/story-dedup';
import {
  assembleBlocks,
  planBlocksFromJudgements,
  type JudgeResult,
  type PendingBlock,
} from '../lib/core/cluster-blocks';
import {
  blockImportance,
  dominantEntity,
  PER_EVENT_BLOCK_CAP,
} from '../lib/core/storyline';
import { BRIEF_CLUSTERING_OPTIONS } from '../lib/core/constants';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/observability/dataflow';
import { createClusteringService, type ArticleDataset, type ClusteringResult } from '../lib/services/clustering';
import { createAIServices } from '../lib/services/ai-services';
import { generateSearchText } from '../lib/core/utils';
import { looksLikeExtractionFailure } from '../lib/core/extraction-quality';
import { rankStoriesForIntelligence } from '../lib/core/story-ranking';
import { assignTiers, renderBriefV3 } from '../lib/core/brief-v3';
import type { Env } from '../index';

// ============================================================================
// 数据接口定义 - 轻量级版本，避免SQLITE_TOOBIG错误
// ============================================================================

interface ArticleRecord {
  id: number;
  title: string;
  url: string;
  contentFileKey?: string | null;
  publish_date: Date | null;
  embedding?: number[] | null;
  // 从 processArticles 工作流存储的分析结果字段
  language?: string | null;
  primary_location?: string | null;
  completeness?: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS' | null;
  content_quality?: 'OK' | 'LOW_QUALITY' | 'JUNK' | null;
  event_summary_points?: string[] | null;
  thematic_keywords?: string[] | null;
  topic_tags?: string[] | null;
  key_entities?: string[] | null;
  content_focus?: string[] | null;
}

// 轻量级数据集接口 - 不包含完整内容，只保留引用
interface LightweightArticleDataset {
  articles: Array<{
    id: number;
    title: string;
    contentFileKey: string;  // R2存储引用
    publishDate: string;
    url: string;
    summary: string;
    // 可选的内容摘要信息，用于质量评估
    contentLength?: number;
    hasValidContent?: boolean;
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
  minImportance?: number;
  
  // 简化的配置参数
  articleLimit?: number;
  timeRangeDays?: number;
  
  // 聚类配置选项
  clusteringOptions?: {
    umapParams?: {
      n_neighbors?: number;
      n_components?: number;
      min_dist?: number;
      metric?: string;
    };
    hdbscanParams?: {
      min_cluster_size?: number;
      min_samples?: number;
      epsilon?: number;
    };
    clusteringAlgorithm?: string;
    agglomerativeThreshold?: number;
    agglomerativeLinkage?: string;
    agglomerativeMinClusterSize?: number;
  };
  
  // 业务控制参数
  maxStoriesToGenerate?: number;
  storyMinImportance?: number;
  skipFaithfulnessGate?: boolean; // 测试迭代跳过忠实度门(省 ~3min);生产 cron 省略=默认跑门
}

// 简报生成结果接口
interface BriefGenerationResultData {
  title: string;
  content: string;
  tldr: string;
  /** 面向读者的散文摘要；生成失败时为 null（不阻断简报落库） */
  tldrProse: string | null;
  model_author: string;
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
    url: string;
    summary: string;
  }>> {
      console.log(`[AutoBrief] 开始并行获取 ${articleIds.length} 篇文章内容，批量大小: ${R2_BATCH_SIZE}`);
  
  // 过滤出有效的文章信息
  const validArticleInfos = articleIds
    .map(articleId => lightweightDataset.articles.find(a => a.id === articleId))
    .filter((article): article is NonNullable<typeof article> => !!article);
  
  console.log(`[AutoBrief] 有效文章信息: ${validArticleInfos.length} 篇`);
  
  // 并行处理函数
  const processArticle = async (lightweightArticle: typeof validArticleInfos[0], index: number) => {
    try {
      const contentObject = await this.env.ARTICLES_BUCKET.get(lightweightArticle.contentFileKey);
      const content = contentObject ? await contentObject.text() : '';
      
      return {
        id: lightweightArticle.id,
        title: lightweightArticle.title,
        content: content,
        publishDate: lightweightArticle.publishDate,
        url: lightweightArticle.url,
        summary: lightweightArticle.summary
      };
    } catch (error) {
      console.warn(`[AutoBrief] 获取文章内容失败 (ID: ${lightweightArticle.id}):`, error);
      // 使用空内容作为回退
      return {
        id: lightweightArticle.id,
        title: lightweightArticle.title,
        content: '',
        publishDate: lightweightArticle.publishDate,
        url: lightweightArticle.url,
        summary: lightweightArticle.summary
      };
    }
  };

  // 使用批量并行处理，控制并发数量
  const articlesWithContent = await this.batchProcessParallel(
    validArticleInfos,
    R2_BATCH_SIZE, // 使用配置的批量大小
    processArticle
  );
  
  console.log(`[AutoBrief] 并行获取文章内容完成: ${articlesWithContent.length} 篇`);
    return articlesWithContent;
  }
  
  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      article_ids = [],
      triggeredBy = 'system', 
      dateFrom, 
      dateTo, 
      minImportance = 3,
      
      articleLimit = 30, // 降低默认限制以避免SQLITE_TOOBIG错误
      timeRangeDays = 2,
      clusteringOptions,
      maxStoriesToGenerate = 25,
      storyMinImportance = 0.1,
      skipFaithfulnessGate = false
    } = event.payload;

    // 使用 Cloudflare Workflow 实例的真实ID，而不是自生成的UUID
    const workflowId = event.instanceId;
    const observability = createWorkflowObservability(workflowId, this.env);
    
    await observability.logStep('workflow_start', 'started', {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      minImportance,
      customClusteringOptions: !!clusteringOptions,
      maxStoriesToGenerate,
      storyMinImportance,
      article_ids_provided: article_ids.length
    });

    // 观测性：写入 brief_runs(status=RUNNING)。step.do 包裹保证重试时幂等（workflow_id unique）
    await step.do('persist:brief_run_start', dbStepConfig, async () => {
      const db = getDb(this.env.HYPERDRIVE);
      await db
        .insert($brief_runs)
        .values({
          workflow_id: workflowId,
          trace_id: workflowId,
          status: 'RUNNING',
          triggered_by: triggeredBy,
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
      let validArticlesCount = 0;
      
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
               url: $articles.url,
               contentFileKey: $articles.contentFileKey,
               publish_date: $articles.publishDate,
               embedding: $articles.embedding,
               // 获取已分析的数据字段
               language: $articles.language,
               primary_location: $articles.primary_location,
               completeness: $articles.completeness,
               content_quality: $articles.content_quality,
               event_summary_points: $articles.event_summary_points,
               thematic_keywords: $articles.thematic_keywords,
               topic_tags: $articles.topic_tags,
               key_entities: $articles.key_entities,
               content_focus: $articles.content_focus,
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

          // 验证嵌入向量有效性
          const validArticles = queryResult.filter(row => 
            Array.isArray(row.embedding) && row.embedding.length === 384
          );
          
          validArticlesCount = validArticles.length; // 保存到外部变量
          
          if (queryResult.length !== validArticles.length) {
            console.warn(`[AutoBrief] 过滤掉 ${queryResult.length - validArticles.length} 篇无效嵌入向量的文章`);
          }

          if (validArticles.length < 2) {
            throw new Error(`文章数量不足进行聚类分析 (获取到 ${validArticles.length} 篇, 需要至少 2 篇)`);
          }

          // 从 R2 获取文章内容并进行严格质量控制 (并行化版本)
          const articles = [];
          const embeddings = [];
          
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
          
          // 并行处理文章内容获取的函数
          const processArticleContent = async (article: typeof validArticles[0], index: number) => {
            let content = '';
            let contentAcquired = false;
            let failureReason = '';
            
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
              contentAcquired = true;
              
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

            // 只有通过所有质量检查的文章才会被返回
            return {
              success: true,
              article: {
                id: article.id,
                title: article.title,
                contentFileKey: article.contentFileKey!, // 确保非空
                publishDate: article.publish_date?.toISOString() || new Date().toISOString(),
                url: article.url,
                summary: (article.event_summary_points as string[])?.[0] || article.title,
                contentLength: content.length, // 记录内容长度用于质量评估
                hasValidContent: true // 标记为有效内容
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
          
          for (const result of processResults) {
            if (result.success && result.article && result.embedding) {
              articles.push(result.article);
              embeddings.push(result.embedding);
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
          const embeddingsR2Key = `datasets/${workflowId}/embeddings.json`;
          await this.env.ARTICLES_BUCKET.put(embeddingsR2Key, JSON.stringify(embeddings));

          console.log(`[AutoBrief] 成功构建数据集: ${articles.length} 篇文章 (embeddings 卸载至 ${embeddingsR2Key})`);
          return { articles, embeddings: [], embeddingsR2Key };
          
        } catch (error) {
          console.error('[AutoBrief] 准备数据集失败:', error);
          throw new Error(`数据集准备失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 从 R2 读回 embeddings（它们未走 step 输出以避开 1MB 限制），供质量评估与聚类使用
      if (dataset.embeddingsR2Key && dataset.embeddings.length === 0) {
        const embObj = await this.env.ARTICLES_BUCKET.get(dataset.embeddingsR2Key);
        dataset.embeddings = embObj ? JSON.parse(await embObj.text()) : [];
        console.log(`[AutoBrief] 从 R2 读回 ${dataset.embeddings.length} 个 embedding`);
      }

      const articleQuality = DataQualityAssessor.assessArticleQuality(dataset);
      await observability.logStep('prepare_dataset', 'completed', {
        articleCount: dataset.articles.length,
        articleIds: dataset.articles.map(a => a.id),  // 供 eval fixture 提取使用
        qualityAssessment: articleQuality,
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
      
      const clusteringResult = await step.do('执行聚类分析', defaultStepConfig, async (): Promise<ClusteringResult> => {
        console.log(`[AutoBrief] 开始聚类分析，处理 ${dataset.articles.length} 篇文章`);
        
        // 创建聚类服务实例
        const clusteringService = createClusteringService(this.env, workflowId);
        
        // 优化：聚类分析仅依赖embedding向量，不需要文章内容
        // clustering-service.ts会自动过滤content字段，只传递必要字段给ML服务
        console.log(`[AutoBrief] 构建聚类数据集（仅传递聚类所需的核心字段）...`);
        
        // 构建符合ArticleDataset接口的数据集
        // 注意：clustering-service.ts内部会过滤掉content字段，只传递id、title、url、embedding、publishDate、summary给ML服务
        const clusteringDataset = {
          articles: dataset.articles.map(article => ({
            id: article.id,
            title: article.title,
            content: article.summary, // 满足接口要求，但clustering-service会过滤此字段
            publishDate: article.publishDate,
            url: article.url,
            summary: article.summary
          })),
          embeddings: dataset.embeddings
        };
        
        // 优先使用用户传入的 clusteringOptions（来自 generate API 的 body），
        // 否则根据数据规模启发式生成默认值
        // 2026-09-05:启发式默认改成直接用 BRIEF_CLUSTERING_OPTIONS。
        // 原来那套按数据规模算 min_cluster_size / n_components 的分支是 UMAP+HDBSCAN 时代的
        // 遗留,凝聚聚类只有一个阈值参数、与数据规模无关,继续留着只会让「没传参数」这条路径
        // 悄悄跑在另一套算法上(150 篇时 min_cluster_size 会算到 15)。
        const effectiveClusteringOptions = clusteringOptions ?? BRIEF_CLUSTERING_OPTIONS;
        console.log(`[AutoBrief] 使用聚类参数 (${clusteringOptions ? 'user-provided' : 'heuristic-default'}):`, JSON.stringify(effectiveClusteringOptions));

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
      try {
        await this.env.ARTICLES_BUCKET.put(
          `observability/clustering/${workflowId}.json`,
          JSON.stringify({
            workflowId,
            createdAt: new Date().toISOString(),
            statistics: clusteringResult.statistics,
            clusters: clusteringResult.clusters.map(c => ({
              clusterId: c.clusterId,
              articleIds: c.articleIds,
            })),
          }, null, 2)
        );
      } catch (persistErr) {
        console.warn(`[AutoBrief] clustering 映射落盘失败 (workflow=${workflowId}):`, persistErr);
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
        rejectedClusters: any[];
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
        // rejectedClusters 恒为空：整簇拒绝随 story-validation 一起退役，垃圾簇由选择层的
        // 显著性排序自然沉底（源数少、篇数少 → blockScore 低）。保留字段是为下游形状不变。
        return { stories, rejectedClusters: [], judgeCalls, judgeFailures, pocketFlagged, unsureClusters,
          cappedBlocks, droppedArticles, judgeTitleCapped, crossClusterMerges };
      });

      await observability.logStep('story_validation', 'completed', {
        validStoriesCount: validatedStories.stories.length,
        rejectedClustersCount: validatedStories.rejectedClusters.length,
        judgeCalls: validatedStories.judgeCalls,
        judgeFailures: validatedStories.judgeFailures,
        pocketFlagged: validatedStories.pocketFlagged,
        unsureClusters: validatedStories.unsureClusters,
        judgeTitleCapped: validatedStories.judgeTitleCapped,
        cappedBlocks: validatedStories.cappedBlocks,
        droppedArticles: validatedStories.droppedArticles,
        stories: validatedStories.stories,
        rejectedClusters: validatedStories.rejectedClusters,
      });

      // 观测性：写入 brief_stories + cluster_rejections。delete+insert 保证 step 重试时幂等。
      //
      // 返回插入行的自增主键(按 validatedStories.stories 顺序)：下游 mark_selected_for_intel
      // 要精确标记「被选中送情报分析的那几条」，而 cluster_id 在 2026-08-21 换架构后**不再唯一**
      // （一个簇现在会产出多个故事），按 cluster_id 更新会把该簇的全部故事一并标成已选中。
      // 换架构前 Story 上没有 clusterId、落库恒走 `i + 1`，与故事序号一一对应，是歪打正着。
      const briefStoryRowIds = await step.do('persist:brief_stories_and_rejections', dbStepConfig, async (): Promise<number[]> => {
        const db = getDb(this.env.HYPERDRIVE);
        await db.delete($brief_stories).where(eq($brief_stories.workflow_id, workflowId));
        await db.delete($cluster_rejections).where(eq($cluster_rejections.workflow_id, workflowId));
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
        if (validatedStories.rejectedClusters.length > 0) {
          await db.insert($cluster_rejections).values(
            validatedStories.rejectedClusters.map((c: any) => ({
              workflow_id: workflowId,
              cluster_id: typeof c.clusterId === 'number' ? c.clusterId : null,
              reason: c.rejectionReason ?? null,
              article_count: Array.isArray(c.originalArticleIds) ? c.originalArticleIds.length : null,
              // 成员 id 一并落库：此前只存 count，"哪些文章从未进入任何故事"就只能去 R2 手翻。
              // -1 噪声桶已占窗口文章约 70%，是最需要复盘的一批。
              article_ids: Array.isArray(c.originalArticleIds) ? c.originalArticleIds : null,
            }))
          );
        }
        return insertedIds;
      });

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
            validStories: 0,
            rejectedClusters: validatedStories.rejectedClusters.length,
            rejectionReasons: validatedStories.rejectedClusters.reduce((acc: Record<string, number>, cluster: any) => {
              acc[cluster.rejectionReason] = (acc[cluster.rejectionReason] || 0) + 1;
              return acc;
            }, {}),
            clusterBreakdown: validatedStories.rejectedClusters.map((cluster: any) => ({
              clusterId: cluster.clusterId,
              articleCount: cluster.originalArticleIds?.length || 0,
              rejectionReason: cluster.rejectionReason
            }))
          },
          recommendations: [
            '考虑降低故事重要性阈值 (storyMinImportance)',
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
      // 故事重要性评估观测 - 使用可观测性框架记录详细的故事选择指标
      // =====================================================================
      const totalCandidateStories = validatedStories.stories.length + validatedStories.rejectedClusters.length;
      const importanceThreshold = storyMinImportance;
      
      // 构建故事明细分析
      const storyBreakdown: Array<{
        storyId: number;
        title: string;
        importance: number;
        articleCount: number;
        clusterId: number;
        selected: boolean;
        rejectionReason?: string;
        marginFromThreshold: number;
        selectionCategory: string;
      }> = [];
      
      // 添加接受的故事
      validatedStories.stories.forEach((story: any, index: number) => {
        storyBreakdown.push({
          storyId: index + 1,
          title: story.title,
          importance: story.importance,
          articleCount: story.articleIds.length,
          clusterId: story.clusterId || (index + 1), // 如果没有clusterId使用索引
          selected: true,
          marginFromThreshold: story.importance - importanceThreshold,
          selectionCategory: story.importance >= 8 ? 'high_confidence' : story.importance >= 5 ? 'medium_confidence' : 'low_confidence'
        });
      });
      
      // 添加拒绝的聚类作为拒绝的故事
      validatedStories.rejectedClusters.forEach((cluster: any, index: number) => {
        storyBreakdown.push({
          storyId: validatedStories.stories.length + index + 1,
          title: `[拒绝聚类] ${cluster.rejectionReason}`,
          importance: 0, // 拒绝的聚类重要性为0
          articleCount: cluster.originalArticleIds?.length || 0,
          clusterId: cluster.clusterId,
          selected: false,
          rejectionReason: cluster.rejectionReason,
          marginFromThreshold: 0 - importanceThreshold, // 负值表示低于阈值
          selectionCategory: 'rejected'
        });
      });
      
      // 计算阈值分析统计
      const passedStories = storyBreakdown.filter(s => s.selected && s.importance >= importanceThreshold);
      const rejectedStories = storyBreakdown.filter(s => !s.selected);
      const highConfidenceSelections = storyBreakdown.filter(s => s.selected && s.importance >= 8);
      const borderlineCases = storyBreakdown.filter(s => s.selected && s.importance >= importanceThreshold && s.importance < (importanceThreshold + 2));
      const selectedStories = storyBreakdown.filter(s => s.selected);
      
      const avgMarginForSelected = selectedStories.length > 0 
        ? selectedStories.reduce((sum, s) => sum + s.marginFromThreshold, 0) / selectedStories.length 
        : 0;
      const avgMarginForRejected = rejectedStories.length > 0 
        ? rejectedStories.reduce((sum, s) => sum + s.marginFromThreshold, 0) / rejectedStories.length 
        : 0;
      
      // 构建详细的故事选择指标
      const storySelectionMetrics = {
        candidateStories: totalCandidateStories,
        selectedStories: validatedStories.stories.length,
        rejectedStories: validatedStories.rejectedClusters.length,
        importanceThreshold,
        qualityFilters: ['AI_VALIDATION', 'CLUSTER_SIZE', 'CONTENT_QUALITY'],
        avgImportanceScore: storyQualityMetrics.averageImportance,
        storyBreakdown,
        thresholdAnalysis: {
          passedStories: passedStories.length,
          rejectedStories: rejectedStories.length,
          highConfidenceSelections: highConfidenceSelections.length,
          borderlineCases: borderlineCases.length,
          avgMarginForSelected,
          avgMarginForRejected
        },
        selectionConfidence: {
          highConfidence: highConfidenceSelections.length,
          borderlineCases: borderlineCases.length,
          avgSelectionMargin: avgMarginForSelected
        }
      };
      
      // 使用可观测性框架记录故事选择过程
      await observability.logStorySelection(storySelectionMetrics);

      // =====================================================================
      // 步骤 4: 情报深度分析 (AI Worker)
      // =====================================================================
      await observability.logStep('intelligence_analysis', 'started');
      
      // 情报分析按「每故事一个 step」拆开，所以这份配置是**单个故事**的量级，不再是整批。
      // timeout 10 分钟：实测单次 ai-worker 调用 p95 约 2.7 分钟、最慢 6.5 分钟(2026-08-26 生产数据)，留一倍余量。
      // retries 提到 2：拆开后重试只重跑一个故事、一次 LLM 调用，不再是整批 25 个重来，
      // 所以可以多给一次机会——这正是治 2026-08-26 那次整期丢失的关键。
      const perStoryIntelStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '10 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };

      // story 去重层（story-dedup）与「去重后再分主线」的两段式都已退役：文章级划分下
      // 每篇文章恰好属于一块，块间重复由构造消除，没有可去的重。相关代码留在
      // lib/core/story-dedup.ts 里未删（跨期线索合并仍可能用到），但不在简报主链路上。
      //
      // 这里只补 __briefStoryRowIds：下游 mark_selected_for_intel 与 intel_report_r2_key
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
      const { ranked, selected: storiesForIntelligence, capped } = rankStoriesForIntelligence(
        validatedStories.stories,
        sourceCoverage,
        {
          coverageWeight: COVERAGE_WEIGHT,
          maxStories: maxStoriesToGenerate,
          perEventCap: PER_EVENT_BLOCK_CAP,
          eventKeyOf: (story) => String((story as { eventKey?: string }).eventKey ?? ''),
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

      // 【报告层 v3 · 每故事一个 step】簇原文 → 带出处的事实 / 当事方 / 分歧（ai-worker /meridian/report-v3）。
      // fan-out 必须留在 backend：CF 侧约 2% 的 invocation 会被平台 canceled，N 次调用挤进一个 step
      // 就是"一次抖动丢整期"。报告全文卸 R2、step 只回 key（避开单 step ~1MB 输出上限）。
      console.log(`[AutoBrief] 开始生成簇报告（report-v3）：从 ${validatedStories.stories.length} 个候选故事中选取 top-${storiesForIntelligence.length}`);

      // 4 而不是 6：报告层每簇内部还有 3 路并发，6×3=18 路时 Workers AI 开始回
      // `3046: Request timeout`（2026-09-12 整链实测）。
      const REPORT_CONCURRENCY = 4;
      const perStoryReportStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' },
        timeout: '15 minutes',
      };
      // 独立源数按 story 对象取：sourceCoverage 的键是 validatedStories.stories 的下标，
      // 而 storiesForIntelligence 是排序 + 配额之后的子集，下标对不上。
      const sourcesOf = new Map<any, number>(
        validatedStories.stories.map((s: any, i: number) => [s, sourceCoverage[i] ?? 0])
      );

      type ReportOutcome =
        | {
            r2Key: string;
            idx: number;
            clusterId: number | null;
            blockTitle: string;
            articles: number;
            sources: number;
            facts: number;
            skeleton: number;
            llmCalls: number;
            neurons: number;
          }
        | { failure: { idx: number; title: string; reason: string } };

      const buildOneReport = async (story: any, idx: number): Promise<ReportOutcome> => {
        try {
          const clusterArticles = await this.getArticleContents(story.articleIds, dataset);
          const withBody = clusterArticles.filter((a) => String(a.content ?? '').trim().length > 0);
          if (withBody.length === 0) {
            return { failure: { idx, title: story.title, reason: '簇内没有一篇文章取到正文' } };
          }
          if (withBody.length < clusterArticles.length) {
            // 取不到正文的被丢掉，而报告只能从剩下的里抽。不留痕就只剩"这块怎么少了半件事"。
            console.warn(
              `[AutoBrief] 报告材料不全 (idx=${idx}, "${story.title}"): ` +
              `${clusterArticles.length} 篇里只有 ${withBody.length} 篇取到正文`
            );
          }
          const aiw = createAIServices(this.env, workflowId).aiWorker;
          const res = await aiw.buildReportV3(
            String(story.title ?? ''),
            withBody.map((a) => ({ id: a.id, title: a.title, url: a.url, publishDate: a.publishDate, content: a.content })),
            idx
          );
          if (!res.ok) {
            console.error(`[AutoBrief] 报告生成失败 (idx=${idx}, "${story.title}"): ${res.error}`);
            return { failure: { idx, title: story.title, reason: res.error } };
          }
          const r2Key = `reports-v3/${workflowId}/${idx}.json`;
          await this.env.ARTICLES_BUCKET.put(r2Key, JSON.stringify(res.value.report));

          // R2 key 记到 brief_stories（观测；落库失败不致命）。**不能按 cluster_id**：
          // 一个簇会产出多条 story、共享同一个 cluster_id，按它更新会把整簇的行写上同一个 key。
          try {
            const rowIds: number[] = Array.isArray(story.__briefStoryRowIds)
              ? story.__briefStoryRowIds.filter((id: any) => typeof id === 'number')
              : [];
            if (rowIds.length === 0) {
              console.warn(`[AutoBrief] report_r2_key 跳过落库：story 无 brief_stories 主键 (idx=${idx})`);
            } else {
              const db = getDb(this.env.HYPERDRIVE);
              await db
                .update($brief_stories)
                .set({ intel_report_r2_key: r2Key })
                .where(and(eq($brief_stories.workflow_id, workflowId), inArray($brief_stories.id, rowIds)));
            }
          } catch (persistErr) {
            console.warn(`[AutoBrief] report_r2_key 落库失败 (workflow=${workflowId}, idx=${idx}):`, persistErr);
          }

          const t = res.value.trace;
          return {
            r2Key,
            idx,
            clusterId: typeof story.clusterId === 'number' ? story.clusterId : null,
            blockTitle: String(story.title ?? ''),
            articles: withBody.length,
            // 源数不能超过篇数（取不到正文的文章不进报告，也不该继续算它的源）
            sources: Math.max(1, Math.min(sourcesOf.get(story) ?? 1, withBody.length)),
            facts: t.facts,
            skeleton: t.skeleton,
            llmCalls: t.llmCalls,
            neurons: t.neurons,
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[AutoBrief] 报告生成异常 (idx=${idx}): ${reason}`);
          return { failure: { idx, title: story.title, reason } };
        }
      };

      const reportResults = await this.batchProcessParallel(
        storiesForIntelligence,
        REPORT_CONCURRENCY,
        (story: any, idx: number): Promise<ReportOutcome> =>
          step
            .do(`报告:故事${idx}`, perStoryReportStepConfig, () => buildOneReport(story, idx))
            // 重试耗尽后 step 会 reject，而 batchProcessParallel 用 allSettled 且只 console.warn
            // ——不接住的话这个故事会静默消失。
            .catch((e: unknown): ReportOutcome => {
              const reason = `step 重试耗尽: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`[AutoBrief] 报告 step 最终失败 (idx=${idx}, "${story.title}"): ${reason}`);
              return { failure: { idx, title: story.title, reason } };
            })
      );

      type ReportOk = Extract<ReportOutcome, { r2Key: string }>;
      const intelligenceReports = reportResults.filter((r): r is ReportOk => 'r2Key' in r);
      const intelFailures = reportResults
        .filter((r): r is { failure: { idx: number; title: string; reason: string } } => 'failure' in r)
        .map((r) => r.failure);

      if (intelligenceReports.length === 0) {
        throw new Error(`全部 ${storiesForIntelligence.length} 个故事的报告生成都失败（详见上方各故事错误日志）`);
      }
      console.log(
        `[AutoBrief] 簇报告完成: ${intelligenceReports.length}/${storiesForIntelligence.length}` +
          (intelFailures.length ? `，${intelFailures.length} 个失败` : '') +
          `，事实合计 ${intelligenceReports.reduce((n, r) => n + r.facts, 0)}`
      );
      await observability.logStep(
        'intelligence_analysis',
        intelFailures.length > 0 ? 'degraded' : 'completed',
        {
          path: 'report-v3',
          storiesSelected: storiesForIntelligence.length,
          reportsGenerated: intelligenceReports.length,
          failedCount: intelFailures.length,
          failures: intelFailures,
          llmCalls: intelligenceReports.reduce((n, r) => n + r.llmCalls, 0),
          neurons: Math.round(intelligenceReports.reduce((n, r) => n + r.neurons, 0)),
        }
      );

      // =====================================================================
      // 步骤 5: 分层 → 逐块写作 → 拼装（v3）
      // =====================================================================
      await observability.logStep('brief_generation', 'started');

      // 分层（纯函数，见 lib/core/brief-v3.ts）：按「独立源数 × 篇数」降序，
      // 前 4 头条 / 接着 10 要闻 / 其余简讯。不用 LLM 的 importance——那是一行定义的主观分，
      // 源数 × 篇数是聚类后天然已知的客观量。
      const tiered = assignTiers(intelligenceReports);
      const tierCount = (t: string) => tiered.filter((x) => x.tier === t).length;
      console.log(
        `[AutoBrief] 分层：头条 ${tierCount('lead')} / 要闻 ${tierCount('more')} / 简讯 ${tierCount('brief')}` +
          `（分 = 源数 × 篇数：${tiered.slice(0, 5).map((x) => `${x.score}`).join(',')}…）`
      );

      const briefBlockStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '10 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      // 与报告同档：不让 N 路同时打 provider，撞限流由 AIGateway 配额退避兜底。
      const BRIEF_BLOCK_CONCURRENCY = 6;

      type WrittenBlock = ReportOk & {
        tier: 'lead' | 'more' | 'brief';
        score: number;
        pos: number;
        text: string;
        marks: Array<{ sentence: string; reasons: Array<Record<string, any>> }>;
        markStats: { sentences: number; checked: number; abstained: number; marked: number };
        blockLlmCalls: number;
        blockNeurons: number;
      };
      type BlockOutcome = { block: WrittenBlock } | { failure: { idx: number; title: string; reason: string } };

      const blockOutcomes = await this.batchProcessParallel(
        tiered,
        BRIEF_BLOCK_CONCURRENCY,
        (job: (typeof tiered)[number], pos: number): Promise<BlockOutcome> =>
          step
            .do(`简报块:${job.idx}`, briefBlockStepConfig, async (): Promise<BlockOutcome> => {
              // 报告从 R2 读回再内联转发：它是上一步的产物，不让 ai-worker 再读一次 R2
              const obj = await this.env.ARTICLES_BUCKET.get(job.r2Key);
              if (!obj) throw new Error(`报告不在 R2: ${job.r2Key}`);
              const report = JSON.parse(await obj.text());
              const aiw = createAIServices(this.env, workflowId).aiWorker;
              const res = await aiw.writeBlockV3(report, job.tier, job.idx);
              if (!res.ok) throw new Error(res.error);
              const v = res.value;
              return {
                block: {
                  ...job,
                  pos,
                  text: v.text,
                  // 代码检查器的标记：只进内部观测与管理页，**不进正文**
                  marks: v.marks ?? [],
                  markStats: v.trace.marks,
                  blockLlmCalls: v.trace.llmCalls,
                  blockNeurons: v.trace.neurons,
                },
              };
            })
            .catch((e: unknown): BlockOutcome => {
              const reason = `step 重试耗尽: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`[AutoBrief] 简报块 step 最终失败 (idx=${job.idx}, "${job.blockTitle}"): ${reason}`);
              return { failure: { idx: job.idx, title: job.blockTitle, reason } };
            })
      );

      const writtenBlocks = blockOutcomes
        .filter((r): r is { block: WrittenBlock } => 'block' in r)
        .map((r) => r.block)
        .sort((a, b) => a.pos - b.pos);
      const blockFailures = blockOutcomes
        .filter((r): r is { failure: { idx: number; title: string; reason: string } } => 'failure' in r)
        .map((r) => r.failure);

      if (writtenBlocks.length === 0) {
        throw new Error(`简报块写作对全部 ${tiered.length} 个块均失败，无可拼装内容（详见上方各块错误日志）`);
      }
      const markTotal = writtenBlocks.reduce((n, b) => n + b.marks.length, 0);
      console.log(
        `[AutoBrief] 简报块写作完成: ${writtenBlocks.length}/${tiered.length}` +
          (blockFailures.length ? `，${blockFailures.length} 个块失败` : '') +
          `，检查器标记 ${markTotal} 条（只进观测，不进正文）`
      );
      await observability.logStep('brief_blocks', blockFailures.length > 0 ? 'degraded' : 'completed', {
        path: 'writer-v3',
        expected: tiered.length,
        written: writtenBlocks.length,
        failedCount: blockFailures.length,
        failures: blockFailures,
        tiers: { lead: tierCount('lead'), more: tierCount('more'), brief: tierCount('brief') },
        marks: markTotal,
      });

      // 拼装：三节 markdown 全由代码渲染（见 lib/core/brief-v3.ts），唯一的调用是给整篇起标题。
      const briefAssembleStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      // 条目标题小写是本简报的 house style（renderBriefV3 里做）。记录里存的必须是**读者看到的那个**，
      // 否则管理页/验收拿记录去对正文会对不上（2026-09-12 M3 就挂在这里）。
      const displayTitle = (t: string) => t.trim().toLowerCase();
      const rendered = renderBriefV3(
        writtenBlocks.map((b) => ({ title: displayTitle(b.blockTitle), text: b.text, tier: b.tier }))
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
        model_used: 'glm-4.7-flash (report-v3 + writer-v3)',
      };

      // 每期一份 v3 记录：分层、每块的标记与成本。管理页读它，验收（accept.ts M3）也读它。
      // 失败的块以 ok:false 留在记录里——不写进正文，但绝不静默消失。
      try {
        const byIdx = new Map(writtenBlocks.map((b) => [b.idx, b]));
        const failedIdxSet = new Map(blockFailures.map((f) => [f.idx, f]));
        await this.env.ARTICLES_BUCKET.put(
          `observability/brief-v3/${workflowId}.json`,
          JSON.stringify(
            {
              workflowId,
              createdAt: new Date().toISOString(),
              title: assembled.title,
              sections: rendered.sections,
              blocks: tiered.map((job) => {
                const b = byIdx.get(job.idx);
                const f = failedIdxSet.get(job.idx);
                return {
                  clusterId: job.clusterId,
                  storyIdx: job.idx,
                  title: displayTitle(job.blockTitle),
                  tier: job.tier,
                  articles: job.articles,
                  sources: job.sources,
                  score: job.score,
                  ok: !!b,
                  ...(f ? { error: f.reason } : {}),
                  text: b?.text ?? '',
                  marks: b?.marks ?? [],
                  markStats: b?.markStats ?? null,
                  llmCalls: b?.blockLlmCalls ?? 0,
                  neurons: b?.blockNeurons ?? 0,
                  reportLlmCalls: job.llmCalls,
                  reportNeurons: job.neurons,
                  reportKey: job.r2Key,
                };
              }),
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

      // 5d 摘要：次日模型用的 TLDR + 读者端展示的散文导语。与拼装分开成 step，
      // 是为了让"简报正文已经生成好了"这件事不被摘要环节的失败拖累。
      const briefSummaryStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      const summaries = await step.do('简报摘要', briefSummaryStepConfig, async () => {
        const aiServices = createAIServices(this.env, workflowId);
        const tldr = await aiServices.aiWorker.generateBriefTldr(assembled.title, assembled.content);
        if (!tldr.ok) {
          throw new Error(`TLDR生成失败: ${tldr.error}`);
        }
        // 读者端展示用的散文摘要。刻意 best-effort：摘要只影响读者端标题下那一段的显示，
        // 为它整步失败、丢掉一份已经生成好的简报是不划算的。失败留 null，前端自然不渲染。
        const tldrProse = await aiServices.aiWorker.generateBriefSummary(assembled.title, assembled.content);
        if (!tldrProse.ok) {
          console.warn(`[AutoBrief] 散文摘要生成失败（不阻断简报）: ${tldrProse.error}`);
        }
        return { tldr: tldr.value.tldr, tldrProse: tldrProse.ok ? tldrProse.value.tldrProse : null };
      });

      // used_articles 是真正喂进简报的去重文章数 = 拿到情报报告的那些 story 的 articleIds 并集
      // （失败的 story 不算，它的报告没进简报）。failures[].idx 是 storiesForIntelligence 的
      // 全局下标（batchProcessParallel 传的是 i + batchIndex）。
      // ⚠️ 语义变更：reports 表 51-59 期存的仍是旧值（故事数），跨期比较需注意。
      const failedIdx = new Set(intelFailures.map(f => f.idx));
      const usedArticleIds = new Set<number>(
        storiesForIntelligence
          .filter((_: any, i: number) => !failedIdx.has(i))
          .flatMap((s: any) => (Array.isArray(s.articleIds) ? s.articleIds : []))
      );

      const briefResult: BriefGenerationResultData = {
        title: assembled.title,
        content: assembled.content,
        tldr: summaries.tldr,
        tldrProse: summaries.tldrProse,
        model_author: 'meridian-ai-worker',
        stats: {
          total_articles: dataset.articles.length,
          used_articles: usedArticleIds.size,
          clusters_found: clusteringResult.statistics.totalClusters,
          stories_identified: validatedStories.stories.length,
          intelligence_analyses: intelligenceReports.length,
          content_length: assembled.content.length,
          model_used: assembled.model_used,
        },
      };

      await observability.logStep('brief_generation', 'completed', briefResult.stats);

      // =====================================================================
      // 步骤 5.5: 忠实度门（线上只标记、离线审阅）
      // 逐句把 brief 对情报报告取证，生产默认 code_only 纯传感器（只跑拆 claim + 代码
      // 比对，~10 秒量级）；full 判官（~qwen-max judge）只在离线预筛显式传 mode='full'
      // 时运行。线上只记录 verdict 到 observability，永不拦截、不改稿——判定结果离线
      // 审阅、成果回流生成端。方向定案见 memory: faithfulness-runtime-gate /
      // intel-grounding-judge-validated。路径 B（发布前删句）与 enforce 拦截均已关闭
      // 且方向上永不重开。
      // =====================================================================
      // 测试迭代可按 run 跳过门(省本次 code_only 检查耗时);
      // 生产 cron 不传此参=默认跑门攒观测数据。见 memory: faithfulness-runtime-gate。
      // v3 链路不跑忠实度门：检测改用零成本的代码检查器（标记已随块写进 observability/brief-v3/）。
      // 这个门要把整份旧格式情报报告喂给模型，而线上强判官的召回/成本账不划算（ADR 0004「检测上限」）。
      // 门的代码与端点都留着，旧链路仍可用。
      const RUN_FAITHFULNESS_GATE = false;
      if (skipFaithfulnessGate || !RUN_FAITHFULNESS_GATE) {
        const why = skipFaithfulnessGate ? 'skip_param' : 'v3_path';
        console.log(`[AutoBrief] 忠实度门：跳过（${why}）`);
        await observability.logStep('faithfulness_gate', 'completed', { skipped: true, reason: why });
      } else {
        await observability.logStep('faithfulness_gate', 'started');
        // code_only 传感器耗时远低于 defaultStepConfig 的 2min，但仍留足余量防偶发慢调用；
        // retries=1 避免一次慢调用被重试放大成多轮超时。
        const faithfulnessStepConfig: WorkflowStepConfig = {
          retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
          timeout: '10 minutes',
        };
        // fail-open 兜底：门(检查员)自身任何失败——超时/重试耗尽/异常——都不得连坐已生成的 brief。
        // step.do 的超时由引擎在回调外层抛 WorkflowTimeoutError，回调内的放行逻辑接不到，
        // 必须在这里 catch → verdict=null → 后续按"门不可用"放行。
        let faithfulnessVerdict: any = null;
        try {
          faithfulnessVerdict = await step.do('忠实度门检查', faithfulnessStepConfig, async () => {
            // per-story sources：每份情报报告独立传入，避免合并后 ~141K chars 撞 qwen-max 30720 token 上限。
            // 各故事源 ~7.5K chars，faithfulness-check 逐源短路判定后聚合 verdict。
            const sources = (await Promise.all(
              intelligenceReports.map(async ({ r2Key }: { r2Key: string }, idx: number) => {
                const obj = await this.env.ARTICLES_BUCKET.get(r2Key);
                if (!obj) return null;
                const content = await obj.text();
                let storyId = `story-${idx}`;
                try { const p = JSON.parse(content); if (p.storyId) storyId = p.storyId; } catch {}
                return { storyId, content };
              })
            )).filter((s): s is { storyId: string; content: string } => s !== null);

            // 接缝返回 domain result；仪式/dispose 收进 ai-services。门本身故障不连坐 brief
            // (fail-open on infra error)：记一条、放行(返 null)。
            const aiServices = createAIServices(this.env, workflowId);
            const check = await aiServices.aiWorker.faithfulnessCheck(sources, briefResult.content);
            if (!check.ok) {
              console.error(`[AutoBrief] 忠实度门调用失败: ${check.error}，放行 brief`);
              return null;
            }
            return check.value;
          });
        } catch (gateError) {
          // 超时/重试耗尽/任何异常 → fail-open：检查员挂掉，绝不丢弃已生成的 brief
          console.error(`[AutoBrief] 忠实度门检查步骤失败(${gateError instanceof Error ? gateError.message : String(gateError)})，fail-open 放行 brief`);
          faithfulnessVerdict = null;
        }

        if (faithfulnessVerdict) {
          const v = faithfulnessVerdict;
          console.log(`[AutoBrief] 忠实度门: block=${v.block} mode=mark-only ` +
            `reasons=[${(v.block_reasons || []).join(' | ')}] unsupported=${v.genuine_unsupported}/${v.factual_claims} ` +
            `contradicted=${v.contradicted} ana_contra=${v.analytical_contradicting}`);
          // 观测性：verdict 全量落 R2（含 all_claims 抽取全集）。step 日志只存 flagged，
          // 但离线全量审计的「待判对象」是 claim 全集——不落盘就得重拆，非确定性对不齐
          // 生产编号。best-effort，不拖垮发布。
          try {
            await this.env.ARTICLES_BUCKET.put(
              `observability/faithfulness/${workflowId}.json`,
              JSON.stringify({ workflowId, createdAt: new Date().toISOString(), verdict: v }, null, 2)
            );
          } catch (persistErr) {
            console.warn(`[AutoBrief] 忠实度 verdict 落盘失败 (workflow=${workflowId}):`, persistErr);
          }
          await observability.logStep('faithfulness_gate', 'completed', {
            block: v.block,
            block_reasons: v.block_reasons,
            genuine_unsupported: v.genuine_unsupported,
            factual_claims: v.factual_claims,
            unsupported_rate: v.unsupported_rate,
            contradicted: v.contradicted,
            analytical_contradicting: v.analytical_contradicting,
            flagged_factual: v.flagged_factual,
            flagged_analytical: v.flagged_analytical,
          });
        } else {
          await observability.logStep('faithfulness_gate', 'completed', { skipped: true, reason: 'check_unavailable' });
        }
      }

      // =====================================================================
      // 步骤 6: 保存简报到数据库
      // =====================================================================
      await observability.logStep('save_brief', 'started');
      
      const reportId = await step.do('保存简报', dbStepConfig, async (): Promise<number> => {
        try {
          const db = getDb(this.env.HYPERDRIVE);
          
          // 计算source统计
          // 1. 获取所有RSS源数量
          const totalSourcesResult = await db
            .select({ count: sql<number>`count(*)` })
            .from($sources);
          const totalSources = totalSourcesResult[0]?.count || 0;
          
          // 2. 计算使用的source数量（基于参与简报的文章）
          const usedArticleIds = dataset.articles
            .filter((article: any) => 
              validatedStories && 
              validatedStories.stories && 
              Array.isArray(validatedStories.stories) && 
              validatedStories.stories.some((story: any) => 
                story.articleIds && Array.isArray(story.articleIds) && 
                story.articleIds.includes(article.id)
              )
            )
            .map(article => article.id);
          
          let usedSources = 0;
          if (usedArticleIds.length > 0) {
            const usedSourcesResult = await db
              .selectDistinct({ count: sql<number>`count(distinct ${$articles.sourceId})` })
              .from($articles)
              .where(inArray($articles.id, usedArticleIds));
            usedSources = usedSourcesResult[0]?.count || 0;
          }
          
          const insertResult = await db
            .insert($reports)
            .values({
              title: briefResult.title,
              content: briefResult.content,
              totalArticles: briefResult.stats.total_articles,
              totalSources: totalSources,
              usedArticles: briefResult.stats.used_articles,
              usedSources: usedSources,
              tldr: briefResult.tldr,
              tldr_prose: briefResult.tldrProse,
              clustering_params: {
                workflowId,
                triggeredBy,
                stats: briefResult.stats,
                generatedAt: new Date().toISOString(),
                endToEndWorkflow: true,
                clusteringParams: clusteringResult.parameters
              },
              model_author: briefResult.model_author
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
      // 有可对账的局部失败（intel 步选中 N 只产出 M<N）→ DEGRADED 而非 COMPLETED，
      // 使"头条静默消失"这类在 DB status 层就可见（不只在 R2 step metrics），便于监控/巡检。
      await step.do('persist:brief_run_complete', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        await db
          .update($brief_runs)
          .set({
            status: intelFailures.length > 0 ? 'DEGRADED' : 'COMPLETED',
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
        tldrLength: briefResult.tldr?.length || 0,
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

/**
 * 启动自动简报生成工作流
 * 用于从上游工作流（如 processArticles.workflow.ts）触发
 *
 * @param env Application environment
 * @param params 工作流参数，包含文章ID列表
 * @returns 结果包含创建的工作流实例或错误信息
 */
export async function startAutoBriefGenerationWorkflow(env: Env, params: BriefGenerationParams) {
  try {
    // 使用 wrangler.jsonc 中配置的工作流绑定名称 'MY_WORKFLOW'
    const workflow = await env.MY_WORKFLOW.create({ 
      id: crypto.randomUUID(), 
      params 
    });
    
    console.log(`[AutoBrief] 简报生成工作流已启动，ID: ${workflow.id}`);
    return { success: true, data: workflow };
  } catch (error) {
    console.error('[AutoBrief] 启动简报生成工作流失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 