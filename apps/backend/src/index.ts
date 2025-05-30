import { Hono } from 'hono';
import importedApp from './app';
import { SourceScraperDO } from './durable_objects/sourceScraperDO';
import { startProcessArticleWorkflow } from './workflows/processArticles.workflow';
import { Logger } from './lib/logger';
import { Ai } from '@cloudflare/ai';
import { getDb } from './lib/utils';
import { $sources, $articles, sql, inArray, and, gte } from '@meridian/database';

import dotenv from 'dotenv';
dotenv.config();

type ArticleQueueMessage = { articles_id: number[] };

export type Env = {
  // Bindings
  ARTICLES_BUCKET: R2Bucket;
  ARTICLE_PROCESSING_QUEUE: Queue<ArticleQueueMessage>;
  SOURCE_SCRAPER: DurableObjectNamespace<SourceScraperDO>;
  PROCESS_ARTICLES: Workflow;
  HYPERDRIVE: Hyperdrive;
  AI: Ai;
  
  // AI Worker Service Binding - connects to meridian-ai-worker
  AI_WORKER: {
    fetch(request: Request): Promise<Response>
  };
  
  // Secrets
  API_TOKEN: string;

  AXIOM_DATASET: string | undefined; // optional, use if you want to send logs to axiom
  AXIOM_TOKEN: string | undefined; // optional, use if you want to send logs to axiom

  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;

  DATABASE_URL: string;

  GEMINI_API_KEY: string;
  GEMINI_BASE_URL: string;

  MERIDIAN_ML_SERVICE_URL: string;
  MERIDIAN_ML_SERVICE_API_KEY: string;
};


// Create a base logger for the queue handler
const queueLogger = new Logger({ service: 'article-queue-handler' });

const app = importedApp || new Hono<{ Bindings: Env }>();

// 添加测试钩子中间件 (放在其他路由之前)
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const testMode = url.searchParams.get('_test');

  // 如果启用了测试模式
  if (testMode) {
    console.log('触发测试模式:', testMode);
    
    try {
      // 创建标准 Request 对象
      const standardRequest = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.header(),
        body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.blob() : undefined
      });
      
      switch (testMode) {
        case 'gemini':
          // 导入并执行 Gemini 测试
          const { testGemini } = await import('./tests/api/gemini_test');
          return await testGemini(standardRequest, c.env);
          
        case 'cfai': 
          // 复用现有的 Cloudflare AI 测试
          const { handleRequest } = await import('./tests/api/cfai_test');
          return await handleRequest(standardRequest, c.env);
          
        default:
          // 未知测试模式
          return c.json({
            error: '未知测试模式',
            available: ['gemini', 'cfai']
          }, 400);
      }
    } catch (error) {
      // 测试执行错误
      return c.json({
        error: '测试执行失败',
        message: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  }
  
  // 非测试模式，继续正常处理
  return next();
});

