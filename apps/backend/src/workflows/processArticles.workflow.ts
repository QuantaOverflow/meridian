import { $articles, and, eq, gte, inArray, isNull } from '@meridian/database';
import { DomainRateLimiter } from '../lib/api/rate-limiter';
import { Env } from '../index';
import { getDb } from '../lib/database';
import { getArticleWithBrowser, getArticleWithFetch } from '../lib/services/article-fetchers';
import { looksLikeExtractionFailure, looksLikeNonArticleUrl } from '../lib/core/extraction-quality';
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent, WorkflowStepConfig } from 'cloudflare:workers';
import { Logger } from '../lib/core/logger';
import { createAIServices } from '../lib/services/ai-services';
import { handleServiceResponse } from '../lib/services/clustering';
import { createWorkflowObservability } from '../lib/observability';

// 添加AI Worker响应类型定义
interface AIWorkerAnalysisResponse {
  success: boolean;
  data?: {
    language: string;
    primary_location: string;
    completeness: 'COMPLETE' | 'PARTIAL_USEFUL' | 'PARTIAL_USELESS';
    content_quality: 'OK' | 'LOW_QUALITY' | 'JUNK';
    event_summary_points: string[];
    thematic_keywords: string[];
    topic_tags: string[];
    key_entities: string[];
    content_focus: string[];
  };
  error?: string;
  metadata?: any;
}

interface AIWorkerEmbeddingResponse {
  success: boolean;
  data?: number[];
  error?: string;
  metadata?: any;
}

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

// LLM 分析阶段的并发上限。此前是无界并发(articlesToProcess.map 一次全发),
// 队列 max_batch_size=100 意味着单实例可拿到 100 篇 → 100 路并发。
// 实证(2026-08-17):新增两源首轮 42 篇同时进分析,42/42 在 10:08:53.5xx 这同一毫秒窗内
// 全部 `WorkflowTimeoutError: Execution timed out after 60000ms`(单篇 step 超时 1 分钟);
// 同日涓流量(每小时 5-14 篇)同样代码下 AI_ANALYSIS_FAILED 为 0。
// 注:那次失败跑的是旧 ai-worker(每篇 4 次 LLM 往返,三档死 DashScope 未删),现已降到 1 次,
// 所以真实安全上限比当时高;取 10 是保守值,与同仓既有并发档位(抓取 maxConcurrent=8、
// auto-brief R2_BATCH_SIZE=5)同量级。100 篇 → 10 批,单篇约 5-10 秒,批次总耗时可接受。
const LLM_ANALYSIS_CONCURRENCY = 10;

/**
 * 最小信号量:限制同时进行的异步操作数。
 * 用它而不是 auto-brief 的 batchProcessParallel(分批 + 批间栅栏),原因有二:
 * 1. batchProcessParallel 只收 fulfilled、丢弃 rejected,而这里下游要靠完整的 settled
 *    结果数 failedAnalyses——套用会让失败数静默少算;
 * 2. 分批有队头阻塞:单篇最坏 1 分钟 × 4 次重试,会把整批其余 9 篇一起拖住。
 * release 时把名额**直接移交**给等待者(而非先 active--),避免唤醒间隙被新请求插队超发。
 */
