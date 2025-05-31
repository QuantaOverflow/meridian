import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { getDb } from '../lib/utils';
import { $articles, $reports, gte, lte, isNotNull, and, eq } from '@meridian/database';

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
  }>;
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
    enable_fallback?: boolean;
  };
  
  // 业务控制参数
  maxStoriesToGenerate?: number;
  storyMinImportance?: number;
}

export class AutoBriefGenerationWorkflow extends WorkflowEntrypoint<Env, BriefGenerationParams> {
  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      triggeredBy = 'manual', 
      dateFrom, 
      dateTo, 
      minImportance = 5,
      
      // 简化的配置参数
      articleLimit = 50,
      timeRangeDays,
      clusteringOptions,
      maxStoriesToGenerate = 15,
      storyMinImportance = 0.1
    } = event.payload;

    console.log(`[AutoBriefGeneration] 开始简报生成工作流, 参数:`, {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      minImportance,
      customClusteringOptions: !!clusteringOptions
    });

    // 步骤1: 从数据库获取已处理的文章（而不是从AI Worker）
    console.log('[AutoBrief] 步骤1: 从数据库获取文章数据');
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
        
        // 如果没有指定时间范围，默认查询最近30天
        if (!dateFrom && !dateTo) {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          timeConditions.push(gte($articles.publishDate, thirtyDaysAgo));
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

    if (articles.length < 2) {
      const errorMsg = `文章数量不足进行聚类分析 (获取到 ${articles.length} 篇, 需要至少 2 篇)`;
      console.error(`[AutoBrief] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 步骤2: 聚类分析
    console.log('[AutoBrief] 步骤2: 执行聚类分析');
    const clusterResult = await step.do('聚类分析', async (): Promise<ClusterResult> => {
      try {
        // 准备发送给聚类分析的数据
        const articlesForClustering = articles.map(a => ({
          id: a.id,
          embedding: a.embedding,
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

        // 使用简化的聚类系统 - 让AI Worker处理参数优化
        const clusterRequest = new Request('https://meridian-ai-worker/meridian/clustering/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            articles: articlesForClustering,
            options: {
              // 基础配置，让AI Worker进行智能优化
              preprocessing: clusteringOptions?.preprocessing || 'abs_normalize',
              strategy: clusteringOptions?.strategy || 'adaptive_threshold',
              enable_quality_check: true,
              min_quality_score: 0.3,
              enable_fallback: clusteringOptions?.enable_fallback !== false,
              // 让AI Worker根据文章数量自动选择最优参数
              auto_optimize: true
            },
          }),
        });

        console.log(`[AutoBrief] 发送聚类请求到AI Worker...`);
        const response = await this.env.AI_WORKER.fetch(clusterRequest);
        const result = await response.json() as any;

        console.log(`[AutoBrief] 聚类响应状态: ${response.status}, 成功: ${response.ok}`);
        console.log(`[AutoBrief] 聚类响应内容:`, JSON.stringify(result));

        if (!response.ok || result.error) {
          throw new Error(`聚类分析失败: ${result.error || response.statusText}`);
        }

        // 处理聚类结果
        const clusteringResult = result;
        
        console.log(`[AutoBrief] 聚类分析结果:`, JSON.stringify(clusteringResult, null, 2));

        // 转换为workflow期望的格式
        const clusters = clusteringResult.clusters?.map((cluster: any) => ({
          id: cluster.cluster_id,
          articles: articles.filter(a => cluster.articles_ids.includes(a.id)),
          similarity_score: cluster.cohesion_score || 0.8,
          quality_metrics: {
            cohesion_score: cluster.cohesion_score,
            stability_score: cluster.stability_score,
            size: cluster.size
          }
        })) || [];
        
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

    if (clusterResult.clusters.length === 0) {
      throw new Error('聚类分析未发现任何有意义的文章聚类');
    }

    // 步骤3: 故事分析
    console.log('[AutoBrief] 步骤3: 执行故事分析');
    const storyAnalyses = await step.do('故事分析', async (): Promise<StoryAnalysis[]> => {
      try {
        const storyPromises = clusterResult.clusters.map(async (cluster, index) => {
          console.log(`[AutoBrief] 分析聚类 ${cluster.id}，包含 ${cluster.articles.length} 篇文章`);
          
          const storyRequest = new Request('https://meridian-ai-worker/meridian/clustering/analyze-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cluster_id: cluster.id,
              articles_ids: cluster.articles.map(a => a.id),
              articles_data: cluster.articles,
              options: {
                min_importance: minImportance,
              },
            }),
          });

          const response = await this.env.AI_WORKER.fetch(storyRequest);
          const result = await response.json() as any;

          console.log(`[AutoBrief] 聚类 ${cluster.id} 故事分析响应:`, JSON.stringify(result));

          if (!result.success) {
            console.warn(`[AutoBrief] 聚类 ${cluster.id} 故事分析失败: ${result.error}`);
            return null;
          }

          const storyAnalysis = {
            storyId: cluster.id,
            analysis: {
              story_type: result.data.answer || 'single_story',
              importance: result.data.importance || 1,
              summary: result.data.title || `Story ${cluster.id}`,
              key_themes: [],
            },
          } as StoryAnalysis;

          console.log(`[AutoBrief] 聚类 ${cluster.id} 故事重要性: ${storyAnalysis.analysis.importance}, 阈值: ${minImportance}`);

          return storyAnalysis;
        });

        const results = await Promise.all(storyPromises);
        const validAnalyses = results.filter((analysis): analysis is StoryAnalysis => 
          analysis !== null && analysis.analysis.importance >= minImportance
        );

        console.log(`[AutoBrief] 故事分析完成，${validAnalyses.length}个故事达到重要性阈值`);
        return validAnalyses;
      } catch (error) {
        console.error('[AutoBrief] 故事分析失败:', error);
        throw new Error(`故事分析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    if (storyAnalyses.length === 0) {
      throw new Error(`未发现重要性达到阈值 (${minImportance}) 的故事`);
    }

    // 步骤4: 情报分析
    console.log('[AutoBrief] 步骤4: 执行情报分析');
    const intelligenceAnalyses = await step.do('情报分析', async (): Promise<IntelligenceAnalysis[]> => {
      try {
        const intelligencePromises = storyAnalyses.map(async (story) => {
          const intelligenceRequest = new Request('https://meridian-ai-worker/meridian/intelligence/analyze-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              story: story,
              cluster: clusterResult.clusters.find(c => c.id === story.storyId),
              options: {
                analysis_depth: 'detailed',
              },
            }),
          });

          const response = await this.env.AI_WORKER.fetch(intelligenceRequest);
          const result = await response.json() as any;

          if (!result.success) {
            console.warn(`[AutoBrief] 故事 ${story.storyId} 情报分析失败: ${result.error}`);
            return null;
          }

          return {
            story_id: story.storyId,
            detailed_analysis: result.data,
          } as IntelligenceAnalysis;
        });

        const results = await Promise.all(intelligencePromises);
        const validAnalyses = results.filter((analysis): analysis is IntelligenceAnalysis => analysis !== null);

        console.log(`[AutoBrief] 情报分析完成，${validAnalyses.length}个故事完成详细分析`);
        return validAnalyses;
      } catch (error) {
        console.error('[AutoBrief] 情报分析失败:', error);
        throw new Error(`情报分析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // 步骤5: 生成并保存简报
    console.log('[AutoBrief] 步骤5: 生成简报文档');
    const briefResult = await step.do('生成简报文档', async () => {
      try {
        const db = getDb(this.env.HYPERDRIVE);

        // 生成简报内容
        const briefContent = {
          title: `智能简报 - ${new Date().toLocaleDateString('zh-CN')}`,
          generation_date: new Date().toISOString(),
          triggered_by: triggeredBy,
          stats: {
            total_articles: articles.length,
            clusters_found: clusterResult.clusters.length,
            stories_identified: storyAnalyses.length,
            intelligence_analyses: intelligenceAnalyses.length,
          },
          stories: storyAnalyses.map(story => {
            const intelligence = intelligenceAnalyses.find(intel => intel.story_id === story.storyId);
            const cluster = clusterResult.clusters.find(c => c.id === story.storyId);
            
            return {
              id: story.storyId,
              story_analysis: story.analysis,
              intelligence_analysis: intelligence?.detailed_analysis,
              articles: cluster?.articles.map(a => ({
                id: a.id,
                title: a.title,
                url: a.url,
                publish_date: a.publish_date,
              })) || [],
            };
          }),
        };

        // 保存到数据库
        const insertResult = await db
          .insert($reports)
          .values({
            title: briefContent.title,
            content: JSON.stringify(briefContent),
            totalArticles: articles.length,
            totalSources: 0, // TODO: 计算实际源数量
            usedArticles: articles.filter(a => 
              clusterResult.clusters.some(cluster => 
                cluster.articles.some(ca => ca.id === a.id)
              )
            ).length,
            usedSources: 0, // TODO: 计算实际使用的源数量
            tldr: `本期简报分析了${articles.length}篇文章，识别出${storyAnalyses.length}个重要故事`,
            clustering_params: JSON.stringify({
              strategy: clusteringOptions?.strategy || 'adaptive_threshold',
              preprocessing: clusteringOptions?.preprocessing || 'abs_normalize',
              min_quality_score: clusteringOptions?.min_quality_score || 0.3,
              auto_optimized: true
            }),
            model_author: 'Meridian AI System',
          })
          .returning({ id: $reports.id });

        const briefId = insertResult[0].id;
        console.log(`[AutoBrief] 简报生成完成，ID: ${briefId}`);

        return {
          briefId: briefId,
          content: briefContent,
          stats: briefContent.stats,
        };
      } catch (error) {
        console.error('[AutoBrief] 保存简报失败:', error);
        throw new Error(`保存简报失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    console.log(`[AutoBrief] 工作流完成，简报ID: ${briefResult.briefId}`);

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
  }
} 