import getArticleAnalysisPrompt, { articleAnalysisSchema } from '../prompts/articleAnalysis.prompt';
import { $articles, and, eq, gte, inArray, isNull } from '@meridian/database';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { DomainRateLimiter } from '../lib/rateLimiter';
import { generateObject } from 'ai';
import { Env } from '../index';
import { err, ok } from 'neverthrow';
import { generateSearchText, getDb } from '../lib/utils';
import { getArticleWithBrowser, getArticleWithFetch } from '../lib/articleFetchers';
import { ResultAsync } from 'neverthrow';
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent, WorkflowStepConfig } from 'cloudflare:workers';
import { createEmbeddings } from '../lib/embeddings';
import { Logger } from '../lib/logger';

const TRICKY_DOMAINS = [
  'reuters.com',
  'nytimes.com',
  'politico.com',
  'science.org',
  'alarabiya.net',
  'reason.com',
  'telegraph.co.uk',
  'lawfaremedia',
  'liberation.fr',
  'france24.com',
];

const dbStepConfig: WorkflowStepConfig = {
  retries: { limit: 3, delay: '1 second', backoff: 'linear' },
  timeout: '5 seconds',
};

/**
 * Parameters for the ProcessArticles workflow
 */
type ProcessArticlesParams = { articles_id: number[] };

const workflowLogger = new Logger({ workflow: 'ProcessArticles' });

/**
 * Workflow that processes articles by fetching their content, analyzing with LLM,
 * generating embeddings, and storing the results.
 *
 * This workflow handles:
 * - Fetching article content with appropriate rate limiting
 * - Domain-specific fetching strategies (browser vs. simple fetch)
 * - LLM-based content analysis and extraction
 * - Embedding generation for search
 * - Persistent storage in database and object storage
 * - Error handling and status tracking
 */
