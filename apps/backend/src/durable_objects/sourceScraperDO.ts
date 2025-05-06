import { $articles, $sources, eq } from '@meridian/database';
import { Env } from '../index';
import { err, ok, Result, ResultAsync } from 'neverthrow';
import { getDb } from '../lib/utils';
import { Logger } from '../lib/logger';
import { parseRSSFeed } from '../lib/parsers';
import { tryCatchAsync } from '../lib/tryCatchAsync';
import { userAgents } from '../lib/utils';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

/**
 * Schema for validating SourceState
 * Used to ensure state hasn't been corrupted before operating on it
 */
const SourceStateSchema = z.object({
  sourceId: z.number().int().positive(),
  url: z.string().url(),
  scrapeFrequencyTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  lastChecked: z.number().nullable(),
});

/**
 * State interface for managing RSS source scraping configuration and status
 */
type SourceState = z.infer<typeof SourceStateSchema>;

const tierIntervals = {
  1: 60 * 60 * 1000, // Tier 1: Check every hour
  2: 4 * 60 * 60 * 1000, // Tier 2: Check every 4 hours
  3: 6 * 60 * 60 * 1000, // Tier 3: Check every 6 hours
  4: 24 * 60 * 60 * 1000, // Tier 4: Check every 24 hours
};
const DEFAULT_INTERVAL = tierIntervals[2]; // Default to 4 hours if tier is invalid

// --- Retry Configuration ---
const MAX_STEP_RETRIES = 3; // Max retries for *each* step (fetch, parse, insert)
const INITIAL_RETRY_DELAY_MS = 500; // Start delay, doubles each time

/**
 * Executes an operation with exponential backoff retries
 *
 * @param operation Function that returns a Promise<Result> to execute with retries
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelayMs Initial delay between retries in milliseconds (doubles each retry)
 * @param logger Logger instance to record retry attempts and failures
 * @returns Result object from either a successful operation or the last failed attempt
 *
 * @template T Success value type
 * @template E Error type, must extend Error
 */
