import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../lib/database';
import { $sources, $articles, $reports, eq, and, desc, isNotNull, gte, sql, inArray } from '@meridian/database';
import { AutoBriefGenerationWorkflow, type BriefGenerationParams } from '../workflows/auto-brief-generation';
import { createAIServices } from '../lib/services/ai-services';
import { handleServiceResponse } from '../lib/services/clustering';
import { startProcessArticleWorkflow } from '../workflows/processArticles.workflow';
import { 
  createSuccessResponse, 
  createErrorResponse, 
  handleDatabaseError,
  processPaginationParams,
  checkResourceExists,
  validateDateRange
} from '../lib/api/utils';
import { Logger } from '../lib/core/logger';
import { BRIEF_CLUSTERING_OPTIONS } from '../lib/core/constants';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();
const logger = new Logger({ router: 'admin' });

// ===== 入参校验 schema =====
// 与其余 backend 路由(sources/reports/...)一致,用 zValidator 在边界挡畸形输入,
// 避免畸形 payload 潜入下游变成隐晦崩溃。可选字段保持 optional,默认值仍由各 handler 兜底。
const sourceCreateSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  category: z.string().min(1), // DB 列为 notNull,必填(原 `category || null` 是潜在 bug,会向 notNull 列插 null)
  scrape_frequency: z.number().int().positive().optional(),
});
const sourceUpdateSchema = sourceCreateSchema.partial();
const idParamSchema = z.object({ id: z.coerce.number().int() });
const articlesQuerySchema = z.object({ status: z.string().optional() });
const briefGenerateSchema = z.object({
  article_ids: z.array(z.number().int()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  timeRangeDays: z.number().optional(),
  articleLimit: z.number().int().positive().optional(),
  minImportance: z.number().optional(),
  maxStoriesToGenerate: z.number().int().positive().optional(),
  storyMinImportance: z.number().optional(),
  clusteringOptions: z.any().optional(),
  triggeredBy: z.string().optional(),
});
const byIdsSchema = z.object({ ids: z.array(z.number().int()).optional() });
const processArticlesSchema = z.object({ article_ids: z.array(z.number().int()).min(1) });

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

app.post('/sources', zValidator('json', sourceCreateSchema), async (c) => {
  try {
    const { name, url, category, scrape_frequency } = c.req.valid('json');

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
      category,
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

app.put('/sources/:id', zValidator('param', idParamSchema), zValidator('json', sourceUpdateSchema), async (c) => {
  try {
    const sourceId = c.req.valid('param').id;
    const { name, url, category, scrape_frequency } = c.req.valid('json');

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

app.delete('/sources/:id', zValidator('param', idParamSchema), async (c) => {
  try {
    const sourceId = c.req.valid('param').id;
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
app.get('/articles', zValidator('query', articlesQuerySchema), async (c) => {
  try {
    const { page, limit, offset } = processPaginationParams(c);
    const status = c.req.valid('query').status;

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
app.post('/briefs/generate', zValidator('json', briefGenerateSchema), async (c) => {
  try {
    const body = c.req.valid('json'); // 空请求体也需为合法 JSON(至少 {});字段类型由 zValidator 校验
    const {
      // 文章选择参数
      article_ids,
      dateFrom, 
      dateTo, 
      timeRangeDays = 1, // 默认最近1天内的文章
      articleLimit = 500, // 默认500篇（embeddings 已卸载 R2，不再受 1MB step 输出限制）
      
      // 业务参数
      minImportance = 3, // 降低默认重要性阈值，增加故事识别率
      maxStoriesToGenerate = 25,
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
      clusteringOptions: clusteringOptions || BRIEF_CLUSTERING_OPTIONS,
      
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

// ========== 文章按 ID 批量查询（用于 eval 等下游工具） ==========
app.post('/articles/by-ids', zValidator('json', byIdsSchema), async (c) => {
  try {
    const ids = c.req.valid('json').ids ?? [];
    if (ids.length === 0) {
      return c.json({ success: true, articles: [] });
    }
    const db = getDb(c.env.HYPERDRIVE);
    const rows = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        url: $articles.url,
        sourceId: $articles.sourceId,
        event_summary_points: $articles.event_summary_points,
      })
      .from($articles)
      .where(inArray($articles.id, ids));
    return c.json({ success: true, articles: rows });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'unknown' }, 500);
  }
});

// ========== 工作流手动触发 ==========
app.post('/articles/process', zValidator('json', processArticlesSchema), async (c) => {
  try {
    const { article_ids } = c.req.valid('json');
    const routeLogger = logger.child({ operation: 'manual-process-articles' });

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

export default app;