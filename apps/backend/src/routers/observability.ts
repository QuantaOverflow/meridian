import { Hono } from 'hono';
import type { Env } from '../index';
import { getDb } from '../lib/database';
import { $reports, $brief_runs, $brief_stories, $cluster_rejections, $articles, and, eq, desc, gte, sql } from '@meridian/database';

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

// ========== 新观测性聚合查询（Phase 3） ==========

/**
 * 一次拉到 brief workflow 的完整链路：brief_runs + stories + rejections + 可观测性快照 + 关联报告
 */
app.get('/runs/:workflowId', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const db = getDb(c.env.HYPERDRIVE);

    const runs = await db
      .select()
      .from($brief_runs)
      .where(eq($brief_runs.workflow_id, workflowId))
      .limit(1);

    if (runs.length === 0) {
      return c.json({ success: false, error: 'workflow not found' }, 404);
    }
    const run = runs[0];

    const [stories, rejections] = await Promise.all([
      db
        .select()
        .from($brief_stories)
        .where(eq($brief_stories.workflow_id, workflowId))
        .orderBy(desc($brief_stories.importance)),
      db
        .select()
        .from($cluster_rejections)
        .where(eq($cluster_rejections.workflow_id, workflowId)),
    ]);

    // R2 可观测性快照（Phase 1 起以稳定 key 存储）
    let observabilitySnapshot: any = null;
    try {
      const obj = await c.env.ARTICLES_BUCKET.get(`observability/${workflowId}.json`);
      if (obj) observabilitySnapshot = JSON.parse(await obj.text());
    } catch (e) {
      // 静默：观测性数据缺失不影响其他链路
    }

    // 列出该 workflow 全部 intel report R2 key
    const intelList = await c.env.ARTICLES_BUCKET.list({ prefix: `intel-reports/${workflowId}/` });

    return c.json({
      success: true,
      run,
      stories,
      rejections,
      intelReportKeys: intelList.objects.map((o) => o.key),
      observability: observabilitySnapshot,
    });
  } catch (error) {
    console.error('/observability/runs/:workflowId 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 拿单份 intel report 全文（直接从 R2 流式返回 JSON）
 */
app.get('/runs/:workflowId/stories/:storyId/intel', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const storyId = parseInt(c.req.param('storyId'), 10);
    const db = getDb(c.env.HYPERDRIVE);

    const stories = await db
      .select({ key: $brief_stories.intel_report_r2_key })
      .from($brief_stories)
      .where(and(eq($brief_stories.workflow_id, workflowId), eq($brief_stories.id, storyId)))
      .limit(1);

    if (stories.length === 0 || !stories[0].key) {
      return c.json({ success: false, error: 'intel report not found' }, 404);
    }

    const obj = await c.env.ARTICLES_BUCKET.get(stories[0].key);
    if (!obj) {
      return c.json({ success: false, error: 'intel report missing in R2' }, 404);
    }

    return new Response(obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('/observability/runs/:workflowId/stories/:storyId/intel 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 业务质量趋势：按天聚合最近 N 天的 brief_runs / brief_stories 指标
 */
app.get('/trends', async (c) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(c.req.query('days') || '14', 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const db = getDb(c.env.HYPERDRIVE);

    // 按天聚合 run 级指标
    const runTrends = await db
      .select({
        day: sql<string>`date_trunc('day', ${$brief_runs.started_at})::date::text`,
        total_runs: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'COMPLETED')::int`,
        failed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'FAILED')::int`,
        terminated: sql<number>`count(*) filter (where ${$brief_runs.status} = 'TERMINATED_NO_STORIES')::int`,
        avg_articles: sql<number>`avg(${$brief_runs.total_articles})::real`,
        avg_clusters: sql<number>`avg(${$brief_runs.clusters_found})::real`,
        avg_stories: sql<number>`avg(${$brief_runs.stories_identified})::real`,
        avg_brief_len: sql<number>`avg(${$brief_runs.brief_content_length})::real`,
      })
      .from($brief_runs)
      .where(gte($brief_runs.started_at, since))
      .groupBy(sql`date_trunc('day', ${$brief_runs.started_at})`)
      .orderBy(sql`date_trunc('day', ${$brief_runs.started_at}) desc`);

    // story-level 指标：平均 importance、validation rate
    const storyTrends = await db
      .select({
        day: sql<string>`date_trunc('day', ${$brief_runs.started_at})::date::text`,
        avg_importance: sql<number>`avg(${$brief_stories.importance})::real`,
        total_stories: sql<number>`count(${$brief_stories.id})::int`,
      })
      .from($brief_stories)
      .innerJoin($brief_runs, eq($brief_stories.workflow_id, $brief_runs.workflow_id))
      .where(gte($brief_runs.started_at, since))
      .groupBy(sql`date_trunc('day', ${$brief_runs.started_at})`)
      .orderBy(sql`date_trunc('day', ${$brief_runs.started_at}) desc`);

    return c.json({
      success: true,
      days,
      runTrends,
      storyTrends,
    });
  } catch (error) {
    console.error('/observability/trends 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 健康度一眼可见：当日运行状态 + 文章数 + 最后成功 brief 时间
 */
app.get('/health/summary', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [runStats, lastBrief, articleStats, recentRuns] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'COMPLETED')::int`,
          failed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'FAILED')::int`,
          terminated: sql<number>`count(*) filter (where ${$brief_runs.status} = 'TERMINATED_NO_STORIES')::int`,
          running: sql<number>`count(*) filter (where ${$brief_runs.status} = 'RUNNING')::int`,
        })
        .from($brief_runs)
        .where(gte($brief_runs.started_at, last24h)),
      db
        .select({
          id: $reports.id,
          title: $reports.title,
          createdAt: $reports.createdAt,
        })
        .from($reports)
        .orderBy(desc($reports.createdAt))
        .limit(1),
      db
        .select({
          status: $articles.status,
          count: sql<number>`count(*)::int`,
        })
        .from($articles)
        .where(gte($articles.createdAt, last24h))
        .groupBy($articles.status),
      db
        .select({
          workflow_id: $brief_runs.workflow_id,
          status: $brief_runs.status,
          started_at: $brief_runs.started_at,
          finished_at: $brief_runs.finished_at,
          stories_identified: $brief_runs.stories_identified,
          error: $brief_runs.error,
        })
        .from($brief_runs)
        .orderBy(desc($brief_runs.started_at))
        .limit(10),
    ]);

    const lastBriefAgeHours = lastBrief[0]?.createdAt
      ? (Date.now() - lastBrief[0].createdAt.getTime()) / 3600000
      : null;

    return c.json({
      success: true,
      generated_at: new Date().toISOString(),
      runs_24h: runStats[0] ?? { total: 0, completed: 0, failed: 0, terminated: 0, running: 0 },
      last_brief: lastBrief[0]
        ? {
            id: lastBrief[0].id,
            title: lastBrief[0].title,
            created_at: lastBrief[0].createdAt,
            age_hours: lastBriefAgeHours != null ? Number(lastBriefAgeHours.toFixed(2)) : null,
          }
        : null,
      articles_24h_by_status: articleStats.reduce<Record<string, number>>((acc, row) => {
        if (row.status) acc[row.status] = row.count;
        return acc;
      }, {}),
      recent_runs: recentRuns.map((r) => ({
        workflow_id: r.workflow_id,
        status: r.status,
        started_at: r.started_at,
        duration_sec:
          r.finished_at && r.started_at
            ? Math.round((r.finished_at.getTime() - r.started_at.getTime()) / 1000)
            : null,
        stories_identified: r.stories_identified,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error('/observability/health/summary 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 列出某次 workflow 全部 LLM 调用（每条 raw input + raw output 存在 R2 llm-calls/{workflow_id}/*.json）
 * 不内联文件内容（可能很大），只返回 key + uploaded + size + 简要 metadata
 */
app.get('/runs/:workflowId/llm-calls', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const list = await c.env.ARTICLES_BUCKET.list({ prefix: `llm-calls/${workflowId}/` });

    // 拉每个对象的简要 metadata（解析 R2 头）。如果想看全文走 /llm-calls/:key
    const calls = await Promise.all(
      list.objects.map(async (obj) => {
        try {
          const o = await c.env.ARTICLES_BUCKET.get(obj.key);
          if (!o) return null;
          const data: any = JSON.parse(await o.text());
          return {
            key: obj.key,
            uploaded: obj.uploaded,
            size: obj.size,
            phase: data.phase,
            call_index: data.call_index,
            provider: data.request?.provider,
            model: data.request?.model,
            tokens: data.response?.usage,
            latency_ms: data.latency_ms,
            error: data.error || null,
          };
        } catch {
          return { key: obj.key, uploaded: obj.uploaded, size: obj.size, error: 'parse_failed' };
        }
      })
    );

    return c.json({ success: true, total: list.objects.length, calls: calls.filter(Boolean) });
  } catch (error) {
    console.error('/observability/runs/:workflowId/llm-calls 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 拿单条 LLM 调用的完整 raw input/output JSON（直接从 R2 流式返回）
 */
app.get('/llm-calls/*', async (c) => {
  try {
    const fullPath = c.req.path; // 形如 /observability/llm-calls/llm-calls/xxx/yyy.json
    const idx = fullPath.indexOf('/llm-calls/') + '/llm-calls/'.length;
    const key = decodeURIComponent(fullPath.slice(idx));
    if (!key.startsWith('llm-calls/')) {
      return c.json({ success: false, error: 'invalid key' }, 400);
    }
    const obj = await c.env.ARTICLES_BUCKET.get(key);
    if (!obj) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    return new Response(obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('/observability/llm-calls/* 失败:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
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