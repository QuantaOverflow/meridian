import { Hono } from 'hono';
import importedApp from './app';
import { SourceScraperDO } from './durable_objects/sourceScraperDO';
import { startProcessArticleWorkflow } from './workflows/processArticles.workflow';
import { Logger } from './lib/logger';
import { Ai } from '@cloudflare/ai';

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
