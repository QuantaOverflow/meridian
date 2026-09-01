import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/database';
import { $articles, $reports, $sources, $brief_runs, $brief_stories, $cluster_rejections, gte, lte, isNotNull, isNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { assignStoryClustersForWorkflow } from '../lib/story-clusters';
import { backfillStoryCentroids } from '../lib/story-clusters';
import {
  buildMergeGroups,
  collapseGroup,
  DEFAULT_ARTICLE_CAP,
  DEFAULT_MIN_COSINE,
  type CosinePair,
  type DedupStory,
} from '../lib/core/story-dedup';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/observability/dataflow';
import { createClusteringService, type ArticleDataset, type ClusteringResult } from '../lib/services/clustering';
import { createAIServices } from '../lib/services/ai-services';
import { generateSearchText } from '../lib/core/utils';
import { looksLikeExtractionFailure } from '../lib/core/extraction-quality';
import { rankStoriesForIntelligence } from '../lib/core/story-ranking';
import { buildCandidateGroups } from '../lib/core/candidate-grouping';
import { CANDIDATE_GROUP_THRESHOLD } from '../lib/core/constants';
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

// 去重步单列配置：这一步不是纯 DB 步，体里有 11-15 次**串行** LLM 确认调用
// （实测 workflow admin-brief-1788170117190：41 条过阈配对、11 个簇），每次 2-4 秒 → 22-60 秒，
// 而 dbStepConfig 只给 30 秒。那次生产跑压线过关纯属侥幸；一旦超时，retries 会把整组 LLM
// 重打 3 遍（4 倍成本）后整期简报失败。5 分钟对当前规模约 10 倍余量。
// retries 降到 2：这一步重试的代价是整组 LLM 重跑，不像纯 DB 步那样近乎免费。
const dedupStepConfig: WorkflowStepConfig = {
  retries: { limit: 2, delay: '5 seconds', backoff: 'linear' },
  timeout: '5 minutes',
};

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
        const effectiveClusteringOptions = clusteringOptions ?? {
          umapParams: {
            n_neighbors: Math.min(15, Math.max(3, Math.floor(dataset.articles.length / 3))),
            n_components: Math.min(10, Math.max(2, Math.floor(dataset.articles.length / 5))),
            min_dist: 0.1,
            metric: 'cosine'
          },
          hdbscanParams: {
            min_cluster_size: Math.max(2, Math.floor(dataset.articles.length / 10)),
            min_samples: 1,
            epsilon: 0.5
          }
        };
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

      // 这一步在 ai-worker 内限并发(VALIDATION_CONCURRENCY=6)逐簇调 LLM，wall-clock 随簇数
      // 线性涨，实测约 8s/簇(24 簇 191s)。2026-08-12 迁 Workers AI 后曾因预算过紧超时重试 3 次
      // 才侥幸通过，而 step.do 的重试是**整步重来、无断点**——每次重试把全部 LLM 调用重跑一遍。
      //
      // 10 → 25 分钟(2026-08-18)：移除质心剪枝 + eps 0.5→0.35(167f4c3)后簇数 28 → 87
      // (1045 篇窗口)，87 × 8s ≈ 692s 直接撑破 600s。当日实测 admin-brief-1787048524613
      // 正是死在这里：`WorkflowTimeoutError: Execution timed out after 600000ms`,且因 retries=3
      // 会连撞三次、白烧三轮 LLM 调用。原注释的"单簇 20s × 约 30 簇"预算随簇数变化已失效。
      //
      // 25 分钟按当前 1045 篇/87 簇留 2 倍余量;进稿再涨需重估(线性外推:约 172 簇撑破 25 分钟)。
      // **这是放宽预算不是修性能**——真正的修法是把并发 6 提高、并把"分批+批间栅栏"换成
      // worker pool(现在一个慢簇会拖住整批)，属 story-validation 的题目，另行处理。
      const storyValidationStepConfig: WorkflowStepConfig = {
        retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
        timeout: '25 minutes',
      };

      const validatedStories = await step.do('执行故事验证', storyValidationStepConfig, async () => {
        console.log(`[AutoBrief] 开始故事验证，处理 ${clusteringResult.clusters.length} 个聚类`);
        
        // 创建 AI 服务实例（注入 trace_id 以贯通跨 service 日志）
        const aiServices = createAIServices(this.env, workflowId);

        // 构建故事验证请求数据 - 使用真实的数据库字段
        const db = getDb(this.env.HYPERDRIVE);
        const articleIds = dataset.articles.map(a => a.id);
        
        // 这里回查的唯一目的是拿回**完整** event_summary_points：dataset.articles 只带
        // summary = event_summary_points[0]（:619），而完整要点(近 3 天均值 7.88 条/篇)
        // 若随 dataset 走 step 输出约 960KB，会顶在 CF Workflow 单 step ~1MB 上限上，
        // 故设计上就该在步内回查、不进 step 输出。
        //
        // 2026-08-19 修：WHERE 漏了 `inArray(id, articleIds)`（上一行算出的 articleIds
        // 从未被使用），配 `.limit(50)` 无排序 → 实际取到的是全表最早的 50 篇
        // (id 1..3758, publish_date 2026-05-19..22)，与当前窗口(id 61 万量级)**交集为零**。
        // 于是 metadataMap 每篇都 miss、每篇都走兜底 `[article.summary]` → 模型只看到
        // 标题 + 一条导语，判别信号被砍到约 1/8。Map.get miss 有合法兜底路径，
        // 100% miss 与 0% miss 在日志里完全同形，无计数器可响（「静默降级成安全默认值」
        // 模式的又一实例，此处发生在数据装配而非 LLM 边界）。
        //
        // 剪枝时代簇最大 15 篇，标题+导语够拆，故长期无症状；移除剪枝后簇涨到 96 篇，
        // 判别难度陡升才显形——上游改动叫醒的休眠 bug。
        const articleMetadata = await db
          .select({
            id: $articles.id,
            title: $articles.title,
            url: $articles.url,
            event_summary_points: $articles.event_summary_points
          })
          .from($articles)
          .where(inArray($articles.id, articleIds));
        
        const metadataMap = new Map(articleMetadata.map(a => [a.id, a]));
        
        const articlesData = dataset.articles.map(article => {
          const metadata = metadataMap.get(article.id);
          return {
            id: article.id,
            title: article.title,
            url: article.url,
            // 使用数据库中的实际event_summary_points，如果为空则回退到构建的summary
            event_summary_points: Array.isArray((metadata as any)?.event_summary_points) && (metadata as any).event_summary_points.length > 0
              ? (metadata as any).event_summary_points as string[]
              : [article.summary] // 回退选项
          };
        });
        
        // 簇内几何候选分组(全链 cos≥CANDIDATE_GROUP_THRESHOLD)。2026-08-21 起 story-validation
        // 的判定单位由「整簇」改为「候选组」——原因与实测见 lib/core/candidate-grouping.ts。
        //
        // 为什么算在**步内**而不是单开一步：向量是 384 维 float，1254 篇约 3.7MB，
        // 跨 step 传会撞 CF Workflow 单 step ~1MB 输出上限（与 embeddings 卸 R2 同一个约束）。
        // 成本上也不需要单开：全量 57 簇 1254 篇实测单线程 28ms。
        const { groups: candidateGroups, skippedNoEmbedding } = buildCandidateGroups(
          clusteringResult.clusters,
          dataset.embeddings,
          CANDIDATE_GROUP_THRESHOLD
        );
        if (skippedNoEmbedding.length > 0) {
          // 缺向量的文章无法参与几何分组。正常应为 0（进稿侧已补算），非 0 说明补算漏了，
          // 而它会静默表现为「这些文章没进任何故事」，故显式告警。
          console.warn(`[AutoBrief] ${skippedNoEmbedding.length} 篇文章缺 embedding，未参与候选分组`);
        }
        const groupedArticles = new Set(candidateGroups.flatMap(g => g.articleIds));
        console.log(
          `[AutoBrief] 候选分组：${clusteringResult.clusters.length} 簇 → ${candidateGroups.length} 组，` +
          `进组 ${groupedArticles.size}/${dataset.articles.length} 篇`
        );

        console.log(`[AutoBrief] 调用真正的AI Worker故事验证服务，处理 ${candidateGroups.length} 个候选组`);
        
        // 使用真正的AI Worker故事验证服务
        const validation = await aiServices.aiWorker.validateStory(
          clusteringResult, // ClusteringResult 对象（供 ai-worker 统计口径与落单留痕）
          candidateGroups,  // CandidateGroup[] 判定单位
          articlesData,     // MinimalArticleInfo[] 数组
          {
            // 不传 aiOptions：provider/model 由 ai-worker 的 PHASE_DEFAULTS 决定（调 LLM 的单一
            // 配置入口）。跨 service 传 provider/model 等于在网线这头开第二个真源——2026-08-12
            // 迁 Workers AI 时正是这里把 story_validation 拽回已失效的 DashScope，15 个聚类
            // 全部 401 → 降级 no_stories → 工作流「未发现有效故事」终止。
          }
        );

        if (!validation.ok) {
          console.error(`[AutoBrief] 故事验证失败: ${validation.error}`);
          throw new Error(`故事验证失败: ${validation.error}`);
        }

        const validatedStories = validation.value;
        console.log(`[AutoBrief] 故事验证成功: ${validatedStories.stories.length} 个有效故事, ${validatedStories.rejectedClusters.length} 个拒绝聚类`);
        
        // 记录验证结果详情
        if (validatedStories.stories.length > 0) {
          console.log(`[AutoBrief] 有效故事列表:`);
          validatedStories.stories.forEach((story: any, index: number) => {
            console.log(`  ${index + 1}. ${story.title} (重要性: ${story.importance}, 文章数: ${story.articleIds.length})`);
          });
        }
        
        if (validatedStories.rejectedClusters.length > 0) {
          console.log(`[AutoBrief] 拒绝聚类列表:`);
          validatedStories.rejectedClusters.forEach((cluster: any, index: number) => {
            console.log(`  ${index + 1}. 聚类 ${cluster.clusterId} - 原因: ${cluster.rejectionReason} (文章数: ${cluster.originalArticleIds.length})`);
          });
        }
        
        return validatedStories;
      });

      await observability.logStep('story_validation', 'completed', {
        validStoriesCount: validatedStories.stories.length,
        rejectedClustersCount: validatedStories.rejectedClusters.length,
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

      // ======================================================================
      // 去重：把 story-validation 从**同一个簇**里切出来的重复故事并回去。
      //
      // 病灶（2026-08-30 实测 + 94 条人工金标）：一场尼泊尔冰川溃决洪水的 91 篇报道被切成
      // 22 个故事，占掉 25 个名额里的 11 个，把基辅无人机袭击致 37 死等挤出简报；8/28 同一场
      // 灾难复现（74 篇 → 14 个）。判据与阈值来历见 lib/core/story-dedup.ts 的文件头。
      //
      // 位置在覆盖度与排序**之前**：放在 b′ 那层只能治观感，名额早已花掉，被挤走的真新闻
      // 追不回来。落库在此之前已完成，故 centroid 可现场补算。
      // ======================================================================
      // 去重失败不该连坐整期：合不上顶多是大事件多占几个名额，简报照出；抛出去则今天没有简报。
      // 不是静默降级——失败走 error 级日志，且 candidateGroups=-1 是"这一步压根没跑成"的可判别信号
      // （正常至少是 0）。
      type DedupPlan = {
        groups: Array<{ indices: number[]; title: string; minCos: number; confirmed: boolean }>;
        candidateGroups: number;
        centroidsFilled: number;
      };
      let dedupPlan: DedupPlan;
      try {
        dedupPlan = await step.do('故事去重', dedupStepConfig, async (): Promise<DedupPlan> => {
          const db = getDb(this.env.HYPERDRIVE);
          // 幂等：只补 centroid IS NULL 的行。工作流末尾的 assignStoryClustersForWorkflow 仍会再调一次。
          const filled = await backfillStoryCentroids(db, workflowId);
          console.log(`[AutoBrief] 去重：补算 ${filled} 条 story centroid`);

          const rows = (await db.execute(sql`
            SELECT a.id AS a_id, b.id AS b_id, (1 - (a.centroid <=> b.centroid)) AS cos
            FROM brief_stories a
            JOIN brief_stories b
              ON b.workflow_id = a.workflow_id AND b.cluster_id = a.cluster_id AND a.id < b.id
            WHERE a.workflow_id = ${workflowId}
              AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL
              AND (1 - (a.centroid <=> b.centroid)) >= ${DEFAULT_MIN_COSINE}
          `)) as unknown as Array<{ a_id: number; b_id: number; cos: number }>;

          // rowId → stories 下标。briefStoryRowIds 是按 stories 顺序插入返回的主键。
          const rowIdToIndex = new Map<number, number>();
          briefStoryRowIds.forEach((rowId, i) => { if (typeof rowId === 'number') rowIdToIndex.set(rowId, i); });

          const items: DedupStory[] = validatedStories.stories.map((st: any, i: number) => ({
            index: i,
            clusterId: st.clusterId ?? -1,
            importance: st.importance ?? 0,
            articleIds: Array.isArray(st.articleIds) ? st.articleIds : [],
            title: st.title ?? '',
          }));
          const pairs: CosinePair[] = rows
            .map(r => ({ a: rowIdToIndex.get(Number(r.a_id))!, b: rowIdToIndex.get(Number(r.b_id))!, cos: Number(r.cos) }))
            .filter(p => Number.isInteger(p.a) && Number.isInteger(p.b));

          const groups = buildMergeGroups(items, pairs);
          console.log(`[AutoBrief] 去重：候选合并组 ${groups.length} 个（需 LLM 确认 ${groups.filter(g => g.needsConfirm).length} 个）`);

          // 确认 + 起标题。两条一组才确认（单边支撑，余弦分不开真假）；≥3 条只起标题。
          const dedupAi = createAIServices(this.env, workflowId);
          const decided: Array<{ indices: number[]; title: string; minCos: number; confirmed: boolean }> = [];
          for (const [groupIdx, g] of groups.entries()) {
            const candidates = g.indices.map(i => ({
              title: items[i].title,
              articleTitles: items[i].articleIds
                .map(aid => dataset.articles.find(a => a.id === aid)?.title)
                .filter((t): t is string => !!t)
                .slice(0, 4),
            }));
            // groupIdx 作为 call index：不传的话 R2 日志 key 恒为 story_merge-000.json，
            // 10+ 个组只留得下最后一个——而这一层最需要人工复核"判得对不对"。
            const res = await dedupAi.aiWorker.checkStoryMerge(candidates, groupIdx);
            if (!res.ok) {
              // 调用失败不静默合并：合错的代价是两件事被写成一件，读者看不出来。
              console.warn(`[AutoBrief] 去重确认失败，放弃本组: ${res.error}`);
              continue;
            }
            if (!res.value.same_occurrence || !res.value.title) {
              console.log(`[AutoBrief] 去重：LLM 判为不同发生，放弃合并 [${g.indices.join(',')}] — ${res.value.reason}`);
              continue;
            }
            decided.push({ indices: g.indices, title: res.value.title, minCos: g.minCos, confirmed: g.needsConfirm });
          }
          return { groups: decided, candidateGroups: groups.length, centroidsFilled: filled };
        });
      } catch (dedupErr) {
        console.error(
          `[AutoBrief] 去重步失败，跳过去重继续出简报: ${dedupErr instanceof Error ? dedupErr.message : String(dedupErr)}`
        );
        dedupPlan = { groups: [], candidateGroups: -1, centroidsFilled: 0 };
      }

      // 应用合并（纯代码，放在 step 外：step 只回小决策，不回整份 story 数组）
      if (dedupPlan.groups.length > 0) {
        const publishedAt = new Map<number, number>();
        for (const a of dataset.articles) {
          const t = Date.parse(a.publishDate);
          if (Number.isFinite(t)) publishedAt.set(a.id, t);
        }
        const mergedIn = new Set<number>();
        const additions: any[] = [];
        // 合并结果待回写 DB 的主行。见下方 persist:story_dedup_merge 的注释。
        const mergeWriteback: Array<{ rowId: number; title: string; importance: number; articleIds: number[] }> = [];
        for (const g of dedupPlan.groups) {
          const members: DedupStory[] = g.indices.map((i: number) => ({
            index: i,
            clusterId: validatedStories.stories[i].clusterId ?? -1,
            importance: validatedStories.stories[i].importance ?? 0,
            articleIds: validatedStories.stories[i].articleIds ?? [],
            title: validatedStories.stories[i].title ?? '',
          }));
          const merged = collapseGroup(members, g.title, publishedAt, DEFAULT_ARTICLE_CAP);
          const survivors = new Set(merged.articleIds);
          // 一个合并组 = 一条 story = 一份情报报告 = 简报里的一块，所以 DB 侧也只认**一行**。
          //
          // 曾经这里标的是「全部还有文章活下来的成员」。那会让下游把同一份报告数成 N 条：
          // 覆盖对账的母集是 selected_for_intel=true 且 intel_report_r2_key 非空，尼泊尔 11 条
          // 全标上就变成 1 条进简报、10 条判「合成层漏报」——凭空造出十条不存在的缺陷，
          // 而合成漏报正是 memory synthesis-omission-fix 那条线的核心读数。
          // 前端来源清单、story 线索建线同理，都会按 N 倍虚增。
          //
          // 主行取「第一个有文章活下来的成员」，其余成员留在库里、保持 selected_for_intel=false
          // ——它们是 story-validation 过拆的证据，不该删，但确实没有作为独立故事送进情报分析。
          // 主行的 title/article_ids 由下面的回写步改成合并后的值，否则库里那行仍是拆碎的旧样子。
          const contributing = g.indices.filter(
            (i: number) => (validatedStories.stories[i].articleIds ?? []).some((aid: number) => survivors.has(aid))
          );
          const primaryIdx: number = contributing.length > 0 ? contributing[0] : g.indices[0];
          const primaryRowId = briefStoryRowIds[primaryIdx];
          if (typeof primaryRowId === 'number') {
            mergeWriteback.push({
              rowId: primaryRowId,
              title: merged.title,
              importance: merged.importance,
              articleIds: merged.articleIds,
            });
          }
          additions.push({
            title: merged.title,
            importance: merged.importance,
            articleIds: merged.articleIds,
            storyType: merged.storyType,
            clusterId: members[0].clusterId,
            // 下游 mark_selected_for_intel 用它精确标记，不能再靠 stories.indexOf（合并后下标全变）。
            __briefStoryRowIds: typeof primaryRowId === 'number' ? [primaryRowId] : [],
          });
          g.indices.forEach((i: number) => mergedIn.add(i));
          console.log(
            `[AutoBrief] 去重：${g.indices.length} 条 → 1（余弦≥${g.minCos.toFixed(4)}${g.confirmed ? '，已确认' : ''}）` +
            `文章 ${members.reduce((n, m) => n + m.articleIds.length, 0)} → ${merged.articleIds.length}｜${g.title}`
          );
        }
        const kept = validatedStories.stories
          .map((st: any, i: number) => ({ st, i }))
          .filter(({ i }: { i: number }) => !mergedIn.has(i))
          .map(({ st, i }: { st: any; i: number }) => ({ ...st, __briefStoryRowIds: [briefStoryRowIds[i]].filter(x => typeof x === 'number') }));
        const before = validatedStories.stories.length;
        validatedStories.stories = [...kept, ...additions];
        console.log(`[AutoBrief] 去重完成：${before} → ${validatedStories.stories.length} 个故事`);

        // 合并结果回写主行。不回写的话合并只活在内存里：库里主行还挂着拆碎前的旧标题和
        // 只属于自己那几篇的 article_ids，而简报正文用的是 LLM 起的合并标题——那个标题
        // **在数据库里不存在**，简报正文就再也对不回 brief_stories（eval 与前端来源都靠这个对齐）。
        // 值由确定性代码算出，重放时写入同样的值，故幂等。
        if (mergeWriteback.length > 0) {
          await step.do('persist:story_dedup_merge', dbStepConfig, async () => {
            const db = getDb(this.env.HYPERDRIVE);
            for (const m of mergeWriteback) {
              await db
                .update($brief_stories)
                .set({
                  title: m.title,
                  importance: m.importance,
                  article_count: m.articleIds.length,
                  article_ids: m.articleIds,
                  // centroid 置空让工作流末尾的 assignStoryClustersForWorkflow 按合并后的
                  // article_ids 重算（backfillStoryCentroids 只补 NULL 的行）。留着旧值的话，
                  // 这行的向量还是拆碎前那几篇算的，跨期线索匹配与代表文章都会挑错。
                  centroid: null,
                })
                .where(and(eq($brief_stories.workflow_id, workflowId), eq($brief_stories.id, m.rowId)));
            }
            console.log(`[AutoBrief] 去重：回写 ${mergeWriteback.length} 条合并主行`);
          });
        }
      } else {
        // 没有合并也要补 __briefStoryRowIds，否则下游标记逻辑得分叉
        validatedStories.stories = validatedStories.stories.map((st: any, i: number) => ({
          ...st, __briefStoryRowIds: [briefStoryRowIds[i]].filter(x => typeof x === 'number'),
        }));
      }

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
      const { ranked, selected: storiesForIntelligence } = rankStoriesForIntelligence(
        validatedStories.stories,
        sourceCoverage,
        { coverageWeight: COVERAGE_WEIGHT, maxStories: maxStoriesToGenerate }
      );

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

      // 【每故事一个 step】原先 25 个故事全挤在一个 15-25 分钟的单 step 里，是"全有或全无"：
      // 平台侧一次 canceled（本账号基线约 2%：过去 6 天 5090 ok / 110 canceled）就整步作废，
      // 重试还得把 25 个故事从头再跑一遍。2026-08-26 第 73 期就是这么丢的——两次尝试都被 cancel，
      // 而那时 25 份情报报告其实早已全部落进 R2（CPU 仅 240ms、墙钟 972s，纯粹是等 I/O 时被掐）。
      // 拆开之后：一次 cancel 只损失那一个故事，由 Workflows 单独重试它；已完成的故事在实例
      // 重放时从 state 恢复、不会重跑，所以也不必再加"先查 R2 是否已存在"的补丁。
      // 并发仍由 batchProcessParallel 卡在 6，不让 25 路同时打 provider。
      console.log(`[AutoBrief] 开始情报分析，从 ${validatedStories.stories.length} 个候选故事中选取 top-${storiesForIntelligence.length}`);

      const intelAiServices = createAIServices(this.env, workflowId);
      // 各 story 完全独立(各读各的 R2、各落各自 intel-reports/{wf}/{idx}.json key)。原串行 for 是
      // 端到端 wall-clock 第一大头(N× LLM，每次 30-90s)。实测并发=3 把 15 故事从 ~18min 压到 ~6min;
      // 提到 6 预计 ~3min。撞限流由 AIGateway 配额退避兜底; 不破坏 R2 卸载对 ~1MB step 输出上限的规避。
      const INTEL_CONCURRENCY = 6;

      type IntelOutcome = { r2Key: string } | { failure: { idx: number; title: string; reason: string } };
      const analyzeOneStory = async (story: any, idx: number): Promise<IntelOutcome> => {
        try {
          // 为情报分析动态获取相关文章的内容
          const clusterArticles = await this.getArticleContents(story.articleIds, dataset);

          // story 已是合规 Story({title,importance,articleIds,storyType})，直接传。
          // 曾误包成 {storyId,analysis} 丢掉 articleIds，致 intel service 在 story.articleIds.length 抛 TypeError，全故事失败。
          const result = await intelAiServices.aiWorker.analyzeStoryIntelligence(
            story,
            clusterArticles,
            { analysis_depth: 'detailed' },
            idx
          );

          if (!result.ok) {
            // 非成功别静默丢弃：曾因此让 0 报告以 brief_generation "HTTP 500" 的假象冒出，极难诊断。
            // result.error 保留原措辞（非200="HTTP <s>: <body>"、success:false="success:false: <e>"）。
            console.error(`[AutoBrief] 情报分析失败 (idx=${idx}, "${story.title}"): ${result.error}`);
            return { failure: { idx, title: story.title, reason: result.error } };
          }

          // intel report 全文落 R2;step 只返回 R2 key,避免 N 份报告内联超 ~1MB step 输出上限
          // (旧实现 return reports[全文] → maxStoriesToGenerate 大时触发 WorkflowInternalError)。
          const r2Key = `intel-reports/${workflowId}/${idx}.json`;
          await this.env.ARTICLES_BUCKET.put(r2Key, JSON.stringify(result.value, null, 2));

          // R2 key 记到 brief_stories(观测;落库失败不致命)
          try {
            // **不能按 cluster_id**：一个簇会产出多个故事、共享同一个 cluster_id，按它更新会把
            // 整簇的行都写上同一个 r2 key（同 60 行前 mark_selected_for_intel 处的坑，那里已修）。
            // 用 story 自带的 __briefStoryRowIds，与 selected_for_intel 走同一套主键。
            const rowIds: number[] = Array.isArray(story.__briefStoryRowIds)
              ? story.__briefStoryRowIds.filter((id: any) => typeof id === 'number')
              : [];
            if (rowIds.length === 0) {
              console.warn(`[AutoBrief] intel_report_r2_key 跳过落库：story 无 brief_stories 主键 (idx=${idx})`);
            } else {
              const db = getDb(this.env.HYPERDRIVE);
              await db
                .update($brief_stories)
                .set({ intel_report_r2_key: r2Key })
                .where(and(eq($brief_stories.workflow_id, workflowId), inArray($brief_stories.id, rowIds)));
            }
          } catch (persistErr) {
            console.warn(`[AutoBrief] intel_report_r2_key 落库失败 (workflow=${workflowId}, idx=${idx}):`, persistErr);
          }
          return { r2Key };
        } catch (error) {
          // R2 put 失败/异常 → 该 story 跳过(可接受的罕见丢失)，不连坐其他 story
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[AutoBrief] 故事情报分析失败 (idx=${idx}): ${reason}`);
          return { failure: { idx, title: story.title, reason } };
        }
      };

      const results = await this.batchProcessParallel(
        storiesForIntelligence,
        INTEL_CONCURRENCY,
        (story: any, idx: number): Promise<IntelOutcome> =>
          step
            .do(`情报分析:故事${idx}`, perStoryIntelStepConfig, () => analyzeOneStory(story, idx))
            // 重试耗尽后 step 会 reject，而 batchProcessParallel 用 allSettled 且只 console.warn——
            // 不接住的话这个故事会静默消失。转成一条明确的 failure，走既有的失败对账。
            .catch((e: unknown): IntelOutcome => {
              const reason = `step 重试耗尽: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`[AutoBrief] 情报分析 step 最终失败 (idx=${idx}, "${story.title}"): ${reason}`);
              return { failure: { idx, title: story.title, reason } };
            })
      );

      // 失败对账：把成功(r2Key)与失败(failure)分开，失败原因随后落观测性对账。
      const intelligenceReports = results.filter((r): r is { r2Key: string } => 'r2Key' in r);
      const intelFailures = results
        .filter((r): r is { failure: { idx: number; title: string; reason: string } } => 'failure' in r)
        .map((r) => r.failure);

      console.log(`[AutoBrief] 情报分析完成: ${intelligenceReports.length} 份情报报告${intelFailures.length ? `，${intelFailures.length} 个故事失败` : ''}`);
      // 全部失败必须显式失败：空报告下传只会以 brief_generation "HTTP 500" 假象冒出，难以诊断。
      // 拆 step 后每个故事已各自重试过，这里不再整批重来，直接终止。
      if (storiesForIntelligence.length > 0 && intelligenceReports.length === 0) {
        throw new Error(`情报分析对全部 ${storiesForIntelligence.length} 个故事均失败，无可用报告（详见上方各故事错误日志）`);
      }

      // 失败对账：选中 N 个 story、实际产出 M 份报告；M<N 记 'degraded' + 落每条失败原因，
      // 供 /observability/runs/:wf 直接查（防"选了 14 只做出 13、头条静默消失"这类无人对账）。
      await observability.logStep(
        'intelligence_analysis',
        intelFailures.length > 0 ? 'degraded' : 'completed',
        {
          expected: storiesForIntelligence.length,
          reportsGenerated: intelligenceReports.length,
          failedCount: intelFailures.length,
          failures: intelFailures,
        }
      );

      // =====================================================================
      // 步骤 5: 简报生成 (AI Worker)
      // =====================================================================
      await observability.logStep('brief_generation', 'started');

      // ── b′ 分段写 ────────────────────────────────────────────────────────
      // 原先是「一次调用把 N 份报告写成一篇简报」。实测（第 75 期 25 份报告）那条路
      // 落地率只有 12%-56%（3-14 块，天天跳），且 1/4 期的 RARR 校验会整期复读失效、
      // 静默发布未校对稿。b′ 把结构从模型手里拿走：
      //   规划 1 次   →  逐块 N 次（每块只看自己那份报告，防串源）  →  拼装 0 次 LLM
      // 落地率 25/25、两轮零失败；块数与覆盖由代码保证，不靠模型自觉。
      //
      // ⚠️ fan-out 必须在 backend、不能塞进 ai-worker 内部并发：CF 侧约 2% 的 invocation
      // 会被平台 canceled，N 次调用挤一个 step 就是 16efc42 刚修完那个 bug 的翻版。
      //
      // 前日简报上下文已停用（b′ 也不传）：它把昨天 brief 的 TLDR（一串主题标识符）回灌
      // 进来，brief 会无视 guardrail 把这些标识符展开成编造的整节，再被 TLDR 压回、次日
      // 重灌，形成自我强化的编造反馈环（详见 .claude/pain-log.md 2026-05-28）。
      const reportKeys = intelligenceReports.map(({ r2Key }: { r2Key: string }) => r2Key);

      // 5a 骨架规划：1 次调用，只读 N 条 executiveSummary（不读全文），量级很小。
      const skeletonStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '10 seconds', backoff: 'linear' },
        timeout: '5 minutes',
      };
      const skeleton = await step.do('简报骨架规划', skeletonStepConfig, async () => {
        const aiServices = createAIServices(this.env, workflowId);
        const plan = await aiServices.aiWorker.planBriefSkeleton(reportKeys);
        // 规划失败硬失败：静默兜底成"全部进独立事态"会产出一份没有任何因果主线的简报，
        // 而它在覆盖率/块数上看起来完全正常——正是本项目反复栽的"失败静默降级"。
        if (!plan.ok) throw new Error(`简报骨架规划失败: ${plan.error}`);
        const s = plan.value;
        console.log(
          `[AutoBrief] 简报骨架：主线 ${s.main.length} 节 / 独立事态 ${s.isolated.length} 条` +
            (s.repaired?.length ? `（规划漏掉 ${s.repaired.join(',')}，已由代码补进独立事态）` : '')
        );
        return s;
      });

      // 5b 逐块写作：一份报告一个 step。每个块 = 1 次写作调用 + 1 次 RARR 校验调用。
      const briefBlockStepConfig: WorkflowStepConfig = {
        retries: { limit: 2, delay: '10 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      // 与情报分析同档：不让 N 路同时打 provider，撞限流由 AIGateway 配额退避兜底。
      const BRIEF_BLOCK_CONCURRENCY = 6;

      type BlockJob = {
        /** 1 基的 story 序号（骨架里的 i）；端点要的是 0 基下标，差 1 */
        i: number;
        title: string;
        section?: { heading: string; causalLink: string; siblingIndices: number[] };
      };
      const blockJobs: BlockJob[] = [
        ...skeleton.main.flatMap((s) =>
          s.reports.map((r) => ({
            i: r.i,
            title: r.title,
            section: {
              heading: s.heading,
              causalLink: s.causalLink,
              // 同节兄弟的 0 基下标，供 ai-worker 取摘要做"别重复叙述"的提示
              siblingIndices: s.reports.filter((x) => x.i !== r.i).map((x) => x.i - 1),
            },
          }))
        ),
        ...skeleton.isolated.map((r) => ({ i: r.i, title: r.title })),
      ];

      type BlockOutcome =
        | { block: { index: number; title: string; text: string; verified: boolean } }
        | { failure: { i: number; title: string; reason: string } };

      const blockOutcomes = await this.batchProcessParallel(
        blockJobs,
        BRIEF_BLOCK_CONCURRENCY,
        (job: BlockJob): Promise<BlockOutcome> =>
          step
            .do(`简报块:${job.i}`, briefBlockStepConfig, async (): Promise<BlockOutcome> => {
              const aiServices = createAIServices(this.env, workflowId);
              const res = await aiServices.aiWorker.writeBriefBlock(reportKeys, job.i - 1, job.title, job.section);
              if (!res.ok) throw new Error(res.error);
              const b = res.value;
              if (!b.verified) {
                // 没经过 RARR 核验 ≠ 核过且干净。不阻断（校验是末端兜底），但要可见。
                console.warn(`[AutoBrief] 简报块 ${job.i}「${job.title}」未经 RARR 核验（校验调用失败或响应坏）`);
              }
              return { block: { index: b.index, title: b.title, text: b.text, verified: b.verified } };
            })
            // 重试耗尽后 step 会 reject，而 batchProcessParallel 用 allSettled 且只 console.warn
            // ——不接住的话这个块会静默消失，而拼装步照样产出一份"看起来正常"的简报。
            .catch((e: unknown): BlockOutcome => {
              const reason = `step 重试耗尽: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`[AutoBrief] 简报块 step 最终失败 (story=${job.i}, "${job.title}"): ${reason}`);
              return { failure: { i: job.i, title: job.title, reason } };
            })
      );

      const writtenBlocks = blockOutcomes
        .filter((r): r is { block: { index: number; title: string; text: string; verified: boolean } } => 'block' in r)
        .map((r) => r.block);
      const blockFailures = blockOutcomes
        .filter((r): r is { failure: { i: number; title: string; reason: string } } => 'failure' in r)
        .map((r) => r.failure);
      const unverifiedCount = writtenBlocks.filter((b) => !b.verified).length;

      console.log(
        `[AutoBrief] 简报块写作完成: ${writtenBlocks.length}/${blockJobs.length}` +
          (blockFailures.length ? `，${blockFailures.length} 个块失败` : '') +
          (unverifiedCount ? `，${unverifiedCount} 个块未经 RARR 核验` : '')
      );
      if (writtenBlocks.length === 0) {
        throw new Error(`简报块写作对全部 ${blockJobs.length} 个块均失败，无可拼装内容（详见上方各块错误日志）`);
      }
      await observability.logStep(
        'brief_blocks',
        blockFailures.length > 0 ? 'degraded' : 'completed',
        {
          expected: blockJobs.length,
          written: writtenBlocks.length,
          failedCount: blockFailures.length,
          unverified: unverifiedCount,
          failures: blockFailures,
          mainSections: skeleton.main.length,
          isolated: skeleton.isolated.length,
          repaired: skeleton.repaired ?? [],
        }
      );

      // 5c 拼装：结构部分零 LLM（<u> 包装、章节归属、覆盖对账全由代码做），
      // 唯一的调用是给整篇起标题。
      const briefAssembleStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '5 seconds', backoff: 'linear' },
        timeout: '10 minutes',
      };
      const assembled = await step.do('简报拼装', briefAssembleStepConfig, async () => {
        const aiServices = createAIServices(this.env, workflowId);
        const res = await aiServices.aiWorker.assembleBrief(reportKeys, skeleton, writtenBlocks);
        if (!res.ok) throw new Error(`简报拼装失败: ${res.error}`);

        // 观测性：覆盖对账落 R2。b′ 下这份账是**确定已知**的调用结果（每份报告恰好一个块，
        // 成功=headline、块 step 失败=dropped），不再是判官事后猜去向——也因此不再需要
        // 两遍法补录（补录治的是"整篇合成静默丢 story"，b′ 从结构上没有这个自由度）。
        const coverage = Array.isArray((res.metadata as any)?.coverage) ? (res.metadata as any).coverage : [];
        if (coverage.length) {
          try {
            const tally = (d: string) => coverage.filter((c: any) => c?.disposition === d).length;
            await this.env.ARTICLES_BUCKET.put(
              `observability/coverage/${workflowId}.json`,
              JSON.stringify(
                {
                  workflowId,
                  createdAt: new Date().toISOString(),
                  path: 'bprime',
                  summary: {
                    total: coverage.length,
                    headline: tally('headline'),
                    noteworthy: tally('noteworthy'),
                    dropped: tally('dropped'),
                  },
                  // b′ 没有补录环节，故与 summary 同值。字段保留是为了让跨期查询不用分叉。
                  summaryBeforeRepair: null,
                  coverage,
                  // 两个确定性传感器的读数（只报不改）
                  hygiene: (res.metadata as any)?.hygiene_findings ?? [],
                  consistency: (res.metadata as any)?.consistency_findings ?? [],
                },
                null,
                2
              )
            );
            console.log(`[AutoBrief] 覆盖对账落盘: ${coverage.length} story (dropped ${tally('dropped')})`);
          } catch (persistErr) {
            console.warn(`[AutoBrief] 覆盖对账落盘失败 (workflow=${workflowId}):`, persistErr);
          }
        }

        return {
          title: res.value.title,
          content: res.value.content,
          model_used: (res.metadata as any)?.model_used || 'unknown',
          hygieneCount: ((res.metadata as any)?.hygiene_findings ?? []).length,
          consistencyCount: ((res.metadata as any)?.consistency_findings ?? []).length,
        };
      });

      console.log(
        `[AutoBrief] 成功生成简报: ${assembled.title}（${assembled.content.length} 字符）` +
          `，卫生 ${assembled.hygieneCount} 条 / 跨块数值冲突 ${assembled.consistencyCount} 处`
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
      if (skipFaithfulnessGate) {
        console.log('[AutoBrief] 忠实度门：本次按 skipFaithfulnessGate 跳过(测试迭代)');
        await observability.logStep('faithfulness_gate', 'completed', { skipped: true, reason: 'skip_param' });
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