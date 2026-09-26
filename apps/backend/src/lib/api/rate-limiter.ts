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
 * 跑在 Workflow 的 run() 里，所以调度必须**确定**：只由输入的 items 决定，不读实时时钟、
 * 不靠跨 step 存活的内存状态（Workflow 休眠醒来会清空内存、重放 run()）。做法是用一个
 * 模拟时钟排出分轮计划——每轮之后固定 sleep globalCooldownMs，同一域名两次访问之间在模拟时钟上
 * 至少隔 domainCooldownMs。真实时间 = 模拟时间 + 处理耗时，所以真实间隔只会更长，不会更短。
 * sleep 的 step 名带轮次序号（不带实时算出的秒数），同一输入重放时名字逐个相同、互不重复。
 *
 * @template T Type of the batch items, must extend BatchItem
 * @template I Type of the ID field, defaults to number | string
 */
export class DomainRateLimiter<T extends BatchItem<I>, I = number | string> {
  private options: RateLimiterOptions;
  private logger: Logger;

  /**
   * Creates a new DomainRateLimiter instance
   *
   * @param options Configuration options for throttling
   */
  constructor(options: RateLimiterOptions) {
    this.options = options;
    this.logger = new Logger({ component: 'DomainRateLimiter' });
  }

  /**
   * Processes a batch of items with domain-aware rate limiting
   *
   * @param items Array of items to process（URL 非法的跳过）
   * @param step Workflow step instance for handling sleeps/delays
   * @param processItem Function that processes a single item and returns a result
   * @returns 按处理顺序排列的结果；processItem 抛错的 item 不进结果（错误已记日志）
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
    const remaining: Array<{ item: T; domain: string }> = [];
    for (const item of items) {
      try {
        remaining.push({ item, domain: new URL(item.url).hostname });
      } catch {
        batchLogger.warn('Skipping item with invalid URL', { item_id: item.id });
      }
    }

    // 模拟时钟：只由已排的 sleep 推进
    const lastAccess = new Map<string, number>();
    let clock = 0;
    let round = 0;

    while (remaining.length > 0) {
      const currentBatch: Array<{ item: T; domain: string }> = [];
      for (let i = 0; i < remaining.length && currentBatch.length < this.options.maxConcurrent; ) {
        const { domain } = remaining[i];
        const last = lastAccess.get(domain);
        if (last === undefined || clock - last >= this.options.domainCooldownMs) {
          // 选中即记访问时间：同一域名的多篇不会进同一轮
          lastAccess.set(domain, clock);
          currentBatch.push(remaining.splice(i, 1)[0]);
        } else {
          i++;
        }
      }

      if (currentBatch.length === 0) {
        // 没有域名冷却完：等到最早的那个冷却完。剩下的每个域名都访问过（否则上面就选中了）
        const wait = Math.min(
          ...remaining.map(({ domain }) => lastAccess.get(domain)! + this.options.domainCooldownMs - clock)
        );
        batchLogger.debug('Waiting for domain cooldown', { wait_time_ms: wait });
        await step.sleep(`domain cooldown before round ${round + 1}`, wait);
        clock += wait;
        continue;
      }

      round++;
      batchLogger.debug('Processing batch', { round, batch_size: currentBatch.length, remaining: remaining.length });

      const batchResults = await Promise.allSettled(
        currentBatch.map(async ({ item, domain }) => {
          try {
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

      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });

      // Apply global cooldown between batches if we have more items to process
      if (remaining.length > 0) {
        batchLogger.debug('Applying global rate limit', { cooldown_ms: this.options.globalCooldownMs });
        await step.sleep(`global rate limit after round ${round}`, this.options.globalCooldownMs);
        clock += this.options.globalCooldownMs;
      }
    }

    batchLogger.info('Batch processing complete', { processed_count: results.length });
    return results;
  }
}