// 添加 Service Binding 测试路由
app.get('/test-ai-worker', async (c) => {
  try {
    // 测试 AI_WORKER service binding 通过 fetch 方法
    const healthRequest = new Request('https://meridian-ai-worker/health', {
      method: 'GET'
    });
    const healthResponse = await c.env.AI_WORKER.fetch(healthRequest);
    const healthData = await healthResponse.json();
    
    const analysisRequest = new Request('https://meridian-ai-worker/meridian/article/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: "Service Binding Test",
        content: "Testing the connection between Backend Worker and AI Worker via Service Binding.",
        options: {
          provider: "google-ai-studio",
          model: "gemini-1.5-flash-8b-001"
        }
      })
    });
    const analysisResponse = await c.env.AI_WORKER.fetch(analysisRequest);
    const analysisData = await analysisResponse.json();

    return c.json({
      success: true,
      message: "AI_WORKER Service Binding is working via fetch!",
      healthCheck: healthData,
      analysisTest: analysisData
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// 添加完整工作流测试端点
app.get('/test-complete-workflow', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 1. 首先获取一些已有的RSS源
    const sources = await db.select({
      id: $sources.id,
      url: $sources.url,
      name: $sources.name,
      scrape_frequency: $sources.scrape_frequency
    })
    .from($sources)
    .limit(3); // 测试前3个源
    
    if (sources.length === 0) {
      return c.json({
        success: false,
        error: "没有找到任何RSS源。请先添加一些RSS源。",
        suggestion: "使用 POST /sources 添加RSS源"
      }, 404);
    }
    
    const results = [];
    
    // 2. 对每个源触发立即抓取
    for (const source of sources) {
      try {
        // 获取对应的 Durable Object
        const doId = c.env.SOURCE_SCRAPER.idFromName(source.url);
        const stub = c.env.SOURCE_SCRAPER.get(doId);
        
        // 触发立即抓取（通过调用 trigger 方法）
        const scrapeRequest = new Request('http://internal/trigger', {
          method: 'GET'
        });
        const scrapeResponse = await stub.fetch(scrapeRequest);
        
        results.push({
          source_id: source.id,
          source_name: source.name,
          source_url: source.url,
          scrape_triggered: scrapeResponse.ok,
          scrape_status: scrapeResponse.status,
          scrape_response: scrapeResponse.ok ? 'Success' : await scrapeResponse.text()
        });
        
      } catch (error) {
        results.push({
          source_id: source.id,
          source_name: source.name,
          source_url: source.url,
          scrape_triggered: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // 3. 等待一段时间让抓取完成
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 4. 检查是否有新文章进入处理状态
    const recentArticles = await db.select({
      id: $articles.id,
      title: $articles.title,
      status: $articles.status,
      sourceId: $articles.sourceId,
      createdAt: $articles.createdAt
    })
    .from($articles)
    .where(
      // 查找最近5分钟内创建的文章（使用PostgreSQL语法）
      sql`${$articles.createdAt} > NOW() - INTERVAL '5 minutes'`
    )
    .orderBy(sql`${$articles.createdAt} DESC`)
    .limit(10);
    
    // 5. 如果有新文章，手动触发工作流（用于测试）
    let workflowResult = null;
    if (recentArticles.length > 0) {
      const articleIds = recentArticles.map(a => a.id);
      const workflow = await startProcessArticleWorkflow(c.env, { articles_id: articleIds });
      
      if (workflow.isOk()) {
        workflowResult = {
          workflow_id: workflow.value.id,
          article_count: articleIds.length,
          status: 'triggered'
        };
      } else {
        workflowResult = {
          error: workflow.error.message,
          status: 'failed'
        };
      }
    }
    
    return c.json({
      success: true,
      message: "完整工作流测试完成",
      test_summary: {
        sources_tested: sources.length,
        scrape_results: results,
        recent_articles_found: recentArticles.length,
        workflow_triggered: workflowResult !== null
      },
      details: {
        scrape_results: results,
        recent_articles: recentArticles,
        workflow_result: workflowResult
      }
    });
    
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: "完整工作流测试失败"
    }, 500);
  }
});

// 添加手动触发工作流的端点（用于测试指定文章）
app.post('/test-workflow-manual', async (c) => {
  try {
    const body = await c.req.json();
    const articleIds = body.article_ids;
    
    if (!Array.isArray(articleIds) || articleIds.length === 0) {
      return c.json({
        success: false,
        error: "请提供有效的文章ID数组",
        example: { article_ids: [1, 2, 3] }
      }, 400);
    }
    
    // 触发工作流
    const workflowResult = await startProcessArticleWorkflow(c.env, { articles_id: articleIds });
    
    if (workflowResult.isOk()) {
      return c.json({
        success: true,
        message: "工作流已触发",
        workflow_id: workflowResult.value.id,
        article_count: articleIds.length
      });
    } else {
      return c.json({
        success: false,
        error: workflowResult.error.message,
        message: "工作流触发失败"
      }, 500);
    }
    
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// 添加失败文章重试端点
app.post('/retry-failed-articles', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const body = await c.req.json();
    
    // 可选的过滤参数
    const {
      specific_ids,  // 指定文章ID
      status_filter, // 状态过滤 ['FETCH_FAILED', 'RENDER_FAILED', 'AI_ANALYSIS_FAILED', 'EMBEDDING_FAILED', 'R2_UPLOAD_FAILED']
      hours_since_failed = 24, // 多少小时内失败的文章
      limit = 50 // 限制重试数量
    } = body;

    let query = db.select({
      id: $articles.id,
      title: $articles.title,
      status: $articles.status,
      failReason: $articles.failReason,
      processedAt: $articles.processedAt,
      url: $articles.url
    }).from($articles);

    // 构建查询条件
    let conditions = [];

    // 如果指定了具体ID，优先使用
    if (specific_ids && Array.isArray(specific_ids) && specific_ids.length > 0) {
      conditions.push(inArray($articles.id, specific_ids));
    } else {
      // 否则查找失败的文章
      
      // 状态过滤
      if (status_filter && Array.isArray(status_filter) && status_filter.length > 0) {
        const validStatuses = status_filter.filter(s => 
          ['FETCH_FAILED', 'RENDER_FAILED', 'AI_ANALYSIS_FAILED', 'EMBEDDING_FAILED', 'R2_UPLOAD_FAILED'].includes(s)
        );
        if (validStatuses.length > 0) {
          conditions.push(inArray($articles.status, validStatuses));
        }
      } else {
        // 默认查找所有失败状态
        conditions.push(inArray($articles.status, [
          'FETCH_FAILED', 
          'RENDER_FAILED', 
          'AI_ANALYSIS_FAILED', 
          'EMBEDDING_FAILED', 
          'R2_UPLOAD_FAILED'
        ]));
      }

      // 时间过滤 - 在指定小时数内失败的
      const hoursAgo = new Date(Date.now() - hours_since_failed * 60 * 60 * 1000);
      conditions.push(gte($articles.processedAt, hoursAgo));
    }

    // 应用所有条件
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // 限制数量
    query = query.limit(limit);

    const failedArticles = await query;

    if (failedArticles.length === 0) {
      return c.json({
        success: true,
        message: "没有找到符合条件的失败文章",
        articles_found: 0,
        criteria: {
          specific_ids: specific_ids || null,
          status_filter: status_filter || "所有失败状态",
          hours_since_failed,
          limit
        }
      });
    }

    // 重置失败文章的状态，使其可以重新处理
    const articleIds = failedArticles.map(a => a.id);
    
    await db
      .update($articles)
      .set({
        status: 'PENDING_FETCH',
        processedAt: null,
        failReason: null,
        // 清除可能的分析数据，让重新处理
        language: null,
        primary_location: null,
        completeness: null,
        content_quality: null,
        event_summary_points: null,
        thematic_keywords: null,
        topic_tags: null,
        key_entities: null,
        content_focus: null,
        embedding: null,
        contentFileKey: null
      })
      .where(inArray($articles.id, articleIds));

    // 触发工作流重新处理
    const workflowResult = await startProcessArticleWorkflow(c.env, { articles_id: articleIds });

    if (workflowResult.isOk()) {
      return c.json({
        success: true,
        message: "失败文章重试已触发",
        workflow_id: workflowResult.value.id,
        articles_reset: failedArticles.length,
        articles: failedArticles.map(a => ({
          id: a.id,
          title: a.title,
          previous_status: a.status,
          previous_fail_reason: a.failReason,
          url: a.url
        }))
      });
    } else {
      return c.json({
        success: false,
        error: workflowResult.error.message,
        message: "工作流触发失败，但文章状态已重置",
        articles_reset: failedArticles.length
      }, 500);
    }
    
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: "重试失败文章操作失败"
    }, 500);
  }
});

// 添加查询失败文章状态的端点
app.get('/failed-articles-status', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    
    // 查询各种失败状态的统计
    const failedStats = await db.select({
      status: $articles.status,
      count: sql<number>`count(*)`,
      latest_failure: sql<Date>`max(processed_at)`
    })
    .from($articles)
    .where(inArray($articles.status, [
      'FETCH_FAILED', 
      'RENDER_FAILED', 
      'AI_ANALYSIS_FAILED', 
      'EMBEDDING_FAILED', 
      'R2_UPLOAD_FAILED'
    ]))
    .groupBy($articles.status);

    // 查询最近24小时的失败文章详情
    const recentFailures = await db.select({
      id: $articles.id,
      title: $articles.title,
      status: $articles.status,
      failReason: $articles.failReason,
      processedAt: $articles.processedAt,
      url: $articles.url,
      sourceId: $articles.sourceId
    })
    .from($articles)
    .where(
      and(
        inArray($articles.status, [
          'FETCH_FAILED', 
          'RENDER_FAILED', 
          'AI_ANALYSIS_FAILED', 
          'EMBEDDING_FAILED', 
          'R2_UPLOAD_FAILED'
        ]),
        gte($articles.processedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(sql`${$articles.processedAt} DESC`)
    .limit(20);

    return c.json({
      success: true,
      summary: {
        total_failed: failedStats.reduce((sum, stat) => sum + Number(stat.count), 0),
        by_status: failedStats.map(stat => ({
          status: stat.status,
          count: Number(stat.count),
          latest_failure: stat.latest_failure
        }))
      },
      recent_failures: recentFailures,
      retry_options: {
        retry_all_recent: "POST /retry-failed-articles (无参数 - 重试最近24小时失败的文章)",
        retry_specific_status: "POST /retry-failed-articles { status_filter: ['FETCH_FAILED'] }",
        retry_specific_articles: "POST /retry-failed-articles { specific_ids: [123, 456] }",
        retry_custom_timeframe: "POST /retry-failed-articles { hours_since_failed: 48, limit: 100 }"
      }
    });
    
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: "查询失败文章状态失败"
    }, 500);
  }
});