function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise<void>(resolve => waiters.push(resolve));
    },
    release(): void {
      const next = waiters.shift();
      if (next !== undefined) {
        next(); // 名额移交,active 不变
      } else {
        active--;
      }
    },
  };
}

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
    const workflowId = _event.instanceId;
    
    // 观测性：注入 workflow instance id，确保 article_analysis 的 LLM I/O 能按 trace 落 R2。
    const aiServices = createAIServices(env, workflowId);
    // 观测性：与 auto-brief 对齐，落 R2 observability/{workflowId}.json（每步持久化，mid-flight 崩溃也可查）。
    const observability = createWorkflowObservability(workflowId, env);

    const logger = workflowLogger.child({
      workflow_id: workflowId,
      initial_article_count: _event.payload.articles_id.length,
    });

    try {
      logger.info('Starting workflow run');
      await observability.logStep('workflow_start', 'started', { requestedArticles: _event.payload.articles_id.length });

      const articlesDbFetchStartTime = Date.now();
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
      logger.info('Finished fetching articles from DB', { durationMs: Date.now() - articlesDbFetchStartTime, count: articles.length });
      await observability.logStep('fetch_articles', 'completed', { requested: _event.payload.articles_id.length, fetched: articles.length });

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

      const articleFetchBatchStartTime = Date.now();
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
        const individualScrapeStartTime = Date.now();

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
                return { id: article.id, url: article.url, success: true, html: browserResult, used_browser: true };
              } else {
                scrapeLogger.info('Attempting fetch-first approach');
                try {
                  const fetchResult = await getArticleWithFetch(article.url);
                  return { id: article.id, url: article.url, success: true, html: fetchResult, used_browser: false };
                } catch (fetchError) {
                  // Fetch failed, try browser with jitter
                  scrapeLogger.info('Fetch failed, falling back to browser');
                  const jitterTime = Math.random() * 2500 + 500;
                  await step.sleep(`jitter`, jitterTime);

                  const browserResult = await getArticleWithBrowser(env, article.url);
                  return { id: article.id, url: article.url, success: true, html: browserResult, used_browser: true };
                }
              }
            }
          );
          scrapeLogger.info('Individual article scrape completed', { durationMs: Date.now() - individualScrapeStartTime, usedBrowser: result.used_browser });

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
          scrapeLogger.info('Individual article scrape failed', { durationMs: Date.now() - individualScrapeStartTime });

        }

        return result;
      });
      logger.info('All article contents fetched in batch', { durationMs: Date.now() - articleFetchBatchStartTime });

      // Handle results
      let successCount = 0;
      let failCount = 0;

      const dbUpdateLogger = fetchLogger.child({ results_count: articleResults.length });

      for (const result of articleResults) {
        const articleLogger = dbUpdateLogger.child({ article_id: result.id });

        if (result.success && 'html' in result) {
          // 抓取成功,但 Readability 抽到的"正文"可能其实是反爬拦截页/视频播放器stub/登录墙/限流页
          // (非真正文)。机械签名先拦掉(precision~1.0,见 parsers.ts looksLikeExtractionFailure),
          // 按失败记录、不喂 LLM 分析、不进聚类——省下游成本,且现机械门只逮 6/31、靠签名补 27/31。
          const urlJunk = result.url ? looksLikeNonArticleUrl(result.url) : null;
          const textJunk = looksLikeExtractionFailure(result.html.text);
          if (urlJunk || textJunk.fail) {
            const junkReason = urlJunk ? `url_${urlJunk}` : textJunk.reason;
            failCount++;
            await step.do(`mark extraction-junk article ${result.id}`, dbStepConfig, async () => {
              articleLogger.warn('Marking article as extraction junk (fetched but no real article body)', {
                reason: junkReason,
              });
              return db
                .update($articles)
                .set({
                  processedAt: new Date(),
                  failReason: `EXTRACTION_JUNK:${junkReason}`,
                  status: 'FETCH_FAILED',
                })
                .where(eq($articles.id, result.id));
            });
            continue;
          }

          successCount++;
          articlesToProcess.push({
            id: result.id,
            title: result.html.title,
            text: result.html.text,
            publishedTime: result.html.publishedTime,
          });

          const dbUpdateStartTime = Date.now();
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
          articleLogger.info('DB update for successful article completed', { durationMs: Date.now() - dbUpdateStartTime });

        } else {
          failCount++;
          // update failed articles in DB with the fail reason
          const dbUpdateStartTime = Date.now();
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
          articleLogger.info('DB update for failed article completed', { durationMs: Date.now() - dbUpdateStartTime });

        }
      }

      await observability.logStep('content_fetch', 'completed', { total: articles.length, success: successCount, failed: failCount });

      const processingLogger = logger.child({
        processing_batch_size: articlesToProcess.length,
        fetch_success_count: successCount,
        fetch_fail_count: failCount,
      });

      processingLogger.info('Processing articles with LLM analysis');

      const llmAnalysisBatchStartTime = Date.now();
      const analysisSemaphore = createSemaphore(LLM_ANALYSIS_CONCURRENCY);
      const analysisResults = await Promise.allSettled(
        articlesToProcess.map(async (article, analysisIndex) => {
          const articleLogger = processingLogger.child({ article_id: article.id });

          // 排队等分析名额。step.do 在 acquire 之后才发起,所以在途 step 最多
          // LLM_ANALYSIS_CONCURRENCY 个;等待中的文章不占用任何 LLM 调用。
          await analysisSemaphore.acquire();
          articleLogger.info('Analyzing article');

          const individualAnalysisStartTime = Date.now();
          try {
            const articleAnalysis = await step.do(
              `analyze article ${article.id}`,
              { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '1 minute' },
              async (): Promise<AIWorkerAnalysisResponse['data']> => {
                // 使用轻量级AI服务进行文章分析
                const response = await aiServices.aiWorker.analyzeArticle(
                  article.title,
                  article.text,
                  undefined,
                  // 观测性：传每篇文章在本批次中的序号，和 trace_id 一起组成稳定 R2 key。
                  analysisIndex
                );

                try {
                  const result = await handleServiceResponse<AIWorkerAnalysisResponse>(response, 'AI article analysis');
                  
                  if (!result.success || !result.data?.success) {
                    throw new Error(`AI analysis failed: ${result.error || result.data?.error || 'Unknown error'}`);
                  }
                  
                  return result.data.data!;
                } finally {
                  // 确保释放 RPC stub
                  if (response && typeof (response as any).dispose === 'function') {
                    (response as any).dispose();
                  }
                }
              }
            );

            articleLogger.info('Individual article analysis completed', { durationMs: Date.now() - individualAnalysisStartTime });

            articleLogger.debug('Article analysis completed', {
              topic_tags_count: articleAnalysis?.topic_tags.length || 0,
              entities_count: articleAnalysis?.key_entities.length || 0,
            });

            const date = article.publishedTime ? new Date(article.publishedTime) : new Date();
            const fileKey = `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}/${article.id}.txt`;

            articleLogger.info('Updating article info in DB');

            // embedding 不再在进稿时逐篇实时算（成本：每次调用都会重置 ml-service 容器的
            // 10min sleepAfter，账单实证容器因此 24/7 常驻，~$31/月）。embedding 的唯一
            // 消费者是 auto-brief-generation 的每日聚类，已改为该工作流聚类前批量补算。
            const uploadStartTime = Date.now();
            const [uploadResult] = await Promise.allSettled([
              step.do(`upload article contents to R2 for article ${article.id}`, async () => {
                articleLogger.info('Uploading article contents to R2');
                await env.ARTICLES_BUCKET.put(fileKey, article.text);
                return fileKey;
              }),
            ]);
            articleLogger.info('R2 upload completed', { durationMs: Date.now() - uploadStartTime });

            // handle results in a separate step
            const finalDbUpdateStartTime = Date.now();
            await step.do(`update article ${article.id} status`, async () => {
              // check for failures
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
                  language: articleAnalysis?.language || 'unknown',
                  contentFileKey: uploadResult.value,
                  primary_location: articleAnalysis?.primary_location || 'unknown',
                  completeness: articleAnalysis?.completeness || 'PARTIAL_USELESS',
                  content_quality: articleAnalysis?.content_quality || 'LOW_QUALITY',
                  event_summary_points: articleAnalysis?.event_summary_points || [],
                  thematic_keywords: articleAnalysis?.thematic_keywords || [],
                  topic_tags: articleAnalysis?.topic_tags || [],
                  key_entities: articleAnalysis?.key_entities || [],
                  content_focus: articleAnalysis?.content_focus || [],
                  // embedding 留空，由 auto-brief-generation 聚类前批量补算
                  status: 'PROCESSED',
                })
                .where(eq($articles.id, article.id));
            });
            articleLogger.info('Final DB update for article status completed', { durationMs: Date.now() - finalDbUpdateStartTime });

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
          } finally {
            analysisSemaphore.release();
          }
        })
      );
      logger.info('All LLM analysis and embedding/R2 operations completed in batch', { durationMs: Date.now() - llmAnalysisBatchStartTime });

      const successfulAnalyses = analysisResults.filter(
        (result): result is PromiseFulfilledResult<{ id: number; success: true }> =>
          result.status === 'fulfilled' && result.value.success
      ).length;

      const failedAnalyses = analysisResults.filter(
        result => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)
      ).length;

      await observability.logStep('llm_analysis', 'completed', {
        total: articlesToProcess.length,
        success: successfulAnalyses,
        failed: failedAnalyses,
      });

      logger.info('Workflow completed', {
        total_articles: articlesToProcess.length,
        successful_analyses: successfulAnalyses,
        failed_analyses: failedAnalyses,
        final_duration_ms: Date.now() - articlesDbFetchStartTime // Total workflow duration
      });
      await observability.complete();
    } catch (error) {
      logger.error('Workflow execution failed with an unhandled exception', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, error instanceof Error ? error : new Error(String(error)));
      // 观测性：失败也落 R2，便于事后排查中断点
      await observability.fail(error instanceof Error ? error.message : String(error));
      // re-throw the error so Cloudflare Workflow can mark it as failed
      throw error;
    }
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
  try {
    const workflow = await env.PROCESS_ARTICLES.create({ id: crypto.randomUUID(), params });
    return { success: true, data: workflow };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}