async function attemptWithRetries<T, E extends Error>(
  operation: () => Promise<Result<T, E>>,
  maxRetries: number,
  initialDelayMs: number,
  logger: Logger
): Promise<Result<T, E>> {
  let lastError: E | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.debug(`Attempt ${attempt}/${maxRetries}...`);
    const result = await operation();

    if (result.isOk()) {
      logger.debug(`Attempt ${attempt} successful.`);
      return ok(result.value); // Return successful result immediately
    } else {
      lastError = result.error; // Store the error
      logger.warn(
        `Attempt ${attempt} failed.`,
        { error_name: lastError.name, error_message: lastError.message },
        lastError
      );

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`Waiting before next attempt.`, { delay_ms: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // If loop finishes, all retries failed
  logger.error(`Failed after max attempts.`, { max_retries: maxRetries }, lastError!);
  return err(lastError!);
}

/**
 * Durable Object for periodically scraping RSS feeds from various sources
 *
 * This DO handles:
 * - Scheduled scraping of RSS sources based on frequency tiers
 * - Fetching and parsing RSS content
 * - Extracting and storing new articles
 * - Sending new articles to a processing queue
 * - Managing state across executions
 * - Handling failures with retries
 */
export class SourceScraperDO extends DurableObject<Env> {
  private logger: Logger;

  /**
   * Initializes the DO with logging
   *
   * @param ctx Durable Object state context
   * @param env Application environment
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.logger = new Logger({ durable_object: 'SourceScraperDO', do_id: this.ctx.id.toString() });
    this.logger.info('DO initialized');
  }

  /**
   * Initializes the scraper with source data and sets up the initial alarm
   *
   * @param sourceData Source configuration including ID, URL, and scrape frequency
   * @throws Error if initialization fails
   */
  async initialize(sourceData: { id: number; url: string; scrape_frequency: number }): Promise<void> {
    const logger = this.logger.child({ operation: 'initialize', source_id: sourceData.id, url: sourceData.url });
    logger.info('Initializing with data', { source_data: sourceData });

    const sourceExistsResult = await ResultAsync.fromPromise(
      getDb(this.env.HYPERDRIVE).query.$sources.findFirst({ where: (s, { eq }) => eq(s.id, sourceData.id) }),
      e => new Error(`Database query failed: ${e}`)
    );
    if (sourceExistsResult.isErr()) {
      logger.error('Failed to query DB for source', undefined, sourceExistsResult.error);
      throw sourceExistsResult.error; // Rethrow DB error
    }
    if (!sourceExistsResult.value) {
      logger.warn(
        "Source doesn't exist in DB. This is likely due to a race condition where the source was deleted after being queued for initialization."
      );
      // Instead of throwing, we'll just return without setting up the DO
      return;
    }

    let tier = sourceData.scrape_frequency;
    if (![1, 2, 3, 4].includes(tier)) {
      logger.warn(`Invalid scrape_frequency received. Defaulting to 2.`, { invalid_frequency: tier });
      tier = 2; // Default tier
    }

    const state = {
      sourceId: sourceData.id,
      url: sourceData.url,
      scrapeFrequencyTier: tier as SourceState['scrapeFrequencyTier'],
      lastChecked: null,
    };

    // Add retry logic for storage operations
    let putSuccess = false;
    for (let i = 0; i < 3 && !putSuccess; i++) {
      try {
        await this.ctx.storage.put('state', state);
        putSuccess = true;
        logger.info('Initialized state successfully.');
      } catch (storageError) {
        logger.warn(`Attempt ${i + 1} to put state failed`, undefined, storageError as Error);
        if (i < 2) await new Promise(res => setTimeout(res, 200 * (i + 1))); // Exponential backoff
      }
    }

    if (!putSuccess) {
      logger.error('Failed to put initial state after retries. DO may be unstable.');
      throw new Error('Failed to persist initial DO state.');
    }

    try {
      // Update the source's do_initialized_at field
      await getDb(this.env.HYPERDRIVE)
        .update($sources)
        .set({ do_initialized_at: new Date() })
        .where(eq($sources.id, sourceData.id));
    } catch (dbError) {
      logger.error('Failed to update source do_initialized_at', undefined, dbError as Error);
      throw new Error(
        `Failed to update source initialization status: ${dbError instanceof Error ? dbError.message : String(dbError)}`
      );
    }

    try {
      // Only set alarm if state was successfully stored
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      logger.info('Initial alarm set.');
    } catch (alarmError) {
      logger.error('Failed to set initial alarm', undefined, alarmError as Error);
      throw new Error(
        `Failed to set initial alarm: ${alarmError instanceof Error ? alarmError.message : String(alarmError)}`
      );
    }
  }

  /**
   * Alarm handler that performs the scheduled RSS scraping
   *
   * This method is triggered by the DO alarm and:
   * 1. Fetches the RSS feed from the source URL
   * 2. Parses the XML into article entries
   * 3. Filters out old articles
   * 4. Inserts new articles into the database
   * 5. Sends new article IDs to the processing queue
   * 6. Schedules the next alarm
   */
  async alarm(): Promise<void> {
    // Keep logger instance outside try block if possible,
    // but create child logger inside if needed after state is fetched.
    let alarmLogger = this.logger.child({ operation: 'alarm' }); // Initial logger

    try {
      const state = await this.ctx.storage.get<SourceState>('state');
      if (state === undefined) {
        this.logger.error('State not found in alarm. Cannot proceed.');
        // Maybe schedule alarm far in the future or log an error to an external system
        // We cannot proceed without state.
        return;
      }

      // Validate state to protect against corruption
      const validatedState = SourceStateSchema.safeParse(state);
      if (validatedState.success === false) {
        const logger = this.logger.child({ operation: 'alarm', validation_error: validatedState.error.format() });
        logger.error('State validation failed. Cannot proceed with corrupted state.');
        // Schedule a far-future alarm to prevent continuous failed attempts
        await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        return;
      }

      const { sourceId, url, scrapeFrequencyTier } = validatedState.data;
      const alarmLogger = this.logger.child({ operation: 'alarm', source_id: sourceId, url });
      alarmLogger.info('Alarm triggered');

      const interval = tierIntervals[scrapeFrequencyTier] || DEFAULT_INTERVAL;

      // --- Schedule the *next* regular alarm run immediately ---
      // This ensures that even if this current run fails completely after all retries,
      // the process will attempt again later according to its schedule.
      const nextScheduledAlarmTime = Date.now() + interval;
      await this.ctx.storage.setAlarm(nextScheduledAlarmTime);
      alarmLogger.info('Next regular alarm scheduled', { next_alarm: new Date(nextScheduledAlarmTime).toISOString() });

      // --- Workflow Step 1: Fetch Feed with Retries ---
      const fetchLogger = alarmLogger.child({ step: 'Fetch' });
      const fetchResult = await attemptWithRetries(
        async () => {
          const respResult = await tryCatchAsync(
            fetch(url, {
              method: 'GET',
              headers: {
                'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                Referer: 'https://www.google.com/',
              },
            })
          );
          if (respResult.isErr()) return err(respResult.error as Error);
          // Ensure response is OK before trying to read body
          if (respResult.value.ok === false) {
            return err(
              new Error(`Fetch failed with status: ${respResult.value.status} ${respResult.value.statusText}`)
            );
          }
          // Read body - this can also fail
          const textResult = await tryCatchAsync(respResult.value.text());
          if (textResult.isErr()) return err(textResult.error as Error);
          return ok(textResult.value);
        },
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        fetchLogger
      );
      if (fetchResult.isErr()) {
        // Error already logged by attemptWithRetries
        return;
      }
      const feedText = fetchResult.value;

      // --- Workflow Step 2: Parse Feed with Retries ---
      const parseLogger = alarmLogger.child({ step: 'Parse' });
      const parseResult = await attemptWithRetries(
        async () => parseRSSFeed(feedText),
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        parseLogger
      );
      if (parseResult.isErr()) {
        // Error already logged by attemptWithRetries
        return;
      }
      const articles = parseResult.value; // Type: ParsedArticle[]

      // --- Filter Articles ---
      const now = Date.now();
      const ageThreshold = now - 48 * 60 * 60 * 1000; // 48 hours ago

      const articlesToProcess: Omit<typeof $articles.$inferInsert, 'id'>[] = [];
      const articlesToSkip: Omit<typeof $articles.$inferInsert, 'id'>[] = [];

      articles.forEach(article => {
        const publishTimestamp = article.pubDate ? article.pubDate.getTime() : 0;

        if (publishTimestamp > ageThreshold) {
          articlesToProcess.push({
            sourceId: sourceId,
            url: article.link,
            title: article.title,
            publishDate: article.pubDate,
            // status defaults to PENDING_FETCH via schema
          });
        } else {
          articlesToSkip.push({
            sourceId: sourceId,
            url: article.link,
            title: article.title,
            publishDate: article.pubDate,
            status: 'SKIPPED_TOO_OLD',
            processedAt: new Date(now),
            failReason: 'Article older than 48-hour processing threshold',
          });
        }
      });

      if (articlesToProcess.length === 0 && articlesToSkip.length === 0) {
        alarmLogger.info('No articles found (neither new nor old)');

        // Successfully processed, update lastChecked
        validatedState.data.lastChecked = now;
        await this.ctx.storage.put('state', validatedState.data);
        alarmLogger.info('Updated lastChecked', { timestamp: new Date(now).toISOString() });

        // Update source lastChecked in database with retries
        const sourceUpdateLogger = alarmLogger.child({ step: 'Source Update' });
        const sourceUpdateResult = await attemptWithRetries(
          async () =>
            ResultAsync.fromPromise(
              getDb(this.env.HYPERDRIVE)
                .update($sources)
                .set({ lastChecked: new Date(now) })
                .where(eq($sources.id, sourceId)),
              e => (e instanceof Error ? e : new Error(`Source update failed: ${String(e)}`))
            ),
          MAX_STEP_RETRIES,
          INITIAL_RETRY_DELAY_MS,
          sourceUpdateLogger
        );

        if (sourceUpdateResult.isErr()) {
          sourceUpdateLogger.error('Failed to update source lastChecked after all retries');
          return;
        }
        sourceUpdateLogger.info('Updated source lastChecked in database');
        return;
      }

      alarmLogger.info('Processed articles from feed', {
        to_process_count: articlesToProcess.length,
        to_skip_count: articlesToSkip.length,
      });

      const allArticlesToInsert = [...articlesToProcess, ...articlesToSkip];

      // --- Workflow Step 3: Insert Articles with Retries ---
      const dbLogger = alarmLogger.child({ step: 'DB Insert' });
      const insertResult = await attemptWithRetries(
        async () =>
          ResultAsync.fromPromise(
            getDb(this.env.HYPERDRIVE)
              .insert($articles)
              .values(allArticlesToInsert)
              .onConflictDoNothing({ target: $articles.url })
              .returning({ insertedId: $articles.id, insertedUrl: $articles.url }), // Return URL to map back
            e => (e instanceof Error ? e : new Error(`DB Insert failed: ${String(e)}`)) // Error mapper
          ),
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        dbLogger
      );
      if (insertResult.isErr()) {
        // Error already logged by attemptWithRetries
        return;
      }

      const insertedRows = insertResult.value; // Type: { insertedId: number, insertedUrl: string }[]
      dbLogger.info(`DB Insert completed`, { affected_rows: insertedRows.length });

      // Filter inserted IDs to only include those that were meant for processing
      const urlsToProcess = new Set(articlesToProcess.map(a => a.url));
      const idsToQueue = insertedRows.filter(row => urlsToProcess.has(row.insertedUrl)).map(row => row.insertedId);

      // --- Send to Queue (No Retry here, relies on Queue's built-in retries/DLQ) ---
      if (idsToQueue.length > 0 && this.env.ARTICLE_PROCESSING_QUEUE) {
        const BATCH_SIZE_LIMIT = 100; // Adjust as needed

        const queueLogger = alarmLogger.child({ step: 'Queue', total_ids_to_queue: idsToQueue.length });
        queueLogger.info('Sending relevant IDs to queue');

        for (let i = 0; i < idsToQueue.length; i += BATCH_SIZE_LIMIT) {
          const batch = idsToQueue.slice(i, i + BATCH_SIZE_LIMIT);
          queueLogger.debug('Sending batch to queue', { batch_size: batch.length, batch_index: i / BATCH_SIZE_LIMIT });

          this.ctx.waitUntil(
            this.env.ARTICLE_PROCESSING_QUEUE.send({ articles_id: batch }).catch(queueError => {
              queueLogger.error(
                'Failed to send batch to queue',
                { batch_index: i / BATCH_SIZE_LIMIT, batch_size: batch.length },
                queueError instanceof Error ? queueError : new Error(String(queueError))
              );
            })
          );
        }
      }

      // --- Final Step: Update lastChecked only on full success ---
      alarmLogger.info('All steps successful. Updating lastChecked');
      validatedState.data.lastChecked = now;
      await this.ctx.storage.put('state', validatedState.data);
      alarmLogger.info('Updated lastChecked', { timestamp: new Date(now).toISOString() });

      // Update source lastChecked in database with retries
      const sourceUpdateLogger = alarmLogger.child({ step: 'Source Update' });
      const sourceUpdateResult = await attemptWithRetries(
        async () =>
          ResultAsync.fromPromise(
            getDb(this.env.HYPERDRIVE)
              .update($sources)
              .set({ lastChecked: new Date(now) })
              .where(eq($sources.id, sourceId)),
            e => (e instanceof Error ? e : new Error(`Source update failed: ${String(e)}`))
          ),
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        sourceUpdateLogger
      );

      if (sourceUpdateResult.isErr()) {
        sourceUpdateLogger.error('Failed to update source lastChecked after all retries');
        return;
      }
      sourceUpdateLogger.info('Updated source lastChecked in database');
    } catch (error) {
      // Use the latest available logger instance (might be base or detailed)
      const errorLogger = alarmLogger || this.logger;
      errorLogger.error(
        'Unhandled exception occurred within alarm handler',
        { error_name: error instanceof Error ? error.name : 'UnknownError' },
        error instanceof Error ? error : new Error(String(error)) // Log the error object/stack
      );
    }
  }

  /**
   * Handles HTTP requests to manage the scraper
   *
   * Supports endpoints:
   * - /trigger: Manually triggers an immediate scrape
   * - /status: Returns the current state and next alarm time
   * - /delete: Deletes the DO
   * - /initialize: Sets up the scraper with a new source configuration
   *
   * @param request The incoming HTTP request
   * @returns HTTP response with appropriate status and data
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fetchLogger = this.logger.child({ operation: 'fetch', method: request.method, path: url.pathname });
    fetchLogger.info('Received fetch request');

    if (url.pathname === '/trigger') {
      fetchLogger.info('Manual trigger received');
      await this.ctx.storage.setAlarm(Date.now()); // Trigger alarm soon
      return new Response('Alarm set');
    } else if (url.pathname === '/status') {
      fetchLogger.info('Status request received');
      const state = await this.ctx.storage.get('state');
      const alarm = await this.ctx.storage.getAlarm();
      return Response.json({
        state: state || { error: 'State not initialized' },
        nextAlarmTimestamp: alarm,
      });
    } else if (url.pathname === '/delete' && request.method === 'DELETE') {
      fetchLogger.info('Delete request received');
      try {
        await this.destroy();
        fetchLogger.info('DO successfully destroyed');
        return new Response('Deleted', { status: 200 });
      } catch (error) {
        fetchLogger.error('Failed to destroy DO', undefined, error instanceof Error ? error : new Error(String(error)));
        return new Response(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`, {
          status: 500,
        });
      }
    } else if (url.pathname === '/initialize' && request.method === 'POST') {
      fetchLogger.info('Initialize request received');
      const sourceDataResult = await tryCatchAsync(
        request.json<{ id: number; url: string; scrape_frequency: number }>()
      );
      if (sourceDataResult.isErr()) {
        const error =
          sourceDataResult.error instanceof Error ? sourceDataResult.error : new Error(String(sourceDataResult.error));

        fetchLogger.error('Initialization failed via fetch', undefined, error);
        return new Response(`Initialization failed: ${error.message}`, { status: 500 });
      }

      const sourceData = sourceDataResult.value;
      if (
        !sourceData ||
        typeof sourceData.id !== 'number' ||
        typeof sourceData.url !== 'string' ||
        typeof sourceData.scrape_frequency !== 'number'
      ) {
        fetchLogger.warn('Invalid source data format received', { received_data: sourceData });
        return new Response('Invalid source data format', { status: 400 });
      }

      try {
        await this.initialize(sourceData);
        fetchLogger.info('Initialization successful via API');
        return new Response('Initialized');
      } catch (error) {
        fetchLogger.error(
          'Initialization failed',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
        return new Response(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`, {
          status: 500,
        });
      }
    }

    fetchLogger.warn('Path not found');
    return new Response('Not found', { status: 404 });
  }

  /**
   * Cleanup method called when the DO is about to be destroyed
   * Removes all stored state
   */
  async destroy() {
    this.logger.info('Destroy called, deleting storage');
    const state = await this.ctx.storage.get<SourceState>('state');
    if (state?.sourceId) {
      // Clear the do_initialized_at field when DO is destroyed
      await getDb(this.env.HYPERDRIVE)
        .update($sources)
        .set({ do_initialized_at: null })
        .where(eq($sources.id, state.sourceId));
    }
    await this.ctx.storage.deleteAll();
    this.logger.info('Storage deleted');
  }
}
