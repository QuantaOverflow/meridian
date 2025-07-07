import { WorkflowStep } from 'cloudflare:workers';
import { Logger } from '../core/logger';

/**
 * Configuration options for the rate limiter
 */
type RateLimiterOptions = {
  maxConcurrent: number;
  globalCooldownMs: number;
  domainCooldownMs: number;
};

/**
 * Represents a batch item with an ID and URL
 */
type BatchItem<IdType = number | string> = {
  id: IdType;
  url: string;
};

/**
 * Rate limiter that respects per-domain cooldowns to prevent overloading specific domains
 * when making HTTP requests. Handles batching and throttling of requests.
 *
 * @template T Type of the batch items, must extend BatchItem
 * @template I Type of the ID field, defaults to number | string
 */
export class DomainRateLimiter<T extends BatchItem<I>, I = number | string> {
  private lastDomainAccess = new Map<string, number>();
  private options: RateLimiterOptions;
  private logger: Logger;

  /**
   * Creates a new DomainRateLimiter instance
   *
   * @param options Configuration options for throttling
   */
  constructor(options: RateLimiterOptions) {
    this.options = options;
    this.logger = new Logger({ service: 'DomainRateLimiter' });
  }

  /**
   * Processes a batch of items with domain-aware rate limiting
   *
   * @param items Array of items to process
   * @param step Workflow step instance for handling sleeps/delays
   * @param processItem Function that processes a single item and returns a result
   * @returns Promise resolving to an array of results in the same order as input items
   *
   * @template R The return type of the processItem function
   */
  async processBatch<R>(
    items: T[],
    step: WorkflowStep,
    processItem: (item: T, domain: string) => Promise<R>
  ): Promise<R[]> {
    const batchLogger = this.logger.child({ batch_size: items.length });
    batchLogger.info('Starting batch processing');

    const results: R[] = [];
    const remainingItems = [...items];

    while (remainingItems.length > 0) {
      const currentBatch: T[] = [];
      const currentTime = Date.now();

      // Select items for current batch based on domain cooldown
      for (const item of [...remainingItems]) {
        if (currentBatch.length >= this.options.maxConcurrent) break;

        try {
          const domain = new URL(item.url).hostname;
          const lastAccess = this.lastDomainAccess.get(domain) || 0;

          if (currentTime - lastAccess >= this.options.domainCooldownMs) {
            currentBatch.push(item);
            // Remove from remaining items
            const idx = remainingItems.findIndex(i => i.id === item.id);
            if (idx >= 0) remainingItems.splice(idx, 1);
          }
        } catch (e) {
          // Skip invalid URLs
          const idx = remainingItems.findIndex(i => i.id === item.id);
          if (idx >= 0) remainingItems.splice(idx, 1);
        }
      }

      if (currentBatch.length === 0) {
        // Nothing ready yet, wait for next domain to be ready
        const nextReady = Math.min(
          ...remainingItems
            .map(item => {
              try {
                const domain = new URL(item.url).hostname;
                const lastAccess = this.lastDomainAccess.get(domain) || 0;
                return this.options.domainCooldownMs - (currentTime - lastAccess);
              } catch {
                return Infinity; // Skip invalid URLs
              }
            })
            .filter(time => time > 0) // Only consider positive wait times
        );
        batchLogger.debug('Waiting for domain cooldown', { wait_time_ms: Math.max(500, nextReady) });
        await step.sleep(`waiting for domain cooldown (${Math.round(nextReady / 1000)}s)`, Math.max(500, nextReady));
        continue;
      }

      batchLogger.debug('Processing batch', { batch_size: currentBatch.length, remaining: remainingItems.length });

      // Process current batch in parallel
      const batchResults = await Promise.allSettled(
        currentBatch.map(async item => {
          try {
            const domain = new URL(item.url).hostname;
            this.lastDomainAccess.set(domain, Date.now());
            return await processItem(item, domain);
          } catch (error) {
            const itemLogger = batchLogger.child({ item_id: item.id });
            itemLogger.error(
              'Error processing item',
              undefined,
              error instanceof Error ? error : new Error(String(error))
            );
            throw error;
          }
        })
      );

      // Add results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });

      // Apply global cooldown between batches if we have more items to process
      if (remainingItems.length > 0) {
        batchLogger.debug('Applying global rate limit', { cooldown_ms: this.options.globalCooldownMs });
        await step.sleep(
          `global rate limit (${Math.round(this.options.globalCooldownMs / 1000)}s)`,
          this.options.globalCooldownMs
        );
      }
    }

    batchLogger.info('Batch processing complete', { processed_count: results.length });
    return results;
  }
}
