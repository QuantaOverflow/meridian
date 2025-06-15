import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { getDb } from '../lib/utils';
import { $articles, $reports, gte, lte, isNotNull, and, eq, desc } from '@meridian/database';
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


// AI Worker 简报生成的分析数据接口
interface AnalysisDataForBrief {
  executiveSummary: string;
  storyStatus: string;
  timeline?: Array<{
    date?: string;
    description?: string;
    importance?: string;
  }>;
  significance?: {
    assessment: string;
    reasoning: string;
  };
  undisputedKeyFacts?: string[];
  keySources?: {
    contradictions?: Array<{
      issue: string;
    }>;
  };
  keyEntities?: {
    list: Array<{
      name: string;
      type: string;
      involvement: string;
    }>;
  };
  informationGaps?: string[];
  signalStrength?: {
    assessment: string;
  };
}

export interface BriefGenerationParams {
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

// 简报生成结果的期望接口 (从AI Worker返回)
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

export class AutoBriefGenerationWorkflow extends WorkflowEntrypoint<Env, BriefGenerationParams> {
  
  /**
   * 调用AI Worker服务的通用方法
   */
  private async callAIWorker(endpoint: string, data: any): Promise<any> {
    const request = new Request(`http://localhost:8786${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    const response = await fetch(request);
    
    if (!response.ok) {
      throw new Error(`AI Worker调用失败 (${endpoint}): ${response.status} ${response.statusText}`);
    }

    const result: any = await response.json();
    if (!result.success) {
      throw new Error(`AI Worker处理失败 (${endpoint}): ${result.error}`);
    }

    return result.data;
  }

  async run(event: WorkflowEvent<BriefGenerationParams>, step: WorkflowStep) {
    const { 
      triggeredBy = 'system', 
      dateFrom, 
      dateTo, 
      minImportance = 3,
      
      articleLimit = 50,
      timeRangeDays,
      clusteringOptions,
      maxStoriesToGenerate = 15,
      storyMinImportance = 0.1
    } = event.payload;

    const workflowId = crypto.randomUUID();
    const observability = createWorkflowObservability(workflowId, this.env);
    
    await observability.logStep('workflow_start', 'started', {
      triggeredBy,
      articleLimit,
      timeRangeDays,
      minImportance,
      customClusteringOptions: !!clusteringOptions,
      maxStoriesToGenerate,
      storyMinImportance
    });

    try {
      console.log(`[AutoBriefGeneration] 开始简报生成工作流, 参数:`, event.payload);
      
      // 步骤1: 从数据库获取已处理的文章
      await observability.logStep('fetch_articles', 'started');
      const articles = await step.do('获取已处理文章', async (): Promise<ArticleRecord[]> => {
        try {
          const db = getDb(this.env.HYPERDRIVE);
          const timeConditions = [];
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
                ...timeConditions
              )
            )
            .limit(articleLimit || 100);

          console.log(`[AutoBrief] 从数据库获取到 ${queryResult.length} 篇文章`);

          const validArticles = queryResult.filter(row => 
            Array.isArray(row.embedding) && row.embedding.length === 384
          );
          
          if (queryResult.length !== validArticles.length) {
            console.warn(`[AutoBrief] 过滤掉 ${queryResult.length - validArticles.length} 篇无效嵌入向量的文章`);
          }

          return validArticles.map(a => ({ 
            ...a, 
            embedding: a.embedding as number[],
            // 转换 null 为 undefined 以匹配接口类型
            language: a.language || undefined,
            primary_location: a.primary_location || undefined,
            completeness: a.completeness || undefined,
            content_quality: a.content_quality || undefined,
            event_summary_points: (a.event_summary_points as string[]) || undefined,
            thematic_keywords: (a.thematic_keywords as string[]) || undefined,
            topic_tags: (a.topic_tags as string[]) || undefined,
            key_entities: (a.key_entities as string[]) || undefined,
            content_focus: (a.content_focus as string[]) || undefined,
          }));
        } catch (error) {
          console.error('[AutoBrief] 获取文章失败:', error);
          throw new Error(`数据库查询失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      const articleQuality = DataQualityAssessor.assessArticleQuality(articles);
      await observability.logStep('fetch_articles', 'completed', {
        articleCount: articles.length,
        qualityAssessment: articleQuality
      });

      if (articles.length < 2) {
        const errorMsg = `文章数量不足进行简报生成 (获取到 ${articles.length} 篇, 需要至少 2 篇)`;
        console.error(`[AutoBrief] ${errorMsg}`);
        await observability.fail(errorMsg);
        throw new Error(errorMsg);
      }

      // 步骤2: 从数据库获取已分析的数据并转换为简报生成格式
      await observability.logStep('prepare_analysis_data', 'started', { articleCount: articles.length });
      const analysisData = await step.do('准备已分析数据', async (): Promise<AnalysisDataForBrief[]> => {
        console.log(`[AutoBrief] 从数据库中的已分析数据构建简报输入，处理 ${articles.length} 篇文章`);
        
        // 从已处理的文章中构建分析数据，无需重新调用AI分析
        const preparedAnalysisData = articles.slice(0, maxStoriesToGenerate || 10).map((article) => {
          // 从数据库中的分析结果构建简报生成所需的数据结构
          const analysisDataForBrief: AnalysisDataForBrief = {
            executiveSummary: article.title, // 使用标题作为执行摘要
            storyStatus: 'verified', // 已处理的文章状态为已验证
            timeline: [{
              date: article.publish_date?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
              description: article.title,
              importance: 'High'
            }],
            significance: {
              assessment: 'Moderate', // 默认重要性评估
              reasoning: `基于文章标题和内容质量的评估: ${article.title}`
            },
            undisputedKeyFacts: [
              `文章标题: ${article.title}`,
              `发布时间: ${article.publish_date?.toISOString().split('T')[0] || '未知'}`,
              `来源URL: ${article.url}`
            ],
            keySources: {
              contradictions: [] // 暂无矛盾信息
            },
            keyEntities: {
              list: (Array.isArray(article.key_entities) ? article.key_entities : []).slice(0, 3).map((entity: any) => ({
                name: typeof entity === 'string' ? entity : entity.name || 'Unknown',
                type: 'Entity',
                involvement: '在文章中被提及'
              }))
            },
            informationGaps: [
              '需要更详细的后续发展信息',
              '需要更多背景上下文'
            ],
            signalStrength: {
              assessment: 'Medium' // 默认信号强度
            }
          };

          return analysisDataForBrief;
        });

        console.log(`[AutoBrief] 成功准备 ${preparedAnalysisData.length} 个分析数据项`);
        return preparedAnalysisData;
      });

      await observability.logStep('prepare_analysis_data', 'completed', { 
        prepared: analysisData.length,
        total: articles.length 
      });

      if (analysisData.length === 0) {
        const errorMsg = '没有可用的已分析文章数据，无法生成简报';
        console.error(`[AutoBrief] ${errorMsg}`);
        await observability.fail(errorMsg);
        throw new Error(errorMsg);
      }

      // 步骤3: 通过AI Worker生成简报
      await observability.logStep('generate_brief', 'started', { analysisCount: analysisData.length });
      const briefResult = await step.do('AI简报生成', async (): Promise<BriefGenerationResultData> => {
        console.log(`[AutoBrief] 开始通过AI Worker生成简报，基于 ${analysisData.length} 个分析结果`);
        
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
        try {
          const briefData = await this.callAIWorker('/meridian/generate-final-brief', {
            analysisData: analysisData,
            previousBrief: previousBrief,
            options: {
              provider: 'google-ai-studio',
              model: 'gemini-2.0-flash'
            }
          });

          console.log(`[AutoBrief] 成功生成简报: ${briefData.title}`);

          // 生成TLDR
          const tldrData = await this.callAIWorker('/meridian/generate-brief-tldr', {
            briefTitle: briefData.title,
            briefContent: briefData.content,
            options: {
              provider: 'google-ai-studio',
              model: 'gemini-2.0-flash'
            }
          });

          console.log(`[AutoBrief] 成功生成TLDR，包含 ${tldrData.story_count} 个故事项目`);

          return {
            title: briefData.title,
            content: briefData.content,
            tldr: tldrData.tldr,
            model_author: 'meridian-ai-worker',
            stats: {
              total_articles: articles.length,
              used_articles: analysisData.length,
              clusters_found: 0, // AI Worker处理的聚类信息不暴露
              stories_identified: analysisData.length,
              intelligence_analyses: analysisData.length,
              content_length: briefData.content.length,
              model_used: briefData.metadata?.model_used || 'gemini-2.0-flash'
            }
          };
        } catch (error) {
          console.error(`[AutoBrief] AI Worker简报生成失败:`, error);
          throw new Error(`简报生成失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      await observability.logStep('generate_brief', 'completed', briefResult.stats);

      // 步骤4: 保存简报到数据库
      await observability.logStep('save_brief', 'started');
      const reportId = await step.do('保存简报', async (): Promise<number> => {
        try {
                   const db = getDb(this.env.HYPERDRIVE);
           
           const insertResult = await db
             .insert($reports)
             .values({
               title: briefResult.title,
               content: briefResult.content,
               totalArticles: briefResult.stats.total_articles,
               totalSources: 0, // 暂时不统计来源数量
               usedArticles: briefResult.stats.used_articles,
               usedSources: 0, // 暂时不统计来源数量
               tldr: briefResult.tldr,
               clustering_params: {
                 workflowId,
                 triggeredBy,
                 stats: briefResult.stats,
                 generatedAt: new Date().toISOString(),
                 aiWorkerGenerated: true
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

      // 完成工作流
      await observability.logStep('workflow_complete', 'completed', {
        reportId,
        title: briefResult.title,
        contentLength: briefResult.content.length,
        tldrLength: briefResult.tldr?.length || 0,
        stats: briefResult.stats
      });

      console.log(`[AutoBrief] 简报生成工作流完成! 报告ID: ${reportId}, 标题: ${briefResult.title}`);

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