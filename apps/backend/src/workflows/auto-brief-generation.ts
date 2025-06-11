import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { getDb } from '../lib/utils';
import { $articles, $reports, gte, lte, isNotNull, and, eq, desc } from '@meridian/database';
import { createAIServices, handleServiceResponse } from '../lib/ai-services';
import { createWorkflowObservability, DataQualityAssessor } from '../lib/observability';
import { createDataFlowObserver } from '../lib/dataflow-observability';
import type { Env } from '../index';

interface ArticleRecord {
  id: number;
  title: string;
  url: string;
  contentFileKey?: string | null;
  publish_date: Date | null;
  embedding?: number[];
}

interface ClusterResult {
  clusters: Array<{
    id: number;
    articles: ArticleRecord[];
    similarity_score: number;
    coherence_score?: number;
    cohesion_score?: number;
    stability_score?: number;
    size?: number;
  }>;
}

// 清理后的故事 (第一阶段输出)
interface CleanedStory {
  id: number;
  title: string;
  importance: number;
  articles: number[];
  clusterId: number; // 原始聚类ID
}

interface StoryAnalysis {
  storyId: number;
  analysis: {
    story_type: string;
    importance: number;
    summary: string;
    key_themes: string[];
  };
}

interface IntelligenceAnalysis {
  story_id: number;
  detailed_analysis: {
    overview: string;
    key_developments: string[];
    stakeholders: string[];
    implications: string[];
    outlook: string;
  };
}

interface BriefGenerationParams {
  triggeredBy?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minImportance?: number;
  
  // 简化的配置参数
  articleLimit?: number;
  timeRangeDays?: number;
  
  // 简化的聚类选项 - 只保留业务级别的配置
  clusteringOptions?: {
    preprocessing?: 'none' | 'abs_normalize' | 'minmax' | 'standardize' | 'normalize';
    strategy?: 'simple_cosine' | 'adaptive_threshold' | 'hierarchical' | 'density_based';
    min_quality_score?: number;
  };
  
  // 业务控制参数
  maxStoriesToGenerate?: number;
  storyMinImportance?: number;
}

export class AutoBriefGenerationWorkflow extends WorkflowEntrypoint<Env, BriefGenerationParams> {
  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      triggeredBy = 'system', 
      dateFrom, 
      dateTo, 
      minImportance = 3, // 降低默认阈值，让更多故事通过筛选
      
