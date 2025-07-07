import { Hono } from 'hono';
import type { Env } from '../index';
import { getDb } from '../lib/database';
import { $reports, desc, gte } from '@meridian/database';

const app = new Hono<{ Bindings: Env }>();

// ========== 工作流监控面板 ==========

/**
 * 获取工作流执行历史
 */
app.get('/workflows', async (c) => {
  try {
    // 列出R2中存储的可观测性数据
    const observabilityPrefix = 'observability/';
    const objects = await c.env.ARTICLES_BUCKET.list({ prefix: observabilityPrefix });
    
    const workflows = await Promise.all(
      objects.objects.slice(0, 50).map(async (obj) => {
        try {
          const content = await c.env.ARTICLES_BUCKET.get(obj.key);
          if (content) {
            const data = JSON.parse(await content.text());
            return {
              key: obj.key,
              uploaded: obj.uploaded,
              size: obj.size,
              summary: data.summary,
              hasDetails: !!data.detailedMetrics
            };
          }
        } catch (error) {
          console.warn(`无法解析可观测性文件 ${obj.key}:`, error);
        }
        return null;
      })
    );

    const validWorkflows = workflows.filter(w => w !== null);

    return c.json({
      success: true,
      workflows: validWorkflows,
      total: objects.objects.length
    });
  } catch (error) {
    console.error('获取工作流历史失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * 获取特定工作流的详细指标
 */
app.get('/workflows/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const decodedKey = decodeURIComponent(key);
    
    const content = await c.env.ARTICLES_BUCKET.get(decodedKey);
    if (!content) {
      return c.json({ success: false, error: '工作流数据不存在' }, 404);
    }

    const data = JSON.parse(await content.text());
    
    // 分析工作流性能
    const metrics = data.detailedMetrics || [];
    const performance = {
      totalSteps: metrics.length,
      completedSteps: metrics.filter((m: any) => m.status === 'completed').length,
      failedSteps: metrics.filter((m: any) => m.status === 'failed').length,
      avgStepDuration: 0,
      stepBreakdown: {} as Record<string, any>
    };

    // 计算步骤耗时分析
    const stepDurations = metrics
      .filter((m: any) => m.duration)
      .reduce((acc: any, m: any) => {
        const step = m.stepName;
        if (!acc[step]) {
          acc[step] = { total: 0, count: 0, durations: [] };
        }
        acc[step].total += m.duration;
        acc[step].count += 1;
        acc[step].durations.push(m.duration);
        return acc;
      }, {});

    Object.keys(stepDurations).forEach(step => {
      const stepData = stepDurations[step];
      performance.stepBreakdown[step] = {
        avgDuration: stepData.total / stepData.count,
        totalDuration: stepData.total,
        executions: stepData.count,
        minDuration: Math.min(...stepData.durations),
        maxDuration: Math.max(...stepData.durations)
      };
    });

    performance.avgStepDuration = Object.values(performance.stepBreakdown)
      .reduce((sum: number, step: any) => sum + step.avgDuration, 0) / 
      Object.keys(performance.stepBreakdown).length;

    return c.json({
      success: true,
      summary: data.summary,
      performance,
      detailedMetrics: data.detailedMetrics,
      recommendations: generatePerformanceRecommendations(performance)
    });
  } catch (error) {
    console.error('获取工作流详情失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * 获取简报生成统计数据
 */
app.get('/briefs/stats', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 获取最近30天的简报
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentBriefs = await db
      .select({
        id: $reports.id,
        title: $reports.title,
        createdAt: $reports.createdAt,
        totalArticles: $reports.totalArticles,
        usedArticles: $reports.usedArticles,
        totalSources: $reports.totalSources,
        usedSources: $reports.usedSources,
        clustering_params: $reports.clustering_params,
        model_author: $reports.model_author
      })
      .from($reports)
      .where(gte($reports.createdAt, thirtyDaysAgo))
      .orderBy(desc($reports.createdAt));

    // 计算统计数据
    const stats = {
      totalBriefs: recentBriefs.length,
      avgArticlesPerBrief: recentBriefs.reduce((sum, b) => sum + (b.totalArticles || 0), 0) / recentBriefs.length,
      avgUsageRate: recentBriefs.reduce((sum, b) => {
        if (b.totalArticles && b.usedArticles) {
          return sum + (b.usedArticles / b.totalArticles);
        }
        return sum;
      }, 0) / recentBriefs.length,
      modelDistribution: {} as Record<string, number>,
      qualityTrends: [] as any[],
      briefFrequency: {} as Record<string, number>
    };

    // 分析模型使用分布
    recentBriefs.forEach(brief => {
      const model = brief.model_author || 'Unknown';
      stats.modelDistribution[model] = (stats.modelDistribution[model] || 0) + 1;
    });

    // 分析简报生成频率（按日期）
    recentBriefs.forEach(brief => {
      const date = brief.createdAt.toISOString().split('T')[0];
      stats.briefFrequency[date] = (stats.briefFrequency[date] || 0) + 1;
    });

    // 分析质量趋势
    stats.qualityTrends = recentBriefs.map(brief => {
      let clusteringParams: any = {};
      let isAiWorkerGenerated = false;
      
      try {
        if (brief.clustering_params) {
          // 由于clustering_params是jsonb字段，Drizzle会自动解析JSON
          const parsedParams = brief.clustering_params as any;
          
          // 检查是否是AI Worker生成的简报（新格式）
          if (parsedParams.aiWorkerGenerated || parsedParams.workflowId) {
            isAiWorkerGenerated = true;
            clusteringParams = {
              strategy: 'ai_worker_generated',
              min_quality_score: 0.5 // AI Worker默认质量标准
            };
          } else {
            // 旧格式的聚类参数
            clusteringParams = parsedParams;
          }
        }
      } catch (e) {
        // 处理解析错误的极端情况
        clusteringParams = {
          strategy: 'parse_error',
          min_quality_score: 0.3
        };
      }

      return {
        date: brief.createdAt.toISOString().split('T')[0],
        briefId: brief.id,
        articleUsageRate: brief.totalArticles && brief.usedArticles ? 
          (brief.usedArticles / brief.totalArticles) : 0,
        totalArticles: brief.totalArticles,
        usedArticles: brief.usedArticles,
        clusteringStrategy: clusteringParams.strategy || 'unknown',
        qualityScore: clusteringParams.min_quality_score || 0.3,
        isAiWorkerGenerated
      };
    });

    return c.json({
      success: true,
      stats,
      recentBriefs: recentBriefs.map(brief => ({
        id: brief.id,
        title: brief.title,
        createdAt: brief.createdAt,
        articleStats: {
          total: brief.totalArticles,
          used: brief.usedArticles,
          usageRate: brief.totalArticles && brief.usedArticles ? 
            ((brief.usedArticles / brief.totalArticles) * 100).toFixed(1) + '%' : 'N/A'
        }
      }))
    });
  } catch (error) {
    console.error('获取简报统计失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * 实时监控面板 - 获取当前系统状态
 */
app.get('/dashboard', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 获取最近24小时的活动
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivity = await db
      .select({
        id: $reports.id,
        title: $reports.title,
        createdAt: $reports.createdAt,
        totalArticles: $reports.totalArticles,
        usedArticles: $reports.usedArticles
      })
      .from($reports)
      .where(gte($reports.createdAt, last24Hours))
      .orderBy(desc($reports.createdAt))
      .limit(10);

    // 获取可观测性数据概览
    const observabilityObjects = await c.env.ARTICLES_BUCKET.list({ 
      prefix: 'observability/', 
      limit: 10 
    });

    const systemHealth = {
      status: 'healthy',
      lastBriefGenerated: recentActivity.length > 0 ? recentActivity[0].createdAt : null,
      briefsLast24h: recentActivity.length,
      avgProcessingTime: 'N/A', // 需要从可观测性数据计算
      errorRate: 0, // 需要从可观测性数据计算
      observabilityDataPoints: observabilityObjects.objects.length
    };

    // 尝试从最新的可观测性数据中获取性能指标
    if (observabilityObjects.objects.length > 0) {
      try {
        const latestObservability = await c.env.ARTICLES_BUCKET.get(
          observabilityObjects.objects[0].key
        );
        if (latestObservability) {
          const data = JSON.parse(await latestObservability.text());
          if (data.summary) {
            systemHealth.avgProcessingTime = `${(data.summary.totalDuration / 1000).toFixed(1)}s`;
            systemHealth.errorRate = data.summary.failedSteps / data.summary.stepCount;
          }
        }
      } catch (error) {
        console.warn('无法解析最新可观测性数据:', error);
      }
    }

    return c.json({
      success: true,
      systemHealth,
      recentActivity,
      recommendations: [
        recentActivity.length === 0 ? '过去24小时内没有生成简报，请检查定时任务' : null,
        systemHealth.errorRate > 0.1 ? '错误率较高，请检查工作流日志' : null,
        observabilityObjects.objects.length < 5 ? '可观测性数据较少，建议增加监控覆盖' : null
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('获取监控面板数据失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * 数据质量分析
 */
app.get('/quality/analysis', async (c) => {
  try {
    // 这里可以添加更详细的数据质量分析
    // 比如分析文章质量分布、聚类质量等
    
    return c.json({
      success: true,
      message: '数据质量分析功能待实现',
      placeholder: {
        articleQualityDistribution: {
          high: 0,
          medium: 0,
          low: 0
        },
        clusteringQuality: {
          avgCoherence: 0,
          avgClusterSize: 0
        },
        storyQuality: {
          avgImportance: 0,
          selectionRate: 0
        }
      }
    });
  } catch (error) {
    console.error('数据质量分析失败:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// ========== 辅助函数 ==========

function generatePerformanceRecommendations(performance: any): string[] {
  const recommendations = [];
  
  if (performance.avgStepDuration > 30000) { // 30秒
    recommendations.push('工作流平均步骤耗时较长，建议优化AI调用和数据库查询');
  }
  
  if (performance.failedSteps > 0) {
    recommendations.push(`有${performance.failedSteps}个步骤失败，请检查错误日志`);
  }
  
  const clusteringStep = performance.stepBreakdown['clustering_analysis'];
  if (clusteringStep && clusteringStep.avgDuration > 15000) {
    recommendations.push('聚类分析耗时较长，考虑优化聚类参数或减少输入文章数量');
  }
  
  const intelligenceStep = performance.stepBreakdown['intelligence_analysis'];
  if (intelligenceStep && intelligenceStep.avgDuration > 20000) {
    recommendations.push('情报分析耗时较长，考虑使用更快的AI模型或批量处理');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('工作流性能良好，无需优化');
  }
  
  return recommendations;
}

export default app; 