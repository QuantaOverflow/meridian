import { Hono } from 'hono';
import { getDb } from '../lib/utils';
import { $sources, $articles, $reports, eq, and, or, desc, isNotNull, gte, sql, inArray } from '@meridian/database';
import { AutoBriefGenerationWorkflow, type BriefGenerationParams } from '../workflows/auto-brief-generation';
import { createAIServices } from '../lib/ai-services';
import { handleServiceResponse } from '../lib/clustering-service';
import { startProcessArticleWorkflow } from '../workflows/processArticles.workflow';
import { 
  createSuccessResponse, 
  createErrorResponse, 
  handleDatabaseError,
  processPaginationParams,
  checkResourceExists,
  validateDateRange
} from '../lib/api-utils';
import { Logger } from '../lib/logger';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();
const logger = new Logger({ router: 'admin' });

// ========== RSS源管理 ==========
app.get('/sources', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const sources = await db.select().from($sources).orderBy($sources.id);
    
    return c.json(createSuccessResponse(sources, `获取了${sources.length}个RSS源`));
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Get sources', 
      logger.child({ operation: 'get-sources' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

app.post('/sources', async (c) => {
  try {
    const { name, url, category, scrape_frequency } = await c.req.json();
    
    if (!name || !url) {
      return c.json(createErrorResponse('缺少必需的字段: name, url'), 400 as any);
    }

    const db = getDb(c.env.HYPERDRIVE);
    const routeLogger = logger.child({ operation: 'create-source', url });

    // 检查URL是否已存在
    const { exists } = await checkResourceExists(
      () => db.query.$sources.findFirst({ where: eq($sources.url, url) }),
      'Source with URL',
      routeLogger
    );

    if (exists) {
      return c.json(createErrorResponse('该URL已存在'), 409 as any);
    }

    const newSource = await db.insert($sources).values({
      name,
      url,
      category: category || null,
      scrape_frequency: scrape_frequency || 60,
    }).returning();

    routeLogger.info('RSS源创建成功');
    return c.json(createSuccessResponse(newSource[0], 'RSS源添加成功'), 201 as any);
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Create source', 
      logger.child({ operation: 'create-source' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

app.put('/sources/:id', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const { name, url, category, scrape_frequency } = await c.req.json();
    
    const db = getDb(c.env.HYPERDRIVE);
    const routeLogger = logger.child({ operation: 'update-source', source_id: sourceId });

    const updated = await db.update($sources)
      .set({
        name: name || undefined,
        url: url || undefined, 
        category: category !== undefined ? category : undefined,
        scrape_frequency: scrape_frequency || undefined,
      })
      .where(eq($sources.id, sourceId))
      .returning();

    if (updated.length === 0) {
      return c.json(createErrorResponse('未找到指定的RSS源'), 404 as any);
    }

    routeLogger.info('RSS源更新成功');
    return c.json(createSuccessResponse(updated[0], 'RSS源更新成功'));
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Update source', 
      logger.child({ operation: 'update-source' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

app.delete('/sources/:id', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const db = getDb(c.env.HYPERDRIVE);
    const routeLogger = logger.child({ operation: 'delete-source', source_id: sourceId });
    
    const deleted = await db.delete($sources)
      .where(eq($sources.id, sourceId))
      .returning();

    if (deleted.length === 0) {
      return c.json(createErrorResponse('未找到指定的RSS源'), 404 as any);
    }

    routeLogger.info('RSS源删除成功');
    return c.json(createSuccessResponse(deleted[0], 'RSS源删除成功'));
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Delete source', 
      logger.child({ operation: 'delete-source' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 文章管理 ==========
app.get('/articles', async (c) => {
  try {
    const { page, limit, offset } = processPaginationParams(c);
    const status = c.req.query('status');

    const db = getDb(c.env.HYPERDRIVE);
    
    const conditions = [];
    if (status) {
      conditions.push(eq($articles.status, status as any));
    }

    const articles = await db.select({
      id: $articles.id,
      title: $articles.title,
      url: $articles.url,
      status: $articles.status,
      publishDate: $articles.publishDate,
      processedAt: $articles.processedAt,
      sourceId: $articles.sourceId,
      contentFileKey: $articles.contentFileKey,
      embedding: $articles.embedding,
    })
    .from($articles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc($articles.createdAt))
    .limit(limit)
    .offset(offset);

    return c.json(createSuccessResponse(
      articles, 
      `获取了${articles.length}篇文章`,
      { page, limit, total: articles.length }
    ));
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Get articles', 
      logger.child({ operation: 'get-articles' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 简报管理 ==========
app.post('/briefs/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})); // 支持空请求体
    const { 
      // 文章选择参数
      article_ids,
      dateFrom, 
      dateTo, 
      timeRangeDays = 1, // 默认最近1天内的文章
      articleLimit = 100, // 默认限制100篇文章
      
      // 业务参数
      minImportance = 3, // 降低默认重要性阈值，增加故事识别率
      maxStoriesToGenerate = 15,
      storyMinImportance = 0.1,
      
      // 高级参数（可选）
      clusteringOptions,
      
      // 元数据
      triggeredBy = 'admin'
    } = body;

    const routeLogger = logger.child({ operation: 'generate-brief' });

    // 验证日期范围（如果提供）
    let parsedDateFrom, parsedDateTo;
    if (dateFrom || dateTo) {
      const dateRange = validateDateRange(dateFrom, dateTo);
      parsedDateFrom = dateRange.from;
      parsedDateTo = dateRange.to;
    }

    // 构建完整的工作流参数
    const workflowParams = {
      // 文章数据源
      article_ids: Array.isArray(article_ids) ? article_ids : undefined,
      dateFrom: parsedDateFrom?.toISOString(),
      dateTo: parsedDateTo?.toISOString(), 
      timeRangeDays, // 如果未指定日期范围，使用时间范围
      articleLimit,
      
      // 业务控制参数
      minImportance,
      maxStoriesToGenerate,
      storyMinImportance,
      
      // 聚类参数（如果提供）
      clusteringOptions: clusteringOptions || {
        umapParams: {
          n_neighbors: 15,
          n_components: 5,
          min_dist: 0.1,
          metric: 'cosine'
        },
        hdbscanParams: {
          min_cluster_size: 3,
          min_samples: 1,
          epsilon: 0.5
        }
      },
      
      // 元数据
      triggeredBy
    };

    routeLogger.info('开始生成简报', { 
      dateFrom: parsedDateFrom?.toISOString(), 
      dateTo: parsedDateTo?.toISOString(),
      timeRangeDays: parsedDateFrom || parsedDateTo ? undefined : timeRangeDays,
      articleLimit,
      minImportance,
      article_ids_provided: Array.isArray(article_ids) ? article_ids.length : 0
    });

    // 创建并启动简报生成工作流
    const workflowInstance = await c.env.MY_WORKFLOW.create({
      id: `admin-brief-${Date.now()}`,
      params: workflowParams
    });

    routeLogger.info('简报生成工作流已启动', { 
      workflow_id: workflowInstance.id,
      expectedDataRange: parsedDateFrom || parsedDateTo 
        ? `${parsedDateFrom?.toISOString()} - ${parsedDateTo?.toISOString()}`
        : `最近${timeRangeDays}天内的文章`
    });
    
    return c.json(createSuccessResponse(
      { 
        workflowId: workflowInstance.id,
        parameters: {
          dataRange: parsedDateFrom || parsedDateTo 
            ? `从 ${parsedDateFrom?.toLocaleDateString()} 到 ${parsedDateTo?.toLocaleDateString()}`
            : `最近${timeRangeDays}天内的文章`,
          articleLimit,
          expectedStories: `最多${maxStoriesToGenerate}个故事`,
          minImportance
        },
        statusUrl: `/admin/briefs/workflow/${workflowInstance.id}/status`
      },
      '简报生成工作流已启动，预计需要1-2分钟完成。如果未发现有效故事，工作流将提前终止并提供分析报告。'
    ), 202 as any);
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Generate brief', 
      logger.child({ operation: 'generate-brief' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 简报工作流状态查询 ==========
app.get('/briefs/workflow/:workflowId/status', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const routeLogger = logger.child({ operation: 'get-workflow-status', workflowId });

    routeLogger.info('查询工作流状态', { workflowId });

    // 尝试从可观测性数据中获取工作流信息
    const observabilityKey = `observability/${workflowId}.json`;
    
    try {
      // 首先尝试直接查找格式化的文件名
      let observabilityData = await c.env.ARTICLES_BUCKET.get(observabilityKey);
      
      // 如果没有找到，尝试查找以工作流ID为前缀的文件
      if (!observabilityData) {
        // 列出所有观测性文件，查找匹配的工作流ID
        const listResponse = await c.env.ARTICLES_BUCKET.list({
          prefix: `observability/workflow_${workflowId}_`
        });
        
        if (listResponse.objects && listResponse.objects.length > 0) {
          // 选择最新的文件
          const latestFile = listResponse.objects.sort((a, b) => 
            b.uploaded.getTime() - a.uploaded.getTime()
          )[0];
          
          observabilityData = await c.env.ARTICLES_BUCKET.get(latestFile.key);
          if (observabilityData) {
            routeLogger.info('找到可观测性数据文件', { file_key: latestFile.key });
          }
        }
      }
      
      if (observabilityData) {
        const data = JSON.parse(await observabilityData.text());
        
        // 检查是否有工作流终止的记录
        const terminatedStep = data.detailedMetrics?.find((m: any) => m.stepName === 'workflow_terminated');
        
        if (terminatedStep && terminatedStep.data?.reason === 'INSUFFICIENT_QUALITY_STORIES') {
          return c.json({
            success: true,
            workflowStatus: 'terminated',
            terminationReason: 'NO_VALID_STORIES_FOUND',
            message: '工作流已终止：未发现符合质量标准的故事',
            analysis: terminatedStep.data.analysis,
            recommendations: terminatedStep.data.recommendations,
            timestamp: terminatedStep.data.timestamp,
            observabilityData: data
          });
        }

        // 检查是否正常完成
        const completedStep = data.detailedMetrics?.find((m: any) => m.stepName === 'workflow_complete');
        if (completedStep) {
          return c.json({
            success: true,
            workflowStatus: 'completed',
            result: completedStep.data,
            observabilityData: data
          });
        }

        // 工作流仍在进行中
        return c.json({
          success: true,
          workflowStatus: 'running',
          progress: data.summary,
          observabilityData: data
        });
      }
    } catch (observabilityError) {
      console.warn('无法获取可观测性数据:', observabilityError);
    }

    // 如果没有可观测性数据，返回基本信息
    return c.json({
      success: true,
      workflowStatus: 'unknown',
      message: '工作流状态未知，可能仍在运行中。请检查终端日志或稍后重试。',
      workflowId,
      suggestion: '使用 /observability/workflows 端点查看所有工作流历史'
    });

  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Get workflow status', 
      logger.child({ operation: 'get-workflow-status' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 系统概览 ==========
app.get('/overview', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const routeLogger = logger.child({ operation: 'get-overview' });

    // 分别获取统计数据，使用更兼容的方式
    
    // 源统计
    const allSources = await db.select({
      id: $sources.id,
      lastChecked: $sources.lastChecked
    }).from($sources);
    
    const sourceStats = {
      total: allSources.length,
      active: allSources.filter(s => s.lastChecked !== null).length
    };

    // 文章统计
    const allArticles = await db.select({
      id: $articles.id,
      status: $articles.status
    }).from($articles);
    
    const articleStats = {
      total: allArticles.length,
      processed: allArticles.filter(a => a.status === 'PROCESSED').length,
      pending: allArticles.filter(a => a.status === 'PENDING_FETCH').length,
      failed: allArticles.filter(a => a.status && a.status.endsWith('_FAILED')).length
    };

    // 简报统计（最近30天）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentBriefs = await db.select({
      id: $reports.id
    }).from($reports).where(gte($reports.createdAt, thirtyDaysAgo));

    const overview = {
      sources: sourceStats,
      articles: articleStats,
      briefs: {
        last30Days: recentBriefs.length
      },
      lastUpdated: new Date().toISOString()
    };

    routeLogger.info('系统概览获取成功');
    return c.json(createSuccessResponse(overview, '系统概览获取成功'));
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Get overview', 
      logger.child({ operation: 'get-overview' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 工作流手动触发 ==========
app.post('/articles/process', async (c) => {
  try {
    const { article_ids } = await c.req.json();
    const routeLogger = logger.child({ operation: 'manual-process-articles' });

    if (!Array.isArray(article_ids) || article_ids.length === 0) {
      return c.json(createErrorResponse('缺少或无效的article_ids数组'), 400 as any);
    }

    routeLogger.info('手动触发文章处理工作流', { article_count: article_ids.length });

    // 触发ProcessArticles工作流
    const workflowResult = await startProcessArticleWorkflow(c.env, { articles_id: article_ids });
    
    if (!workflowResult.success) {
      routeLogger.error('工作流启动失败', { error: workflowResult.error });
      return c.json(createErrorResponse(`工作流启动失败: ${workflowResult.error}`), 500 as any);
    }

    routeLogger.info('文章处理工作流已启动', { workflow_id: workflowResult.data?.id });
    
    return c.json(createSuccessResponse(
      { 
        workflowId: workflowResult.data?.id,
        articleCount: article_ids.length
      },
      '文章处理工作流已启动'
    ), 202 as any);
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Manual process articles', 
      logger.child({ operation: 'manual-process-articles' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 重试失败文章 ==========
app.post('/articles/retry-failed', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { 
      article_ids, 
      status_filters, 
      auto_clear_reasons = true,
      max_articles = 100 
    } = body;
    
    const routeLogger = logger.child({ operation: 'retry-failed-articles' });
    const db = getDb(c.env.HYPERDRIVE);

    let conditions = [];
    
    // 如果指定了文章ID，优先使用
    if (Array.isArray(article_ids) && article_ids.length > 0) {
      conditions.push(inArray($articles.id, article_ids));
      routeLogger.info('重试指定的失败文章', { article_count: article_ids.length });
    } else {
      // 否则按状态筛选失败的文章
      const defaultFailedStatuses = [
        'FETCH_FAILED',
        'RENDER_FAILED', 
        'AI_ANALYSIS_FAILED',
        'EMBEDDING_FAILED',
        'R2_UPLOAD_FAILED'
      ];
      
      const statusesToRetry = Array.isArray(status_filters) && status_filters.length > 0 
        ? status_filters 
        : defaultFailedStatuses;
        
      // 查找失败的文章
      const statusConditions = statusesToRetry.map(status => eq($articles.status, status as any));
      conditions.push(or(...statusConditions));
      
      routeLogger.info('重试失败状态的文章', { 
        status_filters: statusesToRetry,
        max_articles
      });
    }

    // 查询失败的文章
    const failedArticles = await db.select({
      id: $articles.id,
      title: $articles.title,
      status: $articles.status,
      failReason: $articles.failReason,
      publishDate: $articles.publishDate
    })
    .from($articles)
    .where(and(...conditions))
    .orderBy(desc($articles.publishDate))
    .limit(max_articles);

    if (failedArticles.length === 0) {
      return c.json(createSuccessResponse(
        { articlesFound: 0, clearedReasons: 0, workflowTriggered: false },
        '未找到符合条件的失败文章'
      ));
    }

         routeLogger.info('找到失败文章', { 
       article_count: failedArticles.length,
       status_breakdown: failedArticles.reduce((acc, article) => {
         const status = article.status || 'UNKNOWN';
         acc[status] = (acc[status] || 0) + 1;
         return acc;
       }, {} as Record<string, number>)
     });

    const articleIdsToRetry = failedArticles.map(a => a.id);
    let clearedCount = 0;

    // 清除失败原因，重置状态
    if (auto_clear_reasons) {
      const updateResult = await db.update($articles)
        .set({
          failReason: null,
          status: 'PENDING_FETCH',
          processedAt: null
        })
        .where(inArray($articles.id, articleIdsToRetry))
        .returning({ id: $articles.id });
      
      clearedCount = updateResult.length;
      routeLogger.info('清除失败原因完成', { cleared_count: clearedCount });
    }

    // 触发重新处理工作流
    const workflowResult = await startProcessArticleWorkflow(c.env, { 
      articles_id: articleIdsToRetry 
    });
    
    if (!workflowResult.success) {
      routeLogger.error('重试工作流启动失败', { error: workflowResult.error });
      return c.json(createErrorResponse(`重试工作流启动失败: ${workflowResult.error}`), 500 as any);
    }

    routeLogger.info('重试工作流已启动', { 
      workflow_id: workflowResult.data?.id,
      article_count: articleIdsToRetry.length 
    });
    
    return c.json(createSuccessResponse(
      { 
        workflowId: workflowResult.data?.id,
        articlesFound: failedArticles.length,
        clearedReasons: clearedCount,
        articleIds: articleIdsToRetry,
                 failedStatusBreakdown: failedArticles.reduce((acc, article) => {
           const status = article.status || 'UNKNOWN';
           acc[status] = (acc[status] || 0) + 1;
           return acc;
         }, {} as Record<string, number>)
      },
      `已启动重试工作流，将处理${articleIdsToRetry.length}篇失败文章`
    ), 202 as any);
    
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Retry failed articles', 
      logger.child({ operation: 'retry-failed-articles' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

// ========== 查询失败文章统计 ==========
app.get('/articles/failed-stats', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const routeLogger = logger.child({ operation: 'get-failed-stats' });

    // 查询各种失败状态的统计 - 包括failReason为null的失败文章
    const failedArticles = await db.select({
      id: $articles.id,
      status: $articles.status,
      failReason: $articles.failReason,
      publishDate: $articles.publishDate,
      processedAt: $articles.processedAt
    })
    .from($articles)
    .where(
      or(
        eq($articles.status, 'FETCH_FAILED'),
        eq($articles.status, 'RENDER_FAILED'),
        eq($articles.status, 'AI_ANALYSIS_FAILED'),
        eq($articles.status, 'EMBEDDING_FAILED'),
        eq($articles.status, 'R2_UPLOAD_FAILED')
      )
    )
    .orderBy(desc($articles.publishDate));

         // 按状态分组统计
     const statusStats = failedArticles.reduce((acc, article) => {
       const status = article.status || 'UNKNOWN';
       if (!acc[status]) {
         acc[status] = {
           count: 0,
           articles: []
         };
       }
       acc[status].count++;
       acc[status].articles.push({
         id: article.id,
         publishDate: article.publishDate,
         failReason: article.failReason ? article.failReason.substring(0, 100) + '...' : 'No reason'
       });
       return acc;
     }, {} as Record<string, { count: number; articles: any[] }>);

         // 按失败原因分组统计
     const reasonStats = failedArticles.reduce((acc, article) => {
       const reason = article.failReason ? article.failReason.split(':')[0] : 'Unknown';
       acc[reason] = (acc[reason] || 0) + 1;
       return acc;
     }, {} as Record<string, number>);

    // 时间分布统计
    const now = new Date();
    const timeRanges = {
      last_24h: failedArticles.filter(a => a.publishDate && 
        (now.getTime() - a.publishDate.getTime()) < 24 * 60 * 60 * 1000).length,
      last_week: failedArticles.filter(a => a.publishDate && 
        (now.getTime() - a.publishDate.getTime()) < 7 * 24 * 60 * 60 * 1000).length,
      last_month: failedArticles.filter(a => a.publishDate && 
        (now.getTime() - a.publishDate.getTime()) < 30 * 24 * 60 * 60 * 1000).length
    };

    const stats = {
      total: failedArticles.length,
      byStatus: statusStats,
      byFailureReason: reasonStats,
      timeDistribution: timeRanges,
      retryable: failedArticles.filter(a =>
        a.status && ['FETCH_FAILED', 'RENDER_FAILED', 'AI_ANALYSIS_FAILED', 'EMBEDDING_FAILED', 'R2_UPLOAD_FAILED']
        .includes(a.status)
      ).length
    };

    routeLogger.info('失败文章统计生成完成', { 
      total_failed: stats.total,
      retryable: stats.retryable 
    });
    
    return c.json(createSuccessResponse(stats, '失败文章统计获取成功'));
    
  } catch (error) {
    const { error: errorMsg, statusCode } = handleDatabaseError(
      error, 
      'Get failed stats', 
      logger.child({ operation: 'get-failed-stats' })
    );
    return c.json(createErrorResponse(errorMsg), statusCode as any);
  }
});

export default app;