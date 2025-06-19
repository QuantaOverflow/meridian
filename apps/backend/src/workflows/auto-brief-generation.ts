import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getDb } from '../lib/utils';
import { $articles, $reports, $sources, gte, lte, isNotNull, and, eq, desc, sql, inArray } from '@meridian/database';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/dataflow-observability';
import { createClusteringService, type ArticleDataset, type ClusteringResult } from '../lib/clustering-service';
import { createAIServices } from '../lib/ai-services';
import type { Env } from '../index';

// ============================================================================
// 数据接口定义 - 与端到端测试保持一致
// ============================================================================

interface ArticleRecord {
  id: number;
  title: string;
  url: string;
  contentFileKey?: string | null;
  publish_date: Date | null;
  embedding?: number[];
  // 从 processArticles 工作流存储的分析结果字段
  language?: string;
  primary_location?: string;
  completeness?: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS';
  content_quality?: 'OK' | 'LOW_QUALITY' | 'JUNK';
  event_summary_points?: string[];
  thematic_keywords?: string[];
  topic_tags?: string[];
  key_entities?: string[];
  content_focus?: string[];
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
// 自动简报生成工作流
// ============================================================================

export class AutoBriefGenerationWorkflow extends WorkflowEntrypoint<Env, BriefGenerationParams> {
  
  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      article_ids = [],
      triggeredBy = 'system', 
      dateFrom, 
      dateTo, 
      minImportance = 3,
      
      articleLimit = 50,
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

    try {
      console.log(`[AutoBriefGeneration] 开始简报生成工作流, 参数:`, event.payload);
      
      // =====================================================================
      // 步骤 1: 获取文章数据并构建 ArticleDataset
      // =====================================================================
      await observability.logStep('prepare_dataset', 'started');
      
      const dataset: ArticleDataset = await step.do('准备文章数据集', defaultStepConfig, async (): Promise<ArticleDataset> => {
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
                 ...(article_ids.length > 0 ? [eq($articles.id, article_ids[0])] : timeConditions) // 简化处理，实际应该用 inArray
               )
             )
             .limit(articleLimit || 100);
          console.log(`[AutoBrief] 从数据库获取到 ${queryResult.length} 篇文章`);

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

          // 从 R2 获取文章内容（批量）
          const articles = [];
          const embeddings = [];
          let contentFoundCount = 0;
          let contentMissingCount = 0;
          
          for (const article of validArticles) {
            let content = '';
            
            try {
              if (article.contentFileKey) {
                const contentObject = await this.env.ARTICLES_BUCKET.get(article.contentFileKey);
                if (contentObject) {
                  content = await contentObject.text();
                  contentFoundCount++;
                } else {
                  console.warn(`[AutoBrief] 无法从 R2 获取文章内容: ${article.contentFileKey}`);
                  // 优化的回退策略：使用可用的分析数据
                  const fallbackContent = [
                    article.title,
                    ...(article.event_summary_points as string[] || []),
                    ...(article.thematic_keywords as string[] || []).map(k => `关键词: ${k}`),
                    ...(article.key_entities as string[] || []).map(e => `实体: ${e}`)
                  ].filter(Boolean).join('\n\n');
                  
                  content = fallbackContent || article.title;
                  contentMissingCount++;
                }
              } else {
                // 无contentFileKey时使用分析数据作为内容
                const fallbackContent = [
                  article.title,
                  ...(article.event_summary_points as string[] || []),
                  ...(article.thematic_keywords as string[] || []).map(k => `关键词: ${k}`),
                ].filter(Boolean).join('\n\n');
                
                content = fallbackContent || article.title;
                contentMissingCount++;
              }
            } catch (error) {
              console.warn(`[AutoBrief] 获取文章内容失败 (ID: ${article.id}):`, error);
              // 使用丰富的回退内容
              const fallbackContent = [
                article.title,
                ...(article.event_summary_points as string[] || []),
                `发布时间: ${article.publish_date?.toISOString().split('T')[0] || '未知'}`,
                `语言: ${article.language || '未知'}`,
                `地区: ${article.primary_location || '未知'}`
              ].filter(Boolean).join('\n\n');
              
              content = fallbackContent || article.title;
              contentMissingCount++;
            }

            // 构建 ArticleDataset 格式
            articles.push({
              id: article.id,
              title: article.title,
              content: content,
              publishDate: article.publish_date?.toISOString() || new Date().toISOString(),
              url: article.url,
              summary: (article.event_summary_points as string[])?.[0] || article.title
            });

            embeddings.push({
              articleId: article.id,
              embedding: article.embedding as number[]
            });
          }

          console.log(`[AutoBrief] 内容获取统计: R2成功${contentFoundCount}篇, 回退${contentMissingCount}篇`);

          const dataset: ArticleDataset = {
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

      const articleQuality = DataQualityAssessor.assessArticleQuality(dataset.articles);
      await observability.logStep('prepare_dataset', 'completed', {
        articleCount: dataset.articles.length,
        qualityAssessment: articleQuality
      });

      // =====================================================================
      // 步骤 2: 聚类分析 (ML Service)
      // =====================================================================
      await observability.logStep('clustering_analysis', 'started');
      
      const clusteringResult = await step.do('执行聚类分析', defaultStepConfig, async (): Promise<ClusteringResult> => {
        console.log(`[AutoBrief] 开始聚类分析，处理 ${dataset.articles.length} 篇文章`);
        
        // 创建聚类服务实例
        const clusteringService = createClusteringService(this.env);
        
        // 使用优化的聚类参数
        const clusteringOptions = {
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

        const response = await clusteringService.analyzeClusters(dataset, clusteringOptions);
        
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
            event_summary_points: Array.isArray(metadata?.event_summary_points) && metadata.event_summary_points.length > 0
              ? metadata.event_summary_points as string[]
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
              provider: 'google-ai-studio',
              model: 'gemini-2.0-flash'
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
        validStories: validatedStories.stories.length,
        rejectedClusters: validatedStories.rejectedClusters.length
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
      // 步骤 4: 情报深度分析 (AI Worker)
      // =====================================================================
      await observability.logStep('intelligence_analysis', 'started');
      
      const intelligenceReports = await step.do('执行情报深度分析', defaultStepConfig, async () => {
        console.log(`[AutoBrief] 开始情报分析，处理 ${validatedStories.stories.length} 个故事`);
        
                 const aiServices = createAIServices(this.env);
        const reports = [];
        
        for (const story of validatedStories.stories) {
          try {
            // 构建故事和聚类数据
            const storyWithContent = {
              storyId: story.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              analysis: { summary: story.title }
            };
            
            const clusterForAnalysis = {
              articles: story.articleIds.map((id: number) => 
                dataset.articles.find(a => a.id === id)
              ).filter(Boolean)
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
              provider: 'google-ai-studio',
              model: 'gemini-2.0-flash'
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
                provider: 'google-ai-studio',
                model: 'gemini-2.0-flash'
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
                model_used: briefData.data.metadata?.model_used || 'gemini-2.0-flash'
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
                story.articles && Array.isArray(story.articles) && 
                story.articles.some((storyArticle: any) => storyArticle.id === article.id)
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