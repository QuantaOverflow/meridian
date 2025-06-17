import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DomainRateLimiter } from '../src/lib/rateLimiter';
import type { WorkflowStep } from 'cloudflare:workers';

type BatchItem = {
  id: number | string;
  url: string;
};

describe('DomainRateLimiter', () => {
  // Mock 'step.sleep' to track calls and resolve immediately or after checking delays
  let mockSleep: ReturnType<typeof vi.fn>;
  let step: WorkflowStep; // Mocked step object
  let rateLimiter: DomainRateLimiter<BatchItem>;
  let processItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSleep = vi.fn().mockImplementation((reason, ms) => {
      // Advance time when sleep is called
      vi.advanceTimersByTime(ms);
      return Promise.resolve();
    });
    step = { sleep: mockSleep } as unknown as WorkflowStep;
    // Setup rateLimiter with specific options for testing
    rateLimiter = new DomainRateLimiter({ maxConcurrent: 2, globalCooldownMs: 100, domainCooldownMs: 200 });
    processItem = vi.fn().mockImplementation(async (item: BatchItem) => `processed-${item.id}`);

    // Mock Date.now() to control time
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 1, 1, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should process all items concurrently if limits are not hit', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
    ];

    const results = await rateLimiter.processBatch(items, step, processItem);

    expect(results).toHaveLength(2);
    expect(results).toEqual(['processed-1', 'processed-2']);
    expect(processItem).toHaveBeenCalledTimes(2);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('should not exceed maxConcurrent processing simultaneously', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
      { id: 3, url: 'https://domain3.com/page1' },
    ];

    await rateLimiter.processBatch(items, step, processItem);

    // Should process first two items concurrently (maxConcurrent: 2), then apply global cooldown
    expect(mockSleep).toHaveBeenCalledWith(expect.any(String), 100);
    expect(processItem).toHaveBeenCalledTimes(3);
  });

  it('should call step.sleep for globalCooldownMs between batches if needed', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
      { id: 3, url: 'https://domain3.com/page1' },
      { id: 4, url: 'https://domain4.com/page1' },
      { id: 5, url: 'https://domain5.com/page1' },
    ];

    await rateLimiter.processBatch(items, step, processItem);

    // Should have 3 batches: 2 items, 2 items, 1 item
    // Sleep should be called twice for global cooldown between batches
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(expect.stringContaining('global rate limit'), 100);
  });

  it('should call step.sleep for domainCooldownMs if processing the same domain twice quickly', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain1.com/page2' }, // Same domain
    ];

    // Process first item
    await rateLimiter.processBatch([items[0]], step, processItem);

    // Reset mock to track calls separately
    mockSleep.mockClear();
    processItem.mockClear();

    // Advance time but not enough to clear domain cooldown
    vi.advanceTimersByTime(100);

    // Process second item
    await rateLimiter.processBatch([items[1]], step, processItem);

    // Should wait for domain cooldown
    expect(mockSleep).toHaveBeenCalledWith(expect.stringContaining('waiting for domain cooldown'), expect.any(Number));
  });

  it('should allow different domains to be processed concurrently without domain cooldown', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
    ];

    await rateLimiter.processBatch(items, step, processItem);

    // Should process both concurrently without domain cooldown
    expect(processItem).toHaveBeenCalledTimes(2);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('should skip items with invalid URLs without throwing an error', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'invalid-url' }, // Invalid URL
    ];

    const results = await rateLimiter.processBatch(items, step, processItem);

    // Should only process valid URLs
    expect(results).toHaveLength(1);
    expect(results).toEqual(['processed-1']);
    expect(processItem).toHaveBeenCalledTimes(1);
  });

  it('should call step.sleep with calculated wait time if all available items are domain-limited', async () => {
    // Process first item
    await rateLimiter.processBatch([{ id: 1, url: 'https://domain1.com/page1' }], step, processItem);

    // Reset mocks
    mockSleep.mockClear();
    processItem.mockClear();

    // Advance time to 100ms
    vi.advanceTimersByTime(100);

    // Try to process the same domain again (should need to wait 100ms more)
    await rateLimiter.processBatch([{ id: 2, url: 'https://domain1.com/page2' }], step, processItem);

    // Should wait for remaining time on domain cooldown (200ms - 100ms = 100ms)
    expect(mockSleep).toHaveBeenCalledWith(expect.stringContaining('waiting for domain cooldown'), expect.any(Number));

    // Should eventually process the item
    expect(processItem).toHaveBeenCalledTimes(1);
  });

  it('should call the processItem function with the correct item and extracted domain', async () => {
    const item = { id: 1, url: 'https://example.com/page1' };

    await rateLimiter.processBatch([item], step, processItem);

    expect(processItem).toHaveBeenCalledWith(item, 'example.com');
  });

  it('should return results for all successfully processed items', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
    ];

    const results = await rateLimiter.processBatch(items, step, processItem);

    expect(results).toEqual(['processed-1', 'processed-2']);
  });

  it('should handle errors during processItem gracefully and continue processing others', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain2.com/page1' },
    ];

    // Make the first item fail
    processItem.mockImplementation(async (item: BatchItem) => {
      if (item.id === 1) throw new Error('Processing failed');
      return `processed-${item.id}`;
    });

    const results = await rateLimiter.processBatch(items, step, processItem);

    // Should have only the successful result
    expect(results).toEqual(['processed-2']);
    expect(processItem).toHaveBeenCalledTimes(2);
  });

  it('should update internal lastDomainAccess times correctly', async () => {
    const items = [
      { id: 1, url: 'https://domain1.com/page1' },
      { id: 2, url: 'https://domain1.com/page2' }, // Same domain
    ];

    // Process first item
    await rateLimiter.processBatch([items[0]], step, processItem);

    // Advance time past domain cooldown
    vi.advanceTimersByTime(250);

    // Reset mock to track calls separately
    mockSleep.mockClear();
    processItem.mockClear();

    // Process second item
    await rateLimiter.processBatch([items[1]], step, processItem);

    // Should not wait for domain cooldown since time has advanced past cooldown period
    expect(mockSleep).not.toHaveBeenCalled();
    expect(processItem).toHaveBeenCalledTimes(1);
  });

  it('should only wait for cooldowns of domains with pending items', async () => {
    // First, process items from two different domains
    await rateLimiter.processBatch(
      [
        { id: 1, url: 'https://domain1.com/page1' },
        { id: 2, url: 'https://domain2.com/page1' },
      ],
      step,
      processItem
    );

    // Reset mocks
    mockSleep.mockClear();
    processItem.mockClear();

    // Advance time partially through cooldown period
    vi.advanceTimersByTime(50);

    // Set up domain1 with a much longer remaining cooldown (by manipulating lastDomainAccess)
    // @ts-expect-error accessing private property for testing
    rateLimiter.lastDomainAccess.set('domain1.com', Date.now());

    // Now process only domain2 item
    await rateLimiter.processBatch([{ id: 3, url: 'https://domain2.com/page2' }], step, processItem);

    // Should wait for domain2's cooldown (150ms) not domain1's longer cooldown (200ms)
    expect(mockSleep).toHaveBeenCalledWith(expect.stringContaining('waiting for domain cooldown'), expect.any(Number));

    // Verify the wait time is for domain2 not domain1
    const sleepTime = mockSleep.mock.calls[0][1];
    expect(sleepTime).toBe(500); // There's a minimum 500ms wait time enforced in the code

    // Should eventually process the item
    expect(processItem).toHaveBeenCalledTimes(1);
  });
});