export class ProcessArticles extends WorkflowEntrypoint<Env, ProcessArticlesParams> {
  /**
   * Main workflow execution method that processes a batch of articles
   *
   * @param _event Workflow event containing article IDs to process
   * @param step Workflow step context for creating durable operations
   */
  async run(_event: WorkflowEvent<ProcessArticlesParams>, step: WorkflowStep) {
    const env = this.env;
    const db = getDb(env.HYPERDRIVE);
    const google = createGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
      baseURL: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    });
    const logger = workflowLogger.child({
      workflow_id: _event.instanceId,
      initial_article_count: _event.payload.articles_id.length,
    });

    logger.info('Starting workflow run');

    const articles = await step.do('get articles', dbStepConfig, async () =>
      db
        .select({ id: $articles.id, url: $articles.url, title: $articles.title, publishedAt: $articles.publishDate })
        .from($articles)
        .where(

          and(
            // only process articles that haven't been processed yet
            isNull($articles.processedAt),
            // only process articles that have a publish date in the last 48 hours
            gte($articles.publishDate, new Date(new Date().getTime() - 48 * 60 * 60 * 1000)),
            // only articles that have not failed
            isNull($articles.failReason),
            // MAIN FILTER: only articles that need to be processed
            inArray($articles.id, _event.payload.articles_id)
          )
        )
    );

    const fetchLogger = logger.child({ articles_count: articles.length });
    fetchLogger.info('Fetching article contents');

    // Create rate limiter with article processing specific settings
    const rateLimiter = new DomainRateLimiter<{ id: number; url: string; title: string; publishedAt: Date | null }>({
      maxConcurrent: 8,
      globalCooldownMs: 1000,
      domainCooldownMs: 5000,
    });

    // Process articles with rate limiting
    const articlesToProcess: Array<{ id: number; title: string; text: string; publishedTime?: string }> = [];
    const articleResults = await rateLimiter.processBatch(articles, step, async (article, domain) => {
      const scrapeLogger = fetchLogger.child({ article_id: article.id, domain });

      // Skip PDFs immediately
      if (article.url.toLowerCase().endsWith('.pdf')) {
        scrapeLogger.info('Skipping PDF article');

        // Update the article status to mark it as skipped PDF
        await step.do(`mark PDF article ${article.id} as skipped`, dbStepConfig, async () => {
          return db
            .update($articles)
            .set({
              status: 'SKIPPED_PDF',
              processedAt: new Date(),
              failReason: 'PDF article - cannot process',
            })
            .where(eq($articles.id, article.id));
        });

        return { id: article.id, success: false, error: 'pdf' };
      }

      scrapeLogger.info('Attempting to scrape article');

      // This will contain either a successful result or a controlled error
      let result;
      try {
        result = await step.do(
          `scrape article ${article.id}`,
          { retries: { limit: 3, delay: '2 second', backoff: 'exponential' }, timeout: '2 minutes' },
          async () => {
            // During retries, let errors bubble up naturally
            if (TRICKY_DOMAINS.includes(domain)) {
              scrapeLogger.info('Using browser to fetch article (tricky domain)');
              const browserResult = await getArticleWithBrowser(env, article.url);
              if (browserResult.isErr()) throw browserResult.error.error;
              return { id: article.id, success: true, html: browserResult.value, used_browser: true };
            } else {
              scrapeLogger.info('Attempting fetch-first approach');
              const fetchResult = await getArticleWithFetch(article.url);
              if (!fetchResult.isErr()) {
                return { id: article.id, success: true, html: fetchResult.value, used_browser: false };
              }

              // Fetch failed, try browser with jitter
              scrapeLogger.info('Fetch failed, falling back to browser');
              const jitterTime = Math.random() * 2500 + 500;
              await step.sleep(`jitter`, jitterTime);

              const browserResult = await getArticleWithBrowser(env, article.url);
              if (browserResult.isErr()) throw browserResult.error.error;

              return { id: article.id, success: true, html: browserResult.value, used_browser: true };
            }
          }
        );
      } catch (error) {
        scrapeLogger.error(
          'Failed to scrape article',
          { error: error instanceof Error ? error.message : String(error) },
          error instanceof Error ? error : new Error(String(error))
        );
        // After all retries failed, return a structured error
        result = {
          id: article.id,
          success: false,
          error: error instanceof Error ? error.message : String(error) || 'exhausted all retries',
        };
      }

      return result;
    });

    // Handle results
    let successCount = 0;
    let failCount = 0;

    const dbUpdateLogger = fetchLogger.child({ results_count: articleResults.length });

    for (const result of articleResults) {
      const articleLogger = dbUpdateLogger.child({ article_id: result.id });

      if (result.success && 'html' in result) {
        successCount++;
        articlesToProcess.push({
          id: result.id,
          title: result.html.title,
          text: result.html.text,
          publishedTime: result.html.publishedTime,
        });

        await step.do(`update db for successful article ${result.id}`, dbStepConfig, async () => {
          articleLogger.debug('Updating article status to CONTENT_FETCHED');
          return db
            .update($articles)
            .set({
              status: 'CONTENT_FETCHED',
              used_browser: result.used_browser,
            })
            .where(eq($articles.id, result.id));
        });
      } else {
        failCount++;
        // update failed articles in DB with the fail reason
        await step.do(`update db for failed article ${result.id}`, dbStepConfig, async () => {
          const failReason = result.error ? String(result.error) : 'Unknown error';
          const status = result.error?.includes('render') ? 'RENDER_FAILED' : 'FETCH_FAILED';

          articleLogger.warn('Marking article as failed during content fetch', {
            fail_reason: failReason,
            status,
          });

          return db
            .update($articles)
            .set({
              processedAt: new Date(),
              failReason: failReason,
              status: status,
            })
            .where(eq($articles.id, result.id));
        });
      }
    }

    const processingLogger = logger.child({
      processing_batch_size: articlesToProcess.length,
      fetch_success_count: successCount,
      fetch_fail_count: failCount,
    });

    processingLogger.info('Processing articles with LLM analysis');

    // process with LLM
    const analysisResults = await Promise.allSettled(
      articlesToProcess.map(async article => {
        const articleLogger = processingLogger.child({ article_id: article.id });
        articleLogger.info('Analyzing article');

        try {
          const articleAnalysis = await step.do(
            `analyze article ${article.id}`,
            { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' },
            async () => {
              const response = await generateObject({
                model: google('gemini-1.5-flash-8b-001'),
                temperature: 0,
                prompt: getArticleAnalysisPrompt(article.title, article.text),
                schema: articleAnalysisSchema,
              });
              return response.object;
            }
          );

          articleLogger.debug('Article analysis completed', {
            topic_tags_count: articleAnalysis.topic_tags.length,
            entities_count: articleAnalysis.key_entities.length,
          });

          const date = article.publishedTime ? new Date(article.publishedTime) : new Date();
          const fileKey = `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}/${article.id}.txt`;

          articleLogger.info('Updating article info in DB');

          // run embedding and upload in parallel
          const [embeddingResult, uploadResult] = await Promise.allSettled([
            step.do(`generate embeddings for article ${article.id}`, async () => {
              articleLogger.info('Generating embeddings');
              const searchText = generateSearchText({ title: article.title, ...articleAnalysis });
              const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: searchText });
              return embedding.data[0];
            }),
            step.do(`upload article contents to R2 for article ${article.id}`, async () => {
              articleLogger.info('Uploading article contents to R2');
              await env.ARTICLES_BUCKET.put(fileKey, article.text);
              return fileKey;
            }),
          ]);

          // handle results in a separate step
          await step.do(`update article ${article.id} status`, async () => {
            // check for failures
            if (embeddingResult.status === 'rejected') {
              const error = embeddingResult.reason;
              articleLogger.error(
                'Embedding generation failed',
                { reason: String(error) },
                error instanceof Error ? error : new Error(String(error))
              );

              await db
                .update($articles)
                .set({
                  processedAt: new Date(),
                  failReason: `Embedding generation failed: ${String(error)}`,
                  status: 'EMBEDDING_FAILED',
                })
                .where(eq($articles.id, article.id));
              return;
            }

            if (uploadResult.status === 'rejected') {
              const error = uploadResult.reason;
              articleLogger.error(
                'R2 upload failed',
                { reason: String(error) },
                error instanceof Error ? error : new Error(String(error))
              );

              await db
                .update($articles)
                .set({
                  processedAt: new Date(),
                  failReason: `R2 upload failed: ${String(error)}`,
                  status: 'R2_UPLOAD_FAILED',
                })
                .where(eq($articles.id, article.id));
              return;
            }

            // if both succeeded, update with success state
            articleLogger.info('Article processing completed successfully');
            await db
              .update($articles)
              .set({
                processedAt: new Date(),
                title: article.title,
                language: articleAnalysis.language,
                contentFileKey: uploadResult.value,
                primary_location: articleAnalysis.primary_location,
                completeness: articleAnalysis.completeness,
                content_quality: articleAnalysis.content_quality,
                event_summary_points: articleAnalysis.event_summary_points,
                thematic_keywords: articleAnalysis.thematic_keywords,
                topic_tags: articleAnalysis.topic_tags,
                key_entities: articleAnalysis.key_entities,
                content_focus: articleAnalysis.content_focus,
                embedding: embeddingResult.value,
                status: 'PROCESSED',
              })
              .where(eq($articles.id, article.id));
          });

          articleLogger.info('Article processed successfully');

          return { id: article.id, success: true };
        } catch (error) {
          articleLogger.error(
            'Article analysis failed',
            { reason: error instanceof Error ? error.message : String(error) },
            error instanceof Error ? error : new Error(String(error))
          );

          await step.do(`mark article ${article.id} as failed in analysis`, dbStepConfig, async () =>
            db
              .update($articles)
              .set({
                processedAt: new Date(),
                failReason: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
                status: 'AI_ANALYSIS_FAILED',
              })
              .where(eq($articles.id, article.id))
          );
          return { id: article.id, success: false, error };
        }
      })
    );

    const successfulAnalyses = analysisResults.filter(
      (result): result is PromiseFulfilledResult<{ id: number; success: true }> =>
        result.status === 'fulfilled' && result.value.success
    ).length;

    const failedAnalyses = analysisResults.filter(
      result => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)
    ).length;

    logger.info('Workflow completed', {
      total_articles: articlesToProcess.length,
      successful_analyses: successfulAnalyses,
      failed_analyses: failedAnalyses,
    });
  }
}

/**
 * Starts a new ProcessArticles workflow instance with the provided article IDs
 *
 * @param env Application environment
 * @param params Parameters containing the list of article IDs to process
 * @returns Result containing either the created workflow or an error
 */
export async function startProcessArticleWorkflow(env: Env, params: ProcessArticlesParams) {
  const workflow = await ResultAsync.fromPromise(env.PROCESS_ARTICLES.create({ id: crypto.randomUUID(), params }), e =>
    e instanceof Error ? e : new Error(String(e))
  );
  if (workflow.isErr()) return err(workflow.error);
  return ok(workflow.value);
}
