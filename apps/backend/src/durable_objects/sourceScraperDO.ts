import { $articles, $sources, eq } from '@meridian/database';
import { Env } from '../index';
import { getDb } from '../lib/database';
import { Logger } from '../lib/core/logger';
import { parseRSSFeed } from '../lib/api/parsers';
import { userAgents } from '../lib/core/constants';
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
 * @param operation Function that returns a Promise to execute with retries
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelayMs Initial delay between retries in milliseconds (doubles each retry)
 * @param logger Logger instance to record retry attempts and failures
 * @returns The result or throws the last error
 */
async function attemptWithRetries<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  initialDelayMs: number,
  logger: Logger
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.debug(`Attempt ${attempt}/${maxRetries}...`);
    try {
      const result = await operation();
      logger.debug(`Attempt ${attempt} successful.`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
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
  throw lastError!;
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

    try {
      const sourceExists = await getDb(this.env.HYPERDRIVE).query.$sources.findFirst({ 
        where: (s, { eq }) => eq(s.id, sourceData.id) 
      });
      
      if (!sourceExists) {
        logger.warn(
          "Source doesn't exist in DB. This is likely due to a race condition where the source was deleted after being queued for initialization."
        );
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

      // Update the source's do_initialized_at field
      await getDb(this.env.HYPERDRIVE)
        .update($sources)
        .set({ do_initialized_at: new Date() })
        .where(eq($sources.id, sourceData.id));

      // Only set alarm if state was successfully stored
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      logger.info('Initial alarm set.');
    } catch (error) {
      logger.error('Initialization failed', undefined, error as Error);
      throw error;
    }
  }

  /**
   * Alarm handler that performs the scheduled RSS scraping
   */
  async alarm(): Promise<void> {
    const alarmLogger = this.logger.child({ operation: 'alarm' });
    alarmLogger.info('Alarm triggered');

    try {
      const state = await this.ctx.storage.get<SourceState>('state');
      if (!state) {
        alarmLogger.error('No state found in storage - DO may not be initialized');
        return;
      }

      const validatedState = SourceStateSchema.safeParse(state);
      if (!validatedState.success) {
        alarmLogger.error('State validation failed', { validation_error: validatedState.error });
        return;
      }

      const { sourceId, url, scrapeFrequencyTier, lastChecked } = validatedState.data;
      const interval = tierIntervals[scrapeFrequencyTier] || DEFAULT_INTERVAL;
      const now = Date.now();

      // Schedule next alarm first to ensure continuity
      const nextScheduledAlarmTime = Date.now() + interval;
      await this.ctx.storage.setAlarm(nextScheduledAlarmTime);
      alarmLogger.info('Next regular alarm scheduled', { next_alarm: new Date(nextScheduledAlarmTime).toISOString() });

      // --- Workflow Step 1: Fetch Feed with Retries ---
      const fetchLogger = alarmLogger.child({ step: 'Fetch' });
      const feedText = await attemptWithRetries(
        async () => {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
              Referer: 'https://www.google.com/',
            },
          });
          
          if (!response.ok) {
            throw new Error(`Fetch failed with status: ${response.status} ${response.statusText}`);
          }
          
          return await response.text();
        },
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        fetchLogger
      );

      // --- Workflow Step 2: Parse Feed with Retries ---
      const parseLogger = alarmLogger.child({ step: 'Parse' });
      const articles = await attemptWithRetries(
        async () => parseRSSFeed(feedText),
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        parseLogger
      );

      // --- Filter Articles ---
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
        await attemptWithRetries(
          async () => {
            await getDb(this.env.HYPERDRIVE)
              .update($sources)
              .set({ lastChecked: new Date(now) })
              .where(eq($sources.id, sourceId));
          },
          MAX_STEP_RETRIES,
          INITIAL_RETRY_DELAY_MS,
          sourceUpdateLogger
        );

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
      const insertedRows = await attemptWithRetries(
        async () => {
          return await getDb(this.env.HYPERDRIVE)
            .insert($articles)
            .values(allArticlesToInsert)
            .onConflictDoNothing({ target: $articles.url })
            .returning({ insertedId: $articles.id, insertedUrl: $articles.url });
        },
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        dbLogger
      );

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
      await attemptWithRetries(
        async () => {
          await getDb(this.env.HYPERDRIVE)
            .update($sources)
            .set({ lastChecked: new Date(now) })
            .where(eq($sources.id, sourceId));
        },
        MAX_STEP_RETRIES,
        INITIAL_RETRY_DELAY_MS,
        sourceUpdateLogger
      );

      sourceUpdateLogger.info('Updated source lastChecked in database');
    } catch (error) {
      alarmLogger.error('Alarm processing failed', undefined, error as Error);
    }
  }

  /**
   * HTTP fetch handler for manual operations
   *
   * @param request The incoming HTTP request
   * @returns Response with operation result
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const logger = this.logger.child({ operation: 'fetch', path: url.pathname });

    try {
      if (url.pathname === '/init' && request.method === 'POST') {
        const body = await request.json() as { id: number; url: string; scrape_frequency: number };
        await this.initialize(body);
        return new Response(JSON.stringify({ success: true, message: 'Initialized successfully' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/force-scrape' && request.method === 'POST') {
        await this.alarm();
        return new Response(JSON.stringify({ success: true, message: 'Scrape triggered' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/status' && request.method === 'GET') {
        const state = await this.ctx.storage.get<SourceState>('state');
        return new Response(JSON.stringify({ success: true, state }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Fetch handler error', undefined, error as Error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Cleanup method called when the DO is being destroyed
   */
  async destroy() {
    this.logger.info('DO being destroyed');
  }
}
