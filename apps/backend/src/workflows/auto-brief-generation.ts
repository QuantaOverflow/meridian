import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/database';
import { $articles, $reports, $sources, $brief_runs, $brief_stories, $cluster_rejections, gte, lte, isNotNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/observability/dataflow';
import { createClusteringService, type ArticleDataset, type ClusteringResult } from '../lib/services/clustering';
import { createAIServices } from '../lib/services/ai-services';
import { looksLikeExtractionFailure } from '../lib/core/extraction-quality';
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

const defaultStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
  timeout: '2 minutes',
};

const dbStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '1 second', backoff: 'linear' },
  timeout: '30 seconds',
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
      maxStoriesToGenerate = 15,
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

        console.log(`[AutoBrief] 聚类分析完成: 发现 ${response.data!.clusters.length} 个聚类`);
        return response.data!;
      });

      await observability.logStep('clustering_analysis', 'completed', {
        clustersFound: clusteringResult.clusters.length,
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
      
      const validatedStories = await step.do('执行故事验证', defaultStepConfig, async () => {
        console.log(`[AutoBrief] 开始故事验证，处理 ${clusteringResult.clusters.length} 个聚类`);
        
        // 创建 AI 服务实例（注入 trace_id 以贯通跨 service 日志）
        const aiServices = createAIServices(this.env, workflowId);

        // 构建故事验证请求数据 - 使用真实的数据库字段
        const db = getDb(this.env.HYPERDRIVE);
        const articleIds = dataset.articles.map(a => a.id);
        
        const articleMetadata = await db
          .select({
            id: $articles.id,
            title: $articles.title,
            url: $articles.url,
            event_summary_points: $articles.event_summary_points
          })
          .from($articles)
          .where(and(
            eq($articles.status, 'PROCESSED'),
            isNotNull($articles.embedding)
          ))
          .limit(50);
        
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
        
        console.log(`[AutoBrief] 调用真正的AI Worker故事验证服务，处理 ${clusteringResult.clusters.length} 个聚类`);
        console.log(`[AutoBrief] 发送数据：聚类结果包含 ${clusteringResult.clusters.length} 个聚类，文章数据包含 ${articlesData.length} 个条目`);
        
        // 使用真正的AI Worker故事验证服务
        const validationResponse = await aiServices.aiWorker.validateStory(
          clusteringResult, // ClusteringResult 对象
          articlesData,     // MinimalArticleInfo[] 数组
          {
            useAI: true,    // 启用AI验证
            aiOptions: {
              provider: 'dashscope',
              model: 'qwen-plus'
            }
          }
        );

        if (validationResponse.status !== 200) {
          const errorText = await validationResponse.text();
          console.error(`[AutoBrief] 故事验证失败，HTTP状态: ${validationResponse.status}`);
          console.error(`[AutoBrief] 错误详情: ${errorText}`);
          throw new Error(`故事验证失败: HTTP ${validationResponse.status} - ${errorText}`);
        }

        const validationData = await validationResponse.json() as any;
        
        if (!validationData.success) {
          console.error(`[AutoBrief] 故事验证业务逻辑失败: ${validationData.error}`);
          throw new Error(`故事验证业务逻辑失败: ${validationData.error}`);
        }

        const validatedStories = validationData.data;
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

      // 观测性：写入 brief_stories + cluster_rejections。delete+insert 保证 step 重试时幂等
      await step.do('persist:brief_stories_and_rejections', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        await db.delete($brief_stories).where(eq($brief_stories.workflow_id, workflowId));
        await db.delete($cluster_rejections).where(eq($cluster_rejections.workflow_id, workflowId));
        if (validatedStories.stories.length > 0) {
          await db.insert($brief_stories).values(
            validatedStories.stories.map((s: any, i: number) => ({
              workflow_id: workflowId,
              cluster_id: s.clusterId ?? i + 1,
              title: s.title ?? null,
              importance: typeof s.importance === 'number' ? s.importance : null,
              article_count: Array.isArray(s.articleIds) ? s.articleIds.length : null,
              article_ids: Array.isArray(s.articleIds) ? s.articleIds : null,
              selected_for_intel: false,
            }))
          );
        }
        if (validatedStories.rejectedClusters.length > 0) {
          await db.insert($cluster_rejections).values(
            validatedStories.rejectedClusters.map((c: any) => ({
              workflow_id: workflowId,
              cluster_id: typeof c.clusterId === 'number' ? c.clusterId : null,
              reason: c.rejectionReason ?? null,
              article_count: Array.isArray(c.originalArticleIds) ? c.originalArticleIds.length : null,
            }))
          );
        }
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
            clustersFound: clusteringResult.clusters.length,
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
              clusters_found: clusteringResult.clusters.length,
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
      
      // 情报深度分析这一步串行调多次 qwen-long，每次 30-90s，需要更长 timeout
      const intelligenceStepConfig: WorkflowStepConfig = {
        retries: { limit: 1, delay: '10 seconds', backoff: 'linear' },
        timeout: '30 minutes',
      };

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

      // 选择分 = LLM importance + 覆盖度加权。log2(1+源数) 取边际递减(第2个独立源比第6个信息量大)，
      // COVERAGE_WEIGHT=1.0 让 importance 仍主导、覆盖度只做有界 nudge(满额约 +3)。
      // 这是无 eval 前的保守默认权重；①NDCG eval 上线后据此校准，故做成单常量便于调。
      const COVERAGE_WEIGHT = 1.0;
      const ranked = validatedStories.stories
        .map((s: any, i: number) => {
          const srcs = sourceCoverage[i] ?? 0;
          return { s, srcs, score: (s.importance ?? 0) + COVERAGE_WEIGHT * Math.log2(1 + srcs) };
        })
        .sort((a: any, b: any) => b.score - a.score);

      // 按选择分降序取 top-N，避免把全部候选送进 LLM 深度分析（成本/时间爆炸）
      const storiesForIntelligence = ranked.slice(0, maxStoriesToGenerate).map((x: any) => x.s);

      console.log('[AutoBrief] 选择层(importance + 多源覆盖度) top-N:');
      ranked.slice(0, maxStoriesToGenerate).forEach((x: any, rank: number) => console.log(
        `  ${rank + 1}. imp=${x.s.importance} 源=${x.srcs} → 分=${x.score.toFixed(2)} | ${x.s.title}`
      ));

      // 观测性：标记被选中跑 intel 的 stories
      await step.do('persist:mark_selected_for_intel', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        const selectedClusterIds = storiesForIntelligence
          .map((s: any, i: number) => s.clusterId ?? (validatedStories.stories.indexOf(s) + 1))
          .filter((id: any) => id != null);
        if (selectedClusterIds.length > 0) {
          await db
            .update($brief_stories)
            .set({ selected_for_intel: true })
            .where(
              and(
                eq($brief_stories.workflow_id, workflowId),
                inArray($brief_stories.cluster_id, selectedClusterIds)
              )
            );
        }
      });

      const { reports: intelligenceReports, failures: intelFailures } = await step.do('执行情报深度分析', intelligenceStepConfig, async () => {
        console.log(`[AutoBrief] 开始情报分析，从 ${validatedStories.stories.length} 个候选故事中选取 top-${storiesForIntelligence.length}`);

                 const aiServices = createAIServices(this.env, workflowId);
        // 情报分析改限并发并行：各 story 完全独立(各读各的 R2、各落各自 intel-reports/{wf}/{idx}.json key)，
        // 原串行 for 是端到端 wall-clock 第一大头(N× qwen-long，每次 30-90s)。实测并发=3 把 15 故事
        // 从 ~18min 压到 ~6min;提到 6 预计 ~3min。撞 DashScope 限流由 AIGateway 配额退避兜底;
        // 不破坏 R2 卸载对 ~1MB step 输出上限的规避。
        const INTEL_CONCURRENCY = 6;
        const results = await this.batchProcessParallel(
          storiesForIntelligence,
          INTEL_CONCURRENCY,
          async (story: any, idx: number): Promise<{ r2Key: string } | { failure: { idx: number; title: string; reason: string } }> => {
            try {
              // 为情报分析动态获取相关文章的内容
              const clusterArticles = await this.getArticleContents(story.articleIds, dataset);

              // story 已是合规 Story({title,importance,articleIds,storyType})，直接传。
              // 曾误包成 {storyId,analysis} 丢掉 articleIds，致 intel service 在 story.articleIds.length 抛 TypeError，全故事失败。
              const response = await aiServices.aiWorker.analyzeStoryIntelligence(
                story,
                clusterArticles,
                { analysis_depth: 'detailed' },
                idx
              );

              if (response.status !== 200) {
                // 非 200 别静默丢弃：曾因此让 0 报告以 brief_generation "HTTP 500" 的假象冒出，极难诊断
                const errBody = await response.text().catch(() => '<unreadable>');
                const reason = `HTTP ${response.status}: ${errBody.slice(0, 300)}`;
                console.error(`[AutoBrief] 情报分析失败 (idx=${idx}, "${story.title}"): ${reason}`);
                return { failure: { idx, title: story.title, reason } };
              }
              const data = await response.json() as any;
              if (!data.success) {
                const reason = `success:false: ${data.error}`;
                console.error(`[AutoBrief] 情报分析失败 (idx=${idx}, "${story.title}"): ${reason}`);
                return { failure: { idx, title: story.title, reason } };
              }

              // intel report 全文落 R2;step 只返回 R2 key,避免 N 份报告内联超 ~1MB step 输出上限
              // (旧实现 return reports[全文] → maxStoriesToGenerate 大时触发 WorkflowInternalError)。
              const r2Key = `intel-reports/${workflowId}/${idx}.json`;
              await this.env.ARTICLES_BUCKET.put(r2Key, JSON.stringify(data.data, null, 2));

              // R2 key 记到 brief_stories(观测;落库失败不致命)
              try {
                const clusterId = story.clusterId ?? (validatedStories.stories.indexOf(story) + 1);
                const db = getDb(this.env.HYPERDRIVE);
                await db
                  .update($brief_stories)
                  .set({ intel_report_r2_key: r2Key })
                  .where(
                    and(
                      eq($brief_stories.workflow_id, workflowId),
                      eq($brief_stories.cluster_id, clusterId)
                    )
                  );
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
          }
        );
        // 失败对账：把成功(r2Key)与失败(failure)分开，失败原因随 step 返回上传，供观测性落库对账。
        const reports = results.filter((r): r is { r2Key: string } => 'r2Key' in r);
        const failures = results
          .filter((r): r is { failure: { idx: number; title: string; reason: string } } => 'failure' in r)
          .map((r) => r.failure);

        console.log(`[AutoBrief] 情报分析完成: ${reports.length} 份情报报告${failures.length ? `，${failures.length} 个故事失败` : ''}`);
        // 全部失败必须在本层显式失败：空报告下传只会以 brief_generation "HTTP 500" 假象冒出，难以诊断
        if (storiesForIntelligence.length > 0 && reports.length === 0) {
          throw new Error(`情报分析对全部 ${storiesForIntelligence.length} 个故事均失败，无可用报告（详见上方各故事错误日志）`);
        }
        return { reports, failures };
      });

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
      
      const briefResult = await step.do('生成最终简报', defaultStepConfig, async (): Promise<BriefGenerationResultData> => {
        console.log(`[AutoBrief] 开始生成简报，基于 ${intelligenceReports.length} 个情报分析`);
        
        // 前日简报上下文已停用：它把昨天 brief 的 TLDR（一串主题标识符）回灌进来，
        // brief 会无视 guardrail 把这些标识符展开成编造的整节，再被 TLDR 压回、次日重灌，
        // 形成自我强化的编造反馈环（详见 .claude/pain-log.md 2026-05-28）。断源 > 靠模型自觉。
        const previousBrief = null;

        // 情报报告已卸到 R2(上一 step 只回传 keys,避免内联超 1MB)；这里读回全文供简报生成。
        const analysisData = (await Promise.all(
          intelligenceReports.map(async ({ r2Key }: { r2Key: string }) => {
            const obj = await this.env.ARTICLES_BUCKET.get(r2Key);
            return obj ? JSON.parse(await obj.text()) : null;
          })
        )).filter(Boolean);

        // 调用AI Worker的简报生成端点
        const briefRequest = new Request(`http://localhost:8786/meridian/generate-final-brief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-trace-id': workflowId },
          body: JSON.stringify({
            analysisData: analysisData,
            previousBrief: previousBrief,
            options: {
              provider: 'dashscope',
              model: 'qwen-long'
            }
          })
        });

        const briefResponse = await this.env.AI_WORKER.fetch(briefRequest);
        
        try {
          if (briefResponse.status !== 200) {
            throw new Error(`简报生成失败: HTTP ${briefResponse.status}`);
          }

          const briefData = await briefResponse.json() as any;
          if (!briefData.success) {
            throw new Error(`简报生成失败: ${briefData.error}`);
          }

          console.log(`[AutoBrief] 成功生成简报: ${briefData.data.title}`);

          // 观测性：落一份覆盖对账清单到 R2（洞3 方案B）。合成步会静默丢弃已分析的 story
          // （占缺陷 68% 的合成层漏报），此清单记录每条候选 story 的去向 headline/noteworthy/
          // dropped，使合成层漏报事后可追踪、可对账 selected_for_intel。best-effort，不拖垮生成。
          const coverage = Array.isArray(briefData.metadata?.coverage) ? briefData.metadata.coverage : [];
          if (coverage.length) {
            try {
              const tally = (d: string) => coverage.filter((c: any) => c?.disposition === d).length;
              await this.env.ARTICLES_BUCKET.put(
                `observability/coverage/${workflowId}.json`,
                JSON.stringify(
                  {
                    workflowId,
                    createdAt: new Date().toISOString(),
                    summary: {
                      total: coverage.length,
                      headline: tally('headline'),
                      noteworthy: tally('noteworthy'),
                      dropped: tally('dropped'),
                    },
                    coverage,
                  },
                  null,
                  2
                )
              );
              console.log(
                `[AutoBrief] 覆盖对账落盘: ${coverage.length} story (dropped ${tally('dropped')}, noteworthy ${tally('noteworthy')})`
              );
            } catch (persistErr) {
              console.warn(`[AutoBrief] 覆盖对账落盘失败 (workflow=${workflowId}):`, persistErr);
            }
          }

          // 生成TLDR
          const tldrRequest = new Request(`http://localhost:8786/meridian/generate-brief-tldr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-trace-id': workflowId },
            body: JSON.stringify({
              briefTitle: briefData.data.title,
              briefContent: briefData.data.content,
              options: {
                provider: 'dashscope',
                model: 'qwen-plus'
              }
            })
          });

          const tldrResponse = await this.env.AI_WORKER.fetch(tldrRequest);
          
          try {
            if (tldrResponse.status !== 200) {
              throw new Error(`TLDR生成失败: HTTP ${tldrResponse.status}`);
            }

            const tldrData = await tldrResponse.json() as any;
            if (!tldrData.success) {
              throw new Error(`TLDR生成失败: ${tldrData.error}`);
            }

            console.log(`[AutoBrief] 成功生成TLDR`);

            return {
              title: briefData.data.title,
              content: briefData.data.content,
              tldr: tldrData.data.tldr,
              model_author: 'meridian-ai-worker',
              stats: {
                total_articles: dataset.articles.length,
                used_articles: intelligenceReports.length,
                clusters_found: clusteringResult.clusters.length,
                stories_identified: validatedStories.stories.length,
                intelligence_analyses: intelligenceReports.length,
                content_length: briefData.data.content.length,
                model_used: briefData.data.metadata?.model_used || 'qwen-long'
              }
            };
          } finally {
            // 确保释放 TLDR 响应的 RPC stub
            if (tldrResponse && typeof (tldrResponse as any).dispose === 'function') {
              (tldrResponse as any).dispose();
            }
          }
        } finally {
          // 确保释放简报响应的 RPC stub
          if (briefResponse && typeof (briefResponse as any).dispose === 'function') {
            (briefResponse as any).dispose();
          }
        }
      });

      await observability.logStep('brief_generation', 'completed', briefResult.stats);

      // =====================================================================
      // 步骤 5.5: 忠实度门（运行时 fail-closed backstop）
      // 逐句把 brief 对情报报告取证，套门 F 判据(率>15% 且 数>=4，或任一事实矛盾)。
      // 当前=影子模式：算 verdict + 写 observability，但永不拦——零空窗风险，并用真实
      // 流量复校 0.15/4 拟合线。判据标定见 memory: faithfulness-runtime-gate。
      // 切 enforce：把下方常量翻 true，且需先给 brief_run_status 加 'BLOCKED_FAITHFULNESS' 枚举+migration。
      // =====================================================================
      const FAITHFULNESS_GATE_ENFORCE = false;
      // 测试迭代可按 run 跳过门(judge 是 ~100× qwen-max,占 ~3min,影子模式下纯迭代税);
      // 生产 cron 不传此参=默认跑门攒影子数据。见 memory: faithfulness-runtime-gate。
      if (skipFaithfulnessGate) {
        console.log('[AutoBrief] 忠实度门：本次按 skipFaithfulnessGate 跳过(测试迭代,省 ~3min)');
        await observability.logStep('faithfulness_gate', 'completed', { skipped: true, reason: 'skip_param' });
      } else {
        await observability.logStep('faithfulness_gate', 'started');
        // 门要对全部 story 跑 ~100× qwen-max judge(~3min)，远超 defaultStepConfig 的 2min；
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

            const checkRequest = new Request(`http://localhost:8786/meridian/faithfulness-check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-trace-id': workflowId },
              body: JSON.stringify({ sources, brief: briefResult.content }),
            });
            const checkResponse = await this.env.AI_WORKER.fetch(checkRequest);
            try {
              if (checkResponse.status !== 200) {
                // 门本身故障不连坐 brief(fail-open on infra error)：记一条、放行
                console.error(`[AutoBrief] 忠实度门调用失败: HTTP ${checkResponse.status}，放行 brief`);
                return null;
              }
              const checkData = await checkResponse.json() as any;
              return checkData.success ? checkData.data : null;
            } finally {
              if (checkResponse && typeof (checkResponse as any).dispose === 'function') {
                (checkResponse as any).dispose();
              }
            }
          });
        } catch (gateError) {
          // 超时/重试耗尽/任何异常 → fail-open：检查员挂掉，绝不丢弃已生成的 brief
          console.error(`[AutoBrief] 忠实度门检查步骤失败(${gateError instanceof Error ? gateError.message : String(gateError)})，fail-open 放行 brief`);
          faithfulnessVerdict = null;
        }

        if (faithfulnessVerdict) {
          const v = faithfulnessVerdict;
          console.log(`[AutoBrief] 忠实度门: block=${v.block} mode=${FAITHFULNESS_GATE_ENFORCE ? 'enforce' : 'shadow'} ` +
            `reasons=[${(v.block_reasons || []).join(' | ')}] unsupported=${v.genuine_unsupported}/${v.factual_claims} ` +
            `contradicted=${v.contradicted} ana_contra=${v.analytical_contradicting}`);
          await observability.logStep('faithfulness_gate', 'completed', {
            block: v.block,
            enforced: FAITHFULNESS_GATE_ENFORCE,
            block_reasons: v.block_reasons,
            genuine_unsupported: v.genuine_unsupported,
            factual_claims: v.factual_claims,
            unsupported_rate: v.unsupported_rate,
            contradicted: v.contradicted,
            analytical_contradicting: v.analytical_contradicting,
            flagged_factual: v.flagged_factual,
            flagged_analytical: v.flagged_analytical,
          });

          // ---------------------------------------------------------------
          // 路径 B：忠实度修订——把 flagged 的 factual claim 从 brief 删除/剥离。
          // 影子/enforce 都跑：发出前先把无源细节洗掉，不依赖门翻 true。修订是检查员的
          // 下游、保存(步骤6)的上游，改 briefResult.content 即让保存用上修订版。
          // fail-open：修订任何失败都不得连坐已生成的 brief，保留原文照常走。
          // 注：v.block 是修订「前」算的；当前 enforce=false 无影响。将来 enforce 翻 true
          //     时正确序应为 revise→重新 check→仍脏才拦（避免拿旧 verdict 误杀已洗净的 brief）。
          if (v.flagged_factual && v.flagged_factual.length > 0) {
            try {
              const revised: any = await step.do('忠实度修订', faithfulnessStepConfig, async () => {
                const reviseRequest = new Request(`http://localhost:8786/meridian/faithfulness-revise`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-trace-id': workflowId },
                  body: JSON.stringify({ brief: briefResult.content, flaggedFactual: v.flagged_factual }),
                });
                const reviseResponse = await this.env.AI_WORKER.fetch(reviseRequest);
                try {
                  if (reviseResponse.status !== 200) {
                    console.error(`[AutoBrief] 忠实度修订调用失败: HTTP ${reviseResponse.status}，保留原 brief`);
                    return null;
                  }
                  const reviseData = await reviseResponse.json() as any;
                  return reviseData.success ? reviseData.data : null;
                } finally {
                  if (reviseResponse && typeof (reviseResponse as any).dispose === 'function') {
                    (reviseResponse as any).dispose();
                  }
                }
              });
              if (revised && revised.changed) {
                console.log(`[AutoBrief] 忠实度修订: applied=${revised.applied.length} skipped=${revised.skipped.length}，替换 brief content`);
                briefResult.content = revised.revised_brief;
                await observability.logStep('faithfulness_revise', 'completed', {
                  changed: true, applied: revised.applied.length, skipped: revised.skipped.length, edits: revised.applied,
                });
              } else {
                await observability.logStep('faithfulness_revise', 'completed', { changed: false });
              }
            } catch (reviseError) {
              console.error(`[AutoBrief] 忠实度修订步骤失败(${reviseError instanceof Error ? reviseError.message : String(reviseError)})，fail-open 保留原 brief`);
              await observability.logStep('faithfulness_revise', 'failed', {
                reason: reviseError instanceof Error ? reviseError.message : String(reviseError),
              });
            }
          }

          // enforce 才真拦；影子模式即使 block 也照常发出(只留记录)
          if (FAITHFULNESS_GATE_ENFORCE && v.block) {
            await step.do('persist:brief_run_blocked', dbStepConfig, async () => {
              const db = getDb(this.env.HYPERDRIVE);
              await db.update($brief_runs).set({
                status: 'FAILED', // enforce 上线时改 'BLOCKED_FAITHFULNESS'(需先加枚举+migration)
                finished_at: new Date(),
                error: `BLOCKED_FAITHFULNESS: ${v.block_reasons.join('; ')}`,
                brief_content_length: briefResult.content.length,
              }).where(eq($brief_runs.workflow_id, workflowId));
            });
            console.log(`[AutoBrief] ❌ 简报被忠实度门拦截，未发出: ${v.block_reasons.join('; ')}`);
            return {
              success: false,
              reason: 'BLOCKED_FAITHFULNESS',
              message: `简报未通过忠实度门: ${v.block_reasons.join('; ')}`,
            };
          }
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