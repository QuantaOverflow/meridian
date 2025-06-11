import { Hono } from 'hono';
import importedApp from './app';
import { SourceScraperDO } from './durable_objects/sourceScraperDO';
import { startProcessArticleWorkflow } from './workflows/processArticles.workflow';
import { AutoBriefGenerationWorkflow } from './workflows/auto-brief-generation';
import { Logger } from './lib/logger';
import { Ai } from '@cloudflare/ai';

type ArticleQueueMessage = { articles_id: number[] };

export type Env = {
  // Bindings
  ARTICLES_BUCKET: R2Bucket;
  ARTICLE_PROCESSING_QUEUE: Queue<ArticleQueueMessage>;
  SOURCE_SCRAPER: DurableObjectNamespace<SourceScraperDO>;
  PROCESS_ARTICLES: Workflow;
  MY_WORKFLOW: Workflow; // 简报生成工作流
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
    if (!workflowResult.success) {
      batchLogger.error(
        'Failed to trigger ProcessArticles Workflow',
        { error_message: workflowResult.error },
        new Error(workflowResult.error)
      );
      // Retry the entire batch if Workflow creation failed (cautious with retries if the failure is persistent)
      batch.retryAll({ delaySeconds: 30 }); // Retry after 30 seconds
      return;
    }

    batchLogger.info('Successfully triggered ProcessArticles Workflow', {
      workflow_id: workflowResult.data?.id,
      article_count: articlesToProcess.length,
    });
    batch.ackAll(); // Acknowledge the entire batch now that the Workflow has taken over
  },
} satisfies ExportedHandler<Env>;

export { SourceScraperDO };
export { ProcessArticles } from './workflows/processArticles.workflow';
export { AutoBriefGenerationWorkflow } from './workflows/auto-brief-generation';