// 现有路由和处理程序...

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const batchLogger = queueLogger.child({ batch_size: batch.messages.length });
    batchLogger.info('Received batch of articles to process');

    const articlesToProcess: number[] = [];
    for (const message of batch.messages) {
      const { articles_id } = message.body as ArticleQueueMessage;
      batchLogger.debug('Processing message', { message_id: message.id, article_count: articles_id.length });

      for (const id of articles_id) {
        articlesToProcess.push(id);
      }
    }

    batchLogger.info('Articles extracted from batch', { total_articles: articlesToProcess.length });

    if (articlesToProcess.length === 0) {
      batchLogger.info('Queue batch was empty, nothing to process');
      batch.ackAll(); // Acknowledge the empty batch
      return;
    }

    const workflowResult = await startProcessArticleWorkflow(env, { articles_id: articlesToProcess });
    if (workflowResult.isErr()) {
      batchLogger.error(
        'Failed to trigger ProcessArticles Workflow',
        { error_message: workflowResult.error.message },
        workflowResult.error
      );
      // Retry the entire batch if Workflow creation failed (cautious with retries if the failure is persistent)
      batch.retryAll({ delaySeconds: 30 }); // Retry after 30 seconds
      return;
    }

    batchLogger.info('Successfully triggered ProcessArticles Workflow', {
      workflow_id: workflowResult.value.id,
      article_count: articlesToProcess.length,
    });
    batch.ackAll(); // Acknowledge the entire batch now that the Workflow has taken over
  },
} satisfies ExportedHandler<Env>;

export { SourceScraperDO };
export { ProcessArticles } from './workflows/processArticles.workflow';
