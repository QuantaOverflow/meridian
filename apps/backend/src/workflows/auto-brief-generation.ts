import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/database';
import { $articles, $reports, $sources, $brief_runs, $brief_stories, $cluster_rejections, gte, lte, isNotNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/observability/dataflow';
import { createClusteringService, type ArticleDataset, type ClusteringResult } from '../lib/services/clustering';
import { createAIServices } from '../lib/services/ai-services';
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
      storyMinImportance = 0.1
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
             .where(
               and(
                 isNotNull($articles.embedding),
                 eq($articles.status, 'PROCESSED'),
                 isNotNull($articles.contentFileKey),
                 ...(article_ids.length > 0 ? [inArray($articles.id, article_ids)] : timeConditions)
               )
             )
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

          const dataset: LightweightArticleDataset = {
            articles,
            embeddings
          };

          console.log(`[AutoBrief] 成功构建数据集: ${articles.length} 篇文章`);
          return dataset;
          
        } catch (error) {
          console.error('[AutoBrief] 准备数据集失败:', error);
          throw new Error(`数据集准备失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

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
        const clusteringService = createClusteringService(this.env);
        
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

      // =====================================================================
      // 步骤 3: 故事验证 (AI Worker)
      // =====================================================================
      await observability.logStep('story_validation', 'started');
      
      const validatedStories = await step.do('执行故事验证', defaultStepConfig, async () => {
        console.log(`[AutoBrief] 开始故事验证，处理 ${clusteringResult.clusters.length} 个聚类`);
        
        // 创建 AI 服务实例
        const aiServices = createAIServices(this.env);
        
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

      // 按 importance 降序取 top-N，避免把 15 个 story 全部送进 LLM 深度分析（成本/时间爆炸）
      const storiesForIntelligence = [...validatedStories.stories]
        .sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0))
        .slice(0, maxStoriesToGenerate);

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

      const intelligenceReports = await step.do('执行情报深度分析', intelligenceStepConfig, async () => {
        console.log(`[AutoBrief] 开始情报分析，从 ${validatedStories.stories.length} 个候选故事中选取 top-${storiesForIntelligence.length}`);

                 const aiServices = createAIServices(this.env);
        const reports = [];

        for (let idx = 0; idx < storiesForIntelligence.length; idx++) {
          const story = storiesForIntelligence[idx];
          try {
            // 构建故事和聚类数据
            const storyWithContent = {
              storyId: story.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              analysis: { summary: story.title }
            };

            // 为情报分析动态获取相关文章的内容
            const clusterArticles = await this.getArticleContents(story.articleIds, dataset);

            const clusterForAnalysis = {
              articles: clusterArticles
            };

            const response = await aiServices.aiWorker.analyzeStoryIntelligence(
              storyWithContent,
              clusterForAnalysis,
              { analysis_depth: 'detailed' }
            );

            if (response.status === 200) {
              const data = await response.json() as any;
              if (data.success) {
                reports.push(data.data);

                // 观测性：把这份 intel report 全文落 R2，并把 R2 key 记到 brief_stories
                const r2Key = `intel-reports/${workflowId}/${idx}.json`;
                try {
                  await this.env.ARTICLES_BUCKET.put(r2Key, JSON.stringify(data.data, null, 2));
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
                  console.warn(`[AutoBrief] intel report 落盘失败 (workflow=${workflowId}, idx=${idx}):`, persistErr);
                }
              }
            }
          } catch (error) {
            console.warn(`[AutoBrief] 故事情报分析失败:`, error);
          }
        }

        // 移除默认报告逻辑 - 现在在故事验证后就会终止工作流
        // 如果执行到这里，说明有有效故事，不需要默认报告

        console.log(`[AutoBrief] 情报分析完成: ${reports.length} 份情报报告`);
        return reports;
      });

      await observability.logStep('intelligence_analysis', 'completed', {
        reportsGenerated: intelligenceReports.length
      });

      // =====================================================================
      // 步骤 5: 简报生成 (AI Worker)
      // =====================================================================
      await observability.logStep('brief_generation', 'started');
      
      const briefResult = await step.do('生成最终简报', defaultStepConfig, async (): Promise<BriefGenerationResultData> => {
        console.log(`[AutoBrief] 开始生成简报，基于 ${intelligenceReports.length} 个情报分析`);
        
        // 获取前一天的简报上下文（如果有）
        let previousBrief = null;
        try {
          const db = getDb(this.env.HYPERDRIVE);
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const previousBriefs = await db
            .select({
              title: $reports.title,
              tldr: $reports.tldr,
              created_at: $reports.createdAt
            })
            .from($reports)
            .where(gte($reports.createdAt, yesterday))
            .orderBy(desc($reports.createdAt))
            .limit(1);
          
          if (previousBriefs.length > 0) {
            previousBrief = {
              title: previousBriefs[0].title,
              tldr: previousBriefs[0].tldr,
              date: previousBriefs[0].created_at?.toISOString().split('T')[0]
            };
          }
        } catch (error) {
          console.warn(`[AutoBrief] 无法获取前一天简报上下文:`, error);
        }

        // 调用AI Worker的简报生成端点
        const briefRequest = new Request(`http://localhost:8786/meridian/generate-final-brief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisData: intelligenceReports,
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

          // 生成TLDR
          const tldrRequest = new Request(`http://localhost:8786/meridian/generate-brief-tldr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

      // 观测性：标记 brief_runs 为 COMPLETED 并填充全部统计
      await step.do('persist:brief_run_complete', dbStepConfig, async () => {
        const db = getDb(this.env.HYPERDRIVE);
        await db
          .update($brief_runs)
          .set({
            status: 'COMPLETED',
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