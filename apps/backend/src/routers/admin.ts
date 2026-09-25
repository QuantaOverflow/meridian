import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createSource, updateSource } from '../lib/sources';
import { getSourceDetails, getSourcesOverview } from '../lib/reader/source-stats';
import { getDb } from '../lib/database';
import { startProcessArticleWorkflow } from '../workflows/processArticles.workflow';
import { 
  createSuccessResponse, 
  createErrorResponse, 
  handleDatabaseError,
  validateDateRange
} from '../lib/api/utils';
import { Logger } from '../lib/core/logger';
import { BRIEF_CLUSTERING_OPTIONS } from '../lib/core/constants';
import type { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();
const logger = new Logger({ router: 'admin' });

// ===== 入参校验 schema =====
// 与其余 backend 路由(do/events/...)一致,用 zValidator 在边界挡畸形输入,
// 避免畸形 payload 潜入下游变成隐晦崩溃。可选字段保持 optional,默认值仍由各 handler 兜底。
// name / category 缺省由 lib/sources.ts 兜底（'Unknown' / 'news'）：后台前端只传 url
const sourceCreateSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().min(1),
  category: z.string().min(1).optional(),
  // 抓取档位 1-4（sourceScraperDO 的 tierIntervals）；超出范围 DO 会回落到 2，库里却留着非法值
  scrape_frequency: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
});
const sourceUpdateSchema = sourceCreateSchema.partial();
const idParamSchema = z.object({ id: z.coerce.number().int() });
const briefGenerateSchema = z.object({
  article_ids: z.array(z.number().int()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  timeRangeDays: z.number().optional(),
  articleLimit: z.number().int().positive().optional(),
  maxStoriesToGenerate: z.number().int().positive().optional(),
  clusteringOptions: z.any().optional(),
  triggeredBy: z.string().optional(),
});
const processArticlesSchema = z.object({ article_ids: z.array(z.number().int()).min(1) });

// ========== RSS源管理 ==========
// 后台源页面的读数（总览、单个源的文章列表）在 lib/reader/source-stats.ts，前端只转发
app.get('/sources', async (c) => {
  return c.json(await getSourcesOverview(getDb(c.env.HYPERDRIVE)));
});

app.get('/sources/:id/details', zValidator('param', idParamSchema), async (c) => {
  const details = await getSourceDetails(getDb(c.env.HYPERDRIVE), c.req.valid('param').id, c.req.query());
  if (details === null) return c.json({ error: 'Source not found' }, 404);
  return c.json(details);
});

// 写表与 DO 启停都在 lib/sources.ts：建源即拉起 DO，改 url / 档位时 DO 跟着变
app.post('/sources', zValidator('json', sourceCreateSchema), async (c) => {
  const result = await createSource(c.env, c.req.valid('json'));
  if (!result.ok) return c.json(createErrorResponse(result.error), result.status);
  return c.json(createSuccessResponse(result.value, 'RSS源添加成功'), 201);
});

app.put('/sources/:id', zValidator('param', idParamSchema), zValidator('json', sourceUpdateSchema), async (c) => {
  const result = await updateSource(c.env, c.req.valid('param').id, c.req.valid('json'));
  if (!result.ok) {
    return c.json(createErrorResponse(result.status === 404 ? '未找到指定的RSS源' : result.error), result.status);
  }
  return c.json(createSuccessResponse(result.value, 'RSS源更新成功'));
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
      maxStoriesToGenerate = 25,
      
      // 高级参数（可选）
      clusteringOptions,

      // 元数据
      triggeredBy = 'admin'
    } = body;

    const routeLogger = logger.child({ operation: 'generate-brief' });

    // 验证日期范围（如果提供）
    let parsedDateFrom, parsedDateTo;
    if (dateFrom || dateTo) {
      // 参数错是调用方的错，回 400；不接住的话落到下面的 catch 被当成 500 Internal server error
      try {
        const dateRange = validateDateRange(dateFrom, dateTo);
        parsedDateFrom = dateRange.from;
        parsedDateTo = dateRange.to;
      } catch (e) {
        return c.json(createErrorResponse(e instanceof Error ? e.message : String(e)), 400);
      }
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
      maxStoriesToGenerate,

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
          expectedStories: `最多${maxStoriesToGenerate}个故事`
        }
      },
      '简报生成工作流已启动，预计需要10-15分钟完成。如果未发现有效故事，工作流将提前终止并提供分析报告。'
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