      // 简化的配置参数
      articleLimit = 50,
      timeRangeDays,
      clusteringOptions,
      maxStoriesToGenerate = 15,
      storyMinImportance = 0.1
    } = event.payload;

    // 创建可观测性实例
    const workflowId = crypto.randomUUID();
    const observability = createWorkflowObservability(workflowId, this.env);
    const dataFlowObserver = createDataFlowObserver(workflowId, this.env);
    
    await observability.logStep('workflow_start', 'started', {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      minImportance,
      customClusteringOptions: !!clusteringOptions
    });
    
    dataFlowObserver.startStage('workflow_initialization', {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      minImportance
    });

    try {
      console.log(`[AutoBriefGeneration] 开始简报生成工作流, 参数:`, {
        triggeredBy,
        articleLimit,
        timeRangeDays,
        minImportance,
        customClusteringOptions: !!clusteringOptions
      });

      // 创建AI服务实例
      const aiServices = createAIServices(this.env);

      // 步骤1: 从数据库获取已处理的文章（而不是从AI Worker）
      console.log('[AutoBrief] 步骤1: 从数据库获取文章数据');
      await observability.logStep('fetch_articles', 'started');
      const articles = await step.do('获取已处理文章', async (): Promise<ArticleRecord[]> => {
        try {
          const db = getDb(this.env.HYPERDRIVE);
          
          // 构建时间范围查询条件
          const timeConditions = [];
          if (dateFrom) {
            timeConditions.push(gte($articles.publishDate, dateFrom));
          }
          if (dateTo) {
            timeConditions.push(lte($articles.publishDate, dateTo));
          }
          
          // 只有在明确指定timeRangeDays时才添加默认时间限制
          // 如果timeRangeDays未指定或为null，则查询所有历史文章
          if (!dateFrom && !dateTo && timeRangeDays && timeRangeDays > 0) {
            const daysAgo = new Date(Date.now() - timeRangeDays * 24 * 60 * 60 * 1000);
            timeConditions.push(gte($articles.publishDate, daysAgo));
            console.log(`[AutoBrief] 应用时间限制: 最近${timeRangeDays}天`);
          } else if (!dateFrom && !dateTo) {
            console.log(`[AutoBrief] 未指定时间范围，查询所有历史文章`);
          }

          // 查询已经过AI分析且有嵌入向量的文章
          const queryResult = await db
            .select({
              id: $articles.id,
              title: $articles.title,
              url: $articles.url,
              contentFileKey: $articles.contentFileKey,
              publish_date: $articles.publishDate,
              embedding: $articles.embedding,
            })
            .from($articles)
            .where(
              and(
                // 必须有嵌入向量
                isNotNull($articles.embedding),
                // 状态必须是已完成处理
                eq($articles.status, 'PROCESSED'),
                // 必须有内容文件
                isNotNull($articles.contentFileKey),
                // 时间条件
                ...timeConditions
              )
            )
            .limit(100); // 限制最多100篇文章

          console.log(`[AutoBrief] 从数据库获取到 ${queryResult.length} 篇文章`);

          if (queryResult.length === 0) {
            // 如果没有找到文章，输出调试信息
            console.log('[AutoBrief] 未找到任何文章，检查查询条件...');
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            console.log(`[AutoBrief] 查询时间范围: ${thirtyDaysAgo.toISOString()} 到现在`);
            
            // 检查数据库中PROCESSED文章的总数
            const totalProcessed = await db
              .select()
              .from($articles)
              .where(eq($articles.status, 'PROCESSED'))
              .limit(10);
            console.log(`[AutoBrief] 数据库中总共有 ${totalProcessed.length} 篇PROCESSED文章`);
          }

          // 检查嵌入向量的质量并记录调试信息
          const processedArticles = queryResult.map(row => {
            const embedding = row.embedding;
            const isValidEmbedding = Array.isArray(embedding) && 
                                     embedding.length > 0 && 
                                     embedding.every(val => typeof val === 'number' && !isNaN(val));
            
            console.log(`[AutoBrief] 文章 ${row.id}: 嵌入向量类型=${Array.isArray(embedding) ? 'array' : typeof embedding}, 长度=${Array.isArray(embedding) ? embedding.length : 'N/A'}, 有效=${isValidEmbedding}`);
            
            return {
              id: row.id,
              title: row.title || '无标题',
              url: row.url,
              contentFileKey: row.contentFileKey,
              publish_date: row.publish_date,
              embedding: isValidEmbedding ? embedding : [],
            };
          });

          // 过滤掉没有有效嵌入向量的文章
          const validArticles = processedArticles.filter(article => 
            Array.isArray(article.embedding) && article.embedding.length > 0
          );

          console.log(`[AutoBrief] 过滤后有效文章数量: ${validArticles.length}/${processedArticles.length}`);
          
          return validArticles;
        } catch (error) {
          console.error('[AutoBrief] 获取文章失败:', error);
          throw new Error(`数据库查询失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 记录文章获取完成和数据质量
      const articleQuality = DataQualityAssessor.assessArticleQuality(articles);
      await observability.logStep('fetch_articles', 'completed', {
        articleCount: articles.length,
        qualityAssessment: articleQuality
      });
      
      await observability.logDataFlow('article_fetch', {
        stage: 'article_fetch',
        articleCount: articles.length,
        filterCriteria: { timeRangeDays, dateFrom, dateTo },
        qualityMetrics: articleQuality
      });

      // 使用新的数据流观察者记录文章处理指标
      const withEmbedding = articles.filter(a => a.embedding && Array.isArray(a.embedding) && a.embedding.length > 0).length;
      const withContent = articles.filter(a => a.contentFileKey).length;
      dataFlowObserver.completeStage('workflow_initialization');
      dataFlowObserver.startStage('article_processing', { totalArticles: articles.length });
      dataFlowObserver.recordArticleMetrics(articles.length, withEmbedding, withContent);
      dataFlowObserver.completeStage('article_processing', { articleCount: articles.length, withEmbedding, withContent });

      if (articles.length < 2) {
        const errorMsg = `文章数量不足进行聚类分析 (获取到 ${articles.length} 篇, 需要至少 2 篇)`;
        console.error(`[AutoBrief] ${errorMsg}`);
        await observability.fail(errorMsg);
        throw new Error(errorMsg);
      }

      // 步骤2: 聚类分析
      console.log('[AutoBrief] 步骤2: 执行聚类分析');
      await observability.logStep('clustering', 'started');
      dataFlowObserver.startStage('clustering_analysis', { articleCount: articles.length });
      const clusterResult = await step.do('聚类分析', async (): Promise<ClusterResult> => {
        try {
          // 准备发送给聚类分析的数据 - 过滤掉没有嵌入向量的文章
          const articlesForClustering = articles
            .filter(a => a.embedding && Array.isArray(a.embedding))
            .map(a => ({
              id: a.id,
              embedding: a.embedding as number[],
              // 将文章ID和其他信息放在metadata中，确保ML服务能够保持这些信息
              metadata: {
                articleId: a.id,  // 关键：在metadata中保存文章ID
                title: a.title,
                url: a.url,
                source: 'meridian',
                publishDate: a.publish_date?.toISOString() || new Date().toISOString()
              }
            }));

          console.log(`[AutoBrief] 准备聚类数据: ${articlesForClustering.length} 篇文章`);
          
          // 验证每篇文章的嵌入向量
          articlesForClustering.forEach((article, index) => {
            const embeddingValid = Array.isArray(article.embedding) && 
                                   article.embedding.length > 0 && 
                                   article.embedding.every(val => typeof val === 'number' && !isNaN(val));
            console.log(`[AutoBrief] 聚类文章 ${article.id} (索引${index}): 嵌入向量长度=${Array.isArray(article.embedding) ? article.embedding.length : 'N/A'}, 有效=${embeddingValid}`);
            
            if (embeddingValid && Array.isArray(article.embedding)) {
              const firstFew = article.embedding.slice(0, 3);
              console.log(`[AutoBrief] 文章 ${article.id} 嵌入向量前3个值: ${firstFew.join(', ')}`);
            }
          });

          // 使用轻量级AI服务进行聚类
          const response = await aiServices.mlService.aiWorkerClustering(articlesForClustering, {
            config: {
              umap_n_neighbors: Math.min(15, Math.max(2, Math.floor(articlesForClustering.length / 3))),
              umap_n_components: 2,
              hdbscan_min_cluster_size: Math.max(2, Math.floor(articlesForClustering.length / 10)),
              hdbscan_min_samples: 2,
              normalize_embeddings: true
            },
            content_analysis: {
              enabled: true,
              top_n_per_cluster: 3,
              generate_themes: true,
              generate_summary: true
            }
          });
          
          const clusteringResult = await handleServiceResponse<any>(response, 'ML clustering');
          
          if (!clusteringResult.success) {
            throw new Error(`聚类分析失败: ${clusteringResult.error}`);
          }

          const result = clusteringResult.data;
          
          // 转换聚类结果格式
          const clusters = result.clusters?.map((cluster: any) => {
            console.log(`[AutoBrief] 原始聚类 ${cluster.cluster_id}: 包含 ${cluster.size} 个项目`);
            console.log(`[AutoBrief] 聚类items数量: ${cluster.items?.length || 0}`);
            console.log(`[AutoBrief] 聚类items示例:`, cluster.items?.slice(0, 2));
            
            // 从ML服务的items中提取文章ID列表
            // ML服务返回的格式是: {index, text, metadata}
            // 文章ID保存在 metadata.articleId 中
            const itemIds = cluster.items?.map((item: any) => {
              // 尝试多种方式提取ID
              if (item.id) {
                return item.id;
              }
              if (item.metadata && item.metadata.articleId) {
                return item.metadata.articleId;
              }
              if (item.metadata && item.metadata.id) {
                return item.metadata.id;
              }
              // 如果都没有，使用index作为备用（虽然这不理想）
              console.warn(`[AutoBrief] 无法从item中提取ID，item结构:`, Object.keys(item));
              return null;
            }).filter((id: any) => id !== null) || [];
            
            console.log(`[AutoBrief] 聚类 ${cluster.cluster_id} 提取的IDs:`, itemIds);
            
            // 根据ID列表从原始文章中筛选匹配的文章
            const clusterArticles = articles.filter(a => itemIds.includes(a.id));
            console.log(`[AutoBrief] 聚类 ${cluster.cluster_id} 匹配的文章数量: ${clusterArticles.length}`);
            
            return {
              id: cluster.cluster_id,
              articles: clusterArticles,
              similarity_score: cluster.coherence_score || cluster.stability_score || 0.5,
              coherence_score: cluster.coherence_score,
              cohesion_score: cluster.cohesion_score, 
              stability_score: cluster.stability_score,
              size: clusterArticles.length // 使用实际匹配的文章数量
            };
          })
          
          console.log(`[AutoBrief] 聚类分析完成，发现 ${clusters.length} 个聚类`);
          clusters.forEach((cluster: any, index: number) => {
            console.log(`[AutoBrief] 聚类 ${cluster.id}: ${cluster.articles.length} 篇文章`);
            console.log(`[AutoBrief] 聚类 ${cluster.id} 文章IDs: ${cluster.articles.map((a: any) => a.id).join(', ')}`);
          });
          
          return { clusters } as ClusterResult;
        } catch (error) {
          console.error('[AutoBrief] 聚类分析失败:', error);
          throw new Error(`聚类分析失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 记录聚类分析完成
      const clusterQuality = DataQualityAssessor.assessClusterQuality(clusterResult.clusters);
      const clusterSizes = clusterResult.clusters.map(c => c.articles.length);
      const coherenceScores = clusterResult.clusters.map(c => c.coherence_score || c.similarity_score || 0);
      
      await observability.logClustering({
        inputArticles: articles.length,
        clusterConfig: clusteringOptions,
        outputClusters: clusterResult.clusters.length,
        noisePoints: articles.length - clusterResult.clusters.reduce((sum, c) => sum + c.articles.length, 0),
        avgClusterSize: clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length,
        avgCoherenceScore: coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length,
        largestClusterSize: Math.max(...clusterSizes),
        smallestClusterSize: Math.min(...clusterSizes),
        embeddingQuality: clusterQuality
      });

      // 使用数据流观察者记录聚类指标
      const avgClusterSize = clusterSizes.length > 0 ? clusterSizes.reduce((a, b) => a + b, 0) / clusterSizes.length : 0;
      const avgQualityScore = coherenceScores.length > 0 ? coherenceScores.reduce((a, b) => a + b, 0) / coherenceScores.length : 0;
      dataFlowObserver.recordClusteringMetrics(clusterResult.clusters.length, clusterResult.clusters.filter(c => c.articles.length >= 2).length, avgClusterSize, avgQualityScore);
      dataFlowObserver.completeStage('clustering_analysis', { 
        clusterCount: clusterResult.clusters.length, 
        avgClusterSize,
        qualityScore: avgQualityScore 
      });

      await observability.logDataFlow('clustering', {
        stage: 'clustering',
        articleCount: articles.length,
        clusterCount: clusterResult.clusters.length,
        transformationType: 'ml_clustering',
        qualityMetrics: clusterQuality
      });

      if (clusterResult.clusters.length === 0) {
        const errorMsg = '聚类分析未发现任何有意义的文章聚类';
        await observability.fail(errorMsg);
        throw new Error(errorMsg);
      }

      // 步骤3A: 故事验证和清理 (第一阶段LLM分析 - 微服务架构)
      console.log('[AutoBrief] 步骤3A: 执行故事验证和清理');
      await observability.logStep('story_validation', 'started');
      dataFlowObserver.startStage('story_selection', { clusterCount: clusterResult.clusters.length });
      const cleanedStories = await step.do('故事验证和清理', async (): Promise<CleanedStory[]> => {
        try {
          const validationPromises = clusterResult.clusters.map(async (cluster) => {
            console.log(`[AutoBrief] 验证聚类 ${cluster.id}，包含 ${cluster.articles.length} 篇文章`);
            
            try {
              // 使用AI Worker的专门故事验证端点 (符合微服务原则)
              const response = await aiServices.aiWorker.validateStory(cluster);
              const validationResult = await handleServiceResponse(response);
              
              if (!validationResult.success) {
                console.warn(`[AutoBrief] 聚类 ${cluster.id} 验证失败: ${validationResult.error}`);
                
                // 记录故事验证失败的详细信息
                await observability.logStep('story_validation_failed', 'failed', {
                  clusterId: cluster.id,
                  articleCount: cluster.articles.length,
                  error: validationResult.error,
                  clusterQuality: cluster.similarity_score || cluster.coherence_score
                });
                
                return null;
              }

              // 修复：正确处理handleServiceResponse的双重包装
              const validationData = validationResult.data as any;
              console.log(`[AutoBrief] 聚类 ${cluster.id} 验证响应结构:`, JSON.stringify(validationData, null, 2));
              
              // validationData是AI Worker的完整响应，包含success、data、metadata
              // 真正的验证数据在validationData.data中
              const actualValidationData = validationData?.data;
              
              // 检查cleaned_stories是否存在并且是数组（允许空数组）
              console.log(`[AutoBrief] 聚类 ${cluster.id} 数据类型检查:`, {
                validationData_exists: !!validationData,
                actualValidationData_exists: !!actualValidationData,
                has_cleaned_stories: actualValidationData && 'cleaned_stories' in actualValidationData,
                cleaned_stories_value: actualValidationData?.cleaned_stories,
                is_array: Array.isArray(actualValidationData?.cleaned_stories),
                typeof_cleaned_stories: typeof actualValidationData?.cleaned_stories
              });
              
              if (!actualValidationData || !('cleaned_stories' in actualValidationData) || !Array.isArray(actualValidationData.cleaned_stories)) {
                console.warn(`[AutoBrief] 聚类 ${cluster.id} 验证响应中缺少或无效的cleaned_stories字段`);
                console.warn(`[AutoBrief] 响应数据:`, actualValidationData);
                
                // 记录响应格式异常
                await observability.logStep('story_validation_format_error', 'failed', {
                  clusterId: cluster.id,
                  responseData: actualValidationData,
                  issue: 'missing_or_invalid_cleaned_stories'
                });
                
                return null;
              }
              
              // 如果cleaned_stories是空数组，这是合法的（表示该聚类没有有效故事）
              if (actualValidationData.cleaned_stories.length === 0) {
                console.log(`[AutoBrief] 聚类 ${cluster.id} 没有有效故事 (${actualValidationData.validation_result})`);
                
                // 记录空故事集群的详细信息
                await observability.logStep('empty_story_cluster', 'completed', {
                  clusterId: cluster.id,
                  validationResult: actualValidationData.validation_result,
                  reasoningDetails: actualValidationData.reasoning,
                  clusterQuality: cluster.similarity_score || cluster.coherence_score,
                  articleTitles: cluster.articles.map(a => a.title).slice(0, 3)
                });
                
                return []; // 返回空数组而不是null
              }
              
              const cleanedStories = actualValidationData.cleaned_stories.map((story: any) => ({
                id: story.id,
                title: story.title,
                importance: story.importance,
                articles: story.articles,
                clusterId: cluster.id // 添加聚类ID以便后续映射
              }));
              
              // 📊 增强的重要性评估可观测性记录
              const importanceDetails = actualValidationData.cleaned_stories.map((story: any) => ({
                storyId: story.id,
                title: story.title,
                importance: story.importance,
                importanceFactors: story.importance_factors || {},
                reasoningExplanation: story.reasoning || '未提供',
                confidenceScore: story.confidence || 0,
                qualityMetrics: {
                  coherence: story.coherence_score || 0,
                  relevance: story.relevance_score || 0,
                  uniqueness: story.uniqueness_score || 0,
                  timeliness: story.timeliness_score || 0
                },
                articleCount: story.articles?.length || 0,
                keyTopics: story.key_topics || [],
                sourceClusterQuality: cluster.similarity_score || cluster.coherence_score || 0
              }));
              
              // 记录重要性评估的详细过程
              await observability.logStep('importance_evaluation_detail', 'completed', {
                clusterId: cluster.id,
                validationResult: actualValidationData.validation_result,
                storiesGenerated: cleanedStories.length,
                                 importanceAnalysis: {
                   stories: importanceDetails,
                   avgImportance: importanceDetails.reduce((sum: number, s: any) => sum + s.importance, 0) / importanceDetails.length,
                   importanceRange: {
                     min: Math.min(...importanceDetails.map((s: any) => s.importance)),
                     max: Math.max(...importanceDetails.map((s: any) => s.importance))
                   },
                   qualityProfile: {
                     avgCoherence: importanceDetails.reduce((sum: number, s: any) => sum + s.qualityMetrics.coherence, 0) / importanceDetails.length,
                     avgRelevance: importanceDetails.reduce((sum: number, s: any) => sum + s.qualityMetrics.relevance, 0) / importanceDetails.length,
                     avgConfidence: importanceDetails.reduce((sum: number, s: any) => sum + s.confidenceScore, 0) / importanceDetails.length
                   }
                 },
                aiReasoningProcess: actualValidationData.reasoning_process || '未提供详细推理过程'
              });
              
              console.log(`[AutoBrief] 聚类 ${cluster.id} 验证结果: ${actualValidationData.validation_result}, 生成${cleanedStories.length}个有效故事`);
              
                             // 详细记录每个故事的重要性评分
               cleanedStories.forEach((story: any, index: number) => {
                 const details = importanceDetails[index];
                 console.log(`[AutoBrief] 📊 故事 ${story.id}: "${story.title}" (重要性: ${story.importance})`);
                 console.log(`    📈 评分因素:`, details.importanceFactors);
                 console.log(`    🎯 置信度: ${details.confidenceScore}, 推理: ${details.reasoningExplanation.substring(0, 100)}...`);
                 console.log(`    📋 质量指标: 连贯性=${details.qualityMetrics.coherence}, 相关性=${details.qualityMetrics.relevance}`);
               });
              
              return cleanedStories;
              
            } catch (error) {
              console.warn(`[AutoBrief] 聚类 ${cluster.id} 验证服务调用失败:`, error);
              
              // 记录验证服务调用失败
              await observability.logStep('story_validation_service_error', 'failed', {
                clusterId: cluster.id,
                error: error instanceof Error ? error.message : String(error),
                clusterSize: cluster.articles.length,
                clusterQuality: cluster.similarity_score || cluster.coherence_score
              });
              
              return null;
            }
          });

          // 等待所有验证完成并收集结果
          const validationResults = await Promise.all(validationPromises);
          const allCleanedStories = validationResults
            .filter((result: any) => result !== null) // 过滤null值（验证失败的情况）
            .flat() as CleanedStory[]; // flat()会处理空数组

          // 按重要性排序
          const sortedStories = allCleanedStories.sort((a, b) => b.importance - a.importance);
          
          console.log(`[AutoBrief] 故事验证完成，共生成${sortedStories.length}个清理后的故事`);
          sortedStories.forEach(story => {
            console.log(`[AutoBrief] 故事 ${story.id}: "${story.title}" (重要性: ${story.importance}, 文章数: ${story.articles.length}, 来自聚类: ${story.clusterId})`);
          });
          
          return sortedStories;
        } catch (error) {
          console.error('[AutoBrief] 故事验证失败:', error);
          throw new Error(`故事验证失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 记录故事验证完成 - 增强的筛选透明度
      const storyBreakdown = cleanedStories.map(story => ({
        storyId: story.id,
        title: story.title,
        importance: story.importance,
        articleCount: story.articles.length,
        clusterId: story.clusterId,
        selected: story.importance >= minImportance,
        rejectionReason: story.importance < minImportance ? '重要性不足' : undefined,
        marginFromThreshold: story.importance - minImportance, // 距离阈值的差距
        selectionCategory: story.importance >= minImportance + 2 ? 'high_confidence' :
                          story.importance >= minImportance ? 'threshold_pass' :
                          story.importance >= minImportance - 1 ? 'close_miss' : 'clear_reject'
      }));

      // 📊 详细的阈值分析
      const thresholdAnalysis = {
        passedStories: storyBreakdown.filter(s => s.selected).length,
        rejectedStories: storyBreakdown.filter(s => !s.selected).length,
        highConfidenceSelections: storyBreakdown.filter(s => s.selectionCategory === 'high_confidence').length,
        borderlineCases: storyBreakdown.filter(s => s.selectionCategory === 'close_miss').length,
        avgMarginForSelected: storyBreakdown.filter(s => s.selected).length > 0 ? 
          storyBreakdown.filter(s => s.selected).reduce((sum, s) => sum + s.marginFromThreshold, 0) / storyBreakdown.filter(s => s.selected).length : 0,
        avgMarginForRejected: storyBreakdown.filter(s => !s.selected).length > 0 ? 
          storyBreakdown.filter(s => !s.selected).reduce((sum, s) => sum + Math.abs(s.marginFromThreshold), 0) / storyBreakdown.filter(s => !s.selected).length : 0
      };

      console.log(`[AutoBrief] 📊 故事筛选阈值分析 (阈值: ${minImportance}):`);
      console.log(`   ✅ 通过: ${thresholdAnalysis.passedStories} 个故事`);
      console.log(`   ❌ 拒绝: ${thresholdAnalysis.rejectedStories} 个故事`);
      console.log(`   🎯 高置信度选择: ${thresholdAnalysis.highConfidenceSelections} 个`);
      console.log(`   ⚠️  边界情况: ${thresholdAnalysis.borderlineCases} 个`);
      console.log(`   📈 已选择故事平均超出阈值: ${thresholdAnalysis.avgMarginForSelected.toFixed(2)}`);
      console.log(`   📉 已拒绝故事平均低于阈值: ${thresholdAnalysis.avgMarginForRejected.toFixed(2)}`);

      await observability.logStorySelection({
        candidateStories: clusterResult.clusters.length,
        selectedStories: cleanedStories.filter(s => s.importance >= minImportance).length,
        rejectedStories: cleanedStories.filter(s => s.importance < minImportance).length,
        importanceThreshold: minImportance,
        qualityFilters: ['ai_validation', 'coherence_check'],
        avgImportanceScore: cleanedStories.reduce((sum: number, s: any) => sum + s.importance, 0) / cleanedStories.length,
        storyBreakdown,
        thresholdAnalysis, // 新增阈值分析数据
        selectionConfidence: {
          highConfidence: thresholdAnalysis.highConfidenceSelections,
          borderlineCases: thresholdAnalysis.borderlineCases,
          avgSelectionMargin: thresholdAnalysis.avgMarginForSelected
        }
      });

      await observability.logDataFlow('story_validation', {
        stage: 'story_validation',
        articleCount: articles.length,
        clusterCount: clusterResult.clusters.length,
        storyCount: cleanedStories.length,
        filterCriteria: { minImportance },
        removedCount: clusterResult.clusters.length - cleanedStories.length
      });

      // 使用数据流观察者记录故事选择指标
      const selectedStories = cleanedStories.filter(s => s.importance >= minImportance);
      const avgImportance = cleanedStories.length > 0 ? cleanedStories.reduce((sum, s) => sum + s.importance, 0) / cleanedStories.length : 0;
      dataFlowObserver.recordStorySelectionMetrics(clusterResult.clusters.length, selectedStories.length, avgImportance);
      dataFlowObserver.completeStage('story_selection', { 
        candidateStories: clusterResult.clusters.length,
        selectedStories: selectedStories.length,
        avgImportance 
      });

      if (cleanedStories.length === 0) {
        const errorMsg = '故事验证未发现任何有效故事';
        await observability.fail(errorMsg);
        throw new Error(errorMsg);
      }

      // 步骤3B: 转换为故事分析格式 (兼容现有流程)
      console.log('[AutoBrief] 步骤3B: 转换故事格式');
      const storyAnalyses = cleanedStories.map(story => ({
        storyId: story.id,
        analysis: {
          story_type: story.articles.length > 1 ? 'multi_story' : 'single_story',
          importance: story.importance,
          summary: story.title,
          key_themes: [story.title], // 使用故事标题作为主题
        },
      } as StoryAnalysis)).filter(analysis => analysis.analysis.importance >= minImportance);

      console.log(`[AutoBrief] 转换完成，共${storyAnalyses.length}个故事通过重要性筛选 (阈值: ${minImportance})`);
      storyAnalyses.forEach(story => {
        console.log(`[AutoBrief] 故事分析 ${story.storyId}: "${story.analysis.summary}" (重要性: ${story.analysis.importance})`);
      });

      if (storyAnalyses.length === 0) {
        throw new Error(`未发现重要性达到阈值 (${minImportance}) 的故事`);
      }

      // 步骤4: 情报分析（使用AI Worker的IntelligenceService）
      console.log('[AutoBrief] 步骤4: 执行情报分析');
      dataFlowObserver.startStage('ai_analysis', { storyCount: storyAnalyses.length });
      const intelligenceAnalyses = await step.do('情报分析', async (): Promise<IntelligenceAnalysis[]> => {
        try {
          const intelligencePromises = storyAnalyses.map(async (story) => {
            try {
              // 找到对应的聚类和故事
              const originalStory = cleanedStories.find(s => s.id === story.storyId);
              const cluster = clusterResult.clusters.find(c => c.id === originalStory?.clusterId);
              
              if (!cluster || !cluster.articles || cluster.articles.length === 0) {
                console.warn(`[AutoBrief] 故事 ${story.storyId} 没有有效的聚类数据`);
                throw new Error('没有有效的聚类数据');
              }

              // 获取文章的完整内容
              const articlesWithContent = await Promise.all(cluster.articles.map(async (article) => {
                let content = '';
                
                // 从R2存储获取实际内容
                if (article.contentFileKey) {
                  try {
                    const obj = await this.env.ARTICLES_BUCKET.get(article.contentFileKey);
                    if (obj) {
                      content = await obj.text();
                      console.log(`[AutoBrief] 成功获取文章 ${article.id} 内容，长度: ${content.length}`);
                    } else {
                      console.warn(`[AutoBrief] R2中未找到文章 ${article.id} 的内容文件: ${article.contentFileKey}`);
                      content = article.title || '内容不可用';
                    }
                  } catch (error) {
                    console.error(`[AutoBrief] 获取文章 ${article.id} 内容失败:`, error);
                    content = article.title || '内容获取失败';
                  }
                } else {
                  console.warn(`[AutoBrief] 文章 ${article.id} 没有contentFileKey`);
                  content = article.title || '无内容文件键';
                }
                
                return {
                  id: article.id,
                  title: article.title || '无标题',
                  url: article.url || '',
                  content: content,
                  publishDate: article.publish_date?.toISOString() || new Date().toISOString()
                };
              }));

              // 构建符合IntelligenceService.analyzeStory期望的请求格式
              const intelligenceRequest = {
                title: story.analysis.summary || `故事 ${story.storyId}`,
                articles_ids: articlesWithContent.map(a => a.id),
                articles_data: articlesWithContent
              };

              console.log(`[AutoBrief] 调用情报分析服务，故事: ${intelligenceRequest.title}, 文章数: ${intelligenceRequest.articles_data.length}`);

              // 直接调用AI Worker的intelligence端点，使用正确的格式
              const request = new Request(`https://meridian-ai-worker/meridian/intelligence/analyze-story`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(intelligenceRequest)
              });

              const response = await this.env.AI_WORKER.fetch(request);
              const analysisResult = await handleServiceResponse<any>(response, 'Intelligence analysis');
              
              console.log(`[AutoBrief] 故事 ${story.storyId} 情报分析响应:`, JSON.stringify(analysisResult, null, 2));
              
              if (analysisResult.success && analysisResult.data) {
                // 处理完整的notebook格式分析结果
                const analysisData = analysisResult.data;
                
                // 检查是否有analysis字段，并处理新的完整格式
                const analysis = analysisData.analysis || analysisData;
                
                // 提取关键实体名称
                const extractEntityNames = (keyEntities: any) => {
                  if (!keyEntities || !keyEntities.list || !Array.isArray(keyEntities.list)) {
                    return ['相关方待确定'];
                  }
                  return keyEntities.list.slice(0, 5).map((entity: any) => entity.name || '未知实体');
                };

                // 提取时间线要点
                const extractKeyDevelopments = (timeline: any, executiveSummary: string) => {
                  if (!timeline || !Array.isArray(timeline)) {
                    return [executiveSummary || story.analysis.summary];
                  }
                  return timeline
                    .filter((event: any) => event.importance === 'High')
                    .map((event: any) => event.description)
                    .slice(0, 3);
                };

                // 提取影响和含义
                const extractImplications = (analysis: any) => {
                  const implications = [];
                  
                  if (analysis.significance?.reasoning) {
                    implications.push(analysis.significance.reasoning);
                  }
                  
                  if (analysis.informationGaps && Array.isArray(analysis.informationGaps)) {
                    implications.push(...analysis.informationGaps.slice(0, 2));
                  }
                  
                  if (implications.length === 0) {
                    implications.push(`${analysis.significance?.assessment || '中等'}重要性事件，需持续关注`);
                  }
                  
                  return implications;
                };

                return {
                  story_id: story.storyId,
                  detailed_analysis: {
                    overview: analysis.executiveSummary || analysisData.story_title || story.analysis.summary,
                    key_developments: extractKeyDevelopments(analysis.timeline, analysis.executiveSummary),
                    stakeholders: extractEntityNames(analysis.keyEntities),
                    implications: extractImplications(analysis),
                    outlook: `${analysis.storyStatus || '发展中'} (${analysis.significance?.assessment || '中等'}重要性)`
                  }
                } as IntelligenceAnalysis;
              } else {
                console.warn(`[AutoBrief] 故事 ${story.storyId} 情报分析失败: ${analysisResult.error}`);
                throw new Error(analysisResult.error || '分析失败');
              }
            } catch (error) {
              console.error(`[AutoBrief] 故事 ${story.storyId} 情报分析失败: ${error}`);
              // 不再使用fallback，抛出错误让工作流处理
              throw new Error(`故事 ${story.storyId} 情报分析失败: ${error instanceof Error ? error.message : String(error)}`);
            }
          });

          const results = await Promise.all(intelligencePromises);
          const validAnalyses = results.filter((analysis): analysis is IntelligenceAnalysis => analysis !== null);

                    console.log(`[AutoBrief] 情报分析完成，${validAnalyses.length}个故事完成详细分析`);

          // 使用数据流观察者记录AI分析指标
          const totalAnalysisTime = Date.now(); // 这里需要真实的计时逻辑
          dataFlowObserver.recordAIAnalysisMetrics(storyAnalyses.length, validAnalyses.length, 5000, undefined); // 使用估计值
          dataFlowObserver.completeStage('ai_analysis', { 
            analysisCount: storyAnalyses.length,
            successCount: validAnalyses.length 
          });

          // 记录情报分析完成
          await observability.logStep('intelligence_analysis', 'completed', {
            inputStories: storyAnalyses.length,
            completedAnalyses: validAnalyses.length,
            failedAnalyses: storyAnalyses.length - validAnalyses.length
          });

          await observability.logDataFlow('intelligence_analysis', {
            stage: 'intelligence_analysis',
            storyCount: storyAnalyses.length,
            articleCount: validAnalyses.reduce((sum, a) => sum + a.detailed_analysis.stakeholders.length, 0),
            transformationType: 'ai_deep_analysis',
            qualityMetrics: {
              completionRate: validAnalyses.length / storyAnalyses.length,
              avgStakeholderCount: validAnalyses.reduce((sum, a) => sum + a.detailed_analysis.stakeholders.length, 0) / validAnalyses.length
            }
          });
          
          return validAnalyses;
        } catch (error) {
          console.error('[AutoBrief] 情报分析失败:', error);
          throw new Error(`情报分析失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // 步骤5: 生成最终自然语言简报
      console.log('[AutoBrief] 步骤5: 生成最终自然语言简报');
      await observability.logStep('brief_generation', 'started');
      const briefResult = await step.do('生成最终自然语言简报', async () => {
        try {
          const db = getDb(this.env.HYPERDRIVE);

          // 准备分析数据用于简报生成
          const analysisDataForBrief = intelligenceAnalyses.map(intel => {
            const analysis = intel.detailed_analysis;
            
            // 将简化的详细分析转换为完整格式，以匹配 reportV5.md 的数据结构
            return {
              status: 'complete',
              executiveSummary: analysis.overview,
              storyStatus: analysis.outlook?.split(' ')[0] || 'Developing', // 提取状态
              timeline: [], // 简化版本暂时没有详细时间线
              significance: {
                assessment: analysis.outlook?.includes('高') ? 'High' : 
                           analysis.outlook?.includes('中') ? 'Moderate' : 'Low',
                reasoning: `重要性基于: ${analysis.implications.join('; ')}`
              },
              undisputedKeyFacts: analysis.key_developments.slice(0, 5),
              keyEntities: {
                list: analysis.stakeholders.map(stakeholder => ({
                  name: stakeholder,
                  type: 'Entity',
                  description: `参与实体`,
                  involvement: '相关方'
                }))
              },
              signalStrength: {
                assessment: 'Medium',
                reasoning: '基于多源分析的可靠性评估'
              },
              informationGaps: analysis.implications.includes('需要') ? 
                             ['需要更多详细信息', '持续监控发展'] : []
            };
          });

          console.log(`[AutoBrief] 准备调用简报生成服务，分析数据: ${analysisDataForBrief.length} 个故事`);

          // 获取最近的简报作为上下文（可选）
          let previousBrief = null;
          try {
            const lastReport = await db
              .select({
                title: $reports.title,
                tldr: $reports.tldr,
                createdAt: $reports.createdAt,
              })
              .from($reports)
              .orderBy(desc($reports.createdAt))
              .limit(1);
            
            if (lastReport.length > 0) {
              const lastReportDate = new Date(lastReport[0].createdAt);
              const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
              
              // 只有当最近的简报是昨天或更近的时候才使用作为上下文
              if (lastReportDate >= yesterday) {
                previousBrief = {
                  title: lastReport[0].title,
                  tldr: lastReport[0].tldr,
                  date: lastReportDate.toISOString().split('T')[0]
                };
              }
            }
          } catch (error) {
            console.warn('[AutoBrief] 获取前一天简报失败，继续不使用上下文:', error);
          }

          // 构建简报生成请求
          const briefGenerationRequest = {
            analysisData: analysisDataForBrief,
            previousBrief: previousBrief,
            options: {
              provider: 'google-ai-studio',
              model: 'gemini-2.0-flash' // 使用稳定可用的模型生成简报
            }
          };

          console.log(`[AutoBrief] 调用AI Worker简报生成服务`);

          // 调用AI Worker的简报生成端点
          const request = new Request(`https://meridian-ai-worker/meridian/generate-final-brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(briefGenerationRequest)
          });

          const response = await this.env.AI_WORKER.fetch(request);
          const briefGenerationResult = await handleServiceResponse<any>(response, 'Brief generation');

          if (!briefGenerationResult.success) {
            throw new Error(`简报生成失败: ${briefGenerationResult.error}`);
          }

          // 安全地解构简报数据，并添加调试信息
          console.log(`[AutoBrief] 简报生成响应:`, JSON.stringify(briefGenerationResult, null, 2));
          
          // handleServiceResponse返回的data字段包含AI Worker的原始响应
          // AI Worker响应格式: { success: true, data: { title: "...", content: "..." } }
          const aiWorkerResponse = briefGenerationResult.data;
          const briefTitle = aiWorkerResponse?.data?.title;
          const briefContent = aiWorkerResponse?.data?.content;
          
          if (!briefTitle || !briefContent) {
            console.error(`[AutoBrief] 简报生成响应缺少必要字段:`, {
              hasTitle: !!briefTitle,
              hasContent: !!briefContent,
              actualData: aiWorkerResponse
            });
            throw new Error(`简报生成响应格式异常: title=${!!briefTitle}, content=${!!briefContent}`);
          }

          console.log(`[AutoBrief] 简报生成成功: "${briefTitle}", 长度: ${briefContent.length} 字符`);

          // 生成TLDR（简化版）
          const tldr = analysisDataForBrief.map((_, index) => {
            const intel = intelligenceAnalyses[index];
            if (intel) {
              return `${intel.detailed_analysis.overview.substring(0, 80)}...`;
            }
            return '';
          }).filter(Boolean).slice(0, 3).join(' | ');

          // 保存到数据库
          const insertResult = await db
            .insert($reports)
            .values({
              title: briefTitle,
              content: briefContent, // 保存自然语言内容而不是JSON
              totalArticles: articles.length,
              totalSources: 0, // TODO: 计算实际源数量
              usedArticles: articles.filter(a => 
                clusterResult.clusters.some(cluster => 
                  cluster.articles.some(ca => ca.id === a.id)
                )
              ).length,
              usedSources: 0, // TODO: 计算实际使用的源数量
              tldr: tldr || `本期简报分析了${articles.length}篇文章，识别出${storyAnalyses.length}个重要故事`,
              clustering_params: JSON.stringify({
                strategy: clusteringOptions?.strategy || 'adaptive_threshold',
                preprocessing: clusteringOptions?.preprocessing || 'abs_normalize',
                min_quality_score: clusteringOptions?.min_quality_score || 0.3,
                auto_optimized: true
              }),
              model_author: aiWorkerResponse?.data?.metadata?.model_used || 'Meridian AI System',
            })
            .returning({ id: $reports.id });

          const briefId = insertResult[0].id;
          console.log(`[AutoBrief] 最终简报保存完成，ID: ${briefId}`);

          // 记录简报生成指标
          const r2AccessStats = {
            attempted: articles.length,
            successful: articles.filter(a => a.contentFileKey).length,
            failed: articles.filter(a => !a.contentFileKey).length,
            avgContentLength: briefContent.length / intelligenceAnalyses.length
          };

          await observability.logBriefGeneration({
            totalAnalysisTime: Date.now() - new Date().getTime(),
            aiModelUsed: aiWorkerResponse?.data?.metadata?.model_used || 'unknown',
            tokensUsed: aiWorkerResponse?.data?.metadata?.tokens_used,
            costEstimate: aiWorkerResponse?.data?.metadata?.cost_estimate,
            contentLength: briefContent.length,
            storiesProcessed: intelligenceAnalyses.length,
            r2ContentAccess: r2AccessStats
          });

          await observability.logDataFlow('brief_generation', {
            stage: 'brief_generation',
            articleCount: articles.length,
            storyCount: intelligenceAnalyses.length,
            transformationType: 'ai_natural_language_generation',
            qualityMetrics: {
              finalContentLength: briefContent.length,
              storiesIncluded: intelligenceAnalyses.length,
              articlesUsed: articles.filter(a => 
                clusterResult.clusters.some(cluster => 
                  cluster.articles.some(ca => ca.id === a.id)
                )
              ).length
            }
          });

          return {
            briefId: briefId,
            title: briefTitle,
            content: briefContent,
            stats: {
              total_articles: articles.length,
              clusters_found: clusterResult.clusters.length,
              stories_identified: storyAnalyses.length,
              intelligence_analyses: intelligenceAnalyses.length,
              content_length: briefContent.length,
              model_used: aiWorkerResponse?.data?.metadata?.model_used
            },
          };
        } catch (error) {
          console.error('[AutoBrief] 简报生成失败:', error);
          throw new Error(`简报生成失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      console.log(`[AutoBrief] 工作流完成，简报ID: ${briefResult.briefId}`);

      // 使用数据流观察者记录最终简报生成指标
      dataFlowObserver.startStage('brief_generation', { storyCount: intelligenceAnalyses.length });
      dataFlowObserver.recordBriefGenerationMetrics(
        briefResult.stats.total_articles, 
        articles.length, 
        briefResult.stats.stories_identified, 
        briefResult.content.length
      );
      dataFlowObserver.completeStage('brief_generation', { 
        briefId: briefResult.briefId,
        contentLength: briefResult.content.length,
        modelUsed: briefResult.stats.model_used
      });

      // 记录工作流成功完成
      await observability.logStep('workflow_complete', 'completed', {
        briefId: briefResult.briefId,
        totalStats: briefResult.stats,
        triggerInfo: { triggeredBy, dateFrom, dateTo, minImportance }
      });

      // 保存数据流监控数据
      await dataFlowObserver.saveObservabilityData();

      // 持久化所有指标到R2
      await observability.complete();

      return {
        success: true,
        briefId: briefResult.briefId,
        stats: briefResult.stats,
        triggerInfo: {
          triggeredBy,
          dateFrom,
          dateTo,
          minImportance,
        },
      };
    } catch (error) {
      console.error('[AutoBrief] 工作流失败:', error);
      await observability.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
} 