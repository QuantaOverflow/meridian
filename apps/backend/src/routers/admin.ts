import { Hono } from 'hono';
import { getDb } from '../lib/utils';
import { $sources, $articles, $reports, eq, and, desc, isNotNull, gte, sql } from '@meridian/database';
import { AutoBriefGenerationWorkflow, type BriefGenerationParams } from '../workflows/auto-brief-generation';
import { createAIServices } from '../lib/ai-services';
import { handleServiceResponse } from '../lib/clustering-service';
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
        }
      },
      '简报生成工作流已启动，预计需要1-2分钟完成'
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

export default app;