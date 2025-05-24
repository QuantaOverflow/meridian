import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryService } from '../src/services/retry';
import { Logger } from '../src/services/logger';

describe('RetryService', () => {
  let retryService: RetryService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      logRetryAttempt: vi.fn(),
      logRequest: vi.fn(),
      logResponse: vi.fn(),
      logProviderError: vi.fn(),
      logAuthenticationEvent: vi.fn(),
      logPerformanceMetric: vi.fn(),
      createChild: vi.fn().mockReturnValue({
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    } as any;

    retryService = new RetryService(mockLogger);
  });

  describe('Exponential Backoff', () => {
    it('should calculate correct delay for first retry', () => {
      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: false
      };

      const delay = (retryService as any).calculateDelay(1, config);
      
      expect(delay).toBe(1000); // baseDelay * (backoffFactor ^ 0)
    });

    it('should calculate correct delay for second retry', () => {
      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: false
      };

      const delay = (retryService as any).calculateDelay(2, config);
      
      expect(delay).toBe(2000); // baseDelay * (backoffFactor ^ 1)
    });

    it('should respect maximum delay limit', () => {
      const config = {
        maxAttempts: 10,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffFactor: 2,
        jitter: false
      };

      const delay = (retryService as any).calculateDelay(10, config);
      
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it('should add jitter when enabled', () => {
      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: true
      };

      const delay1 = (retryService as any).calculateDelay(1, config);
      const delay2 = (retryService as any).calculateDelay(1, config);
      
      // With jitter, delays should be different
      expect(delay1).not.toBe(delay2);
      expect(delay1).toBeGreaterThanOrEqual(500); // At least 50% of base delay
      expect(delay1).toBeLessThanOrEqual(1000); // At most 100% of base delay
    });
  });

  describe('Retry Logic', () => {
    it('should succeed on first attempt if operation succeeds', async () => {
      const successfulOperation = vi.fn().mockResolvedValue('success');
      
      const result = await retryService.executeWithRetry(
        'test-request-id',
        successfulOperation,
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffFactor: 2,
          jitter: false
        }
      );

      expect(result.result).toBe('success');
      expect(result.attempts).toHaveLength(0); // No retry attempts needed on first success
      expect(successfulOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockResolvedValue('success');

      const result = await retryService.executeWithRetry(
        'test-request-id',
        failingOperation,
        {
          maxAttempts: 3,
          baseDelay: 10, // Small delay for test speed
          maxDelay: 100,
          backoffFactor: 2,
          jitter: false
        }
      );

      expect(result.result).toBe('success');
      expect(result.attempts).toHaveLength(2); // Two failed attempts before success
      expect(failingOperation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValue(new Error('401 Unauthorized'));

      await expect(
        retryService.executeWithRetry(
          'test-request-id',
          failingOperation,
          {
            maxAttempts: 3,
            baseDelay: 10,
            maxDelay: 100,
            backoffFactor: 2,
            jitter: false
          }
        )
      ).rejects.toThrow('401 Unauthorized');

      expect(failingOperation).toHaveBeenCalledTimes(1);
    });

    it('should exhaust all retry attempts', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValue(new Error('503 Service Unavailable'));

      await expect(
        retryService.executeWithRetry(
          'test-request-id',
          failingOperation,
          {
            maxAttempts: 3,
            baseDelay: 10,
            maxDelay: 100,
            backoffFactor: 2,
            jitter: false
          }
        )
      ).rejects.toThrow('503 Service Unavailable');

      expect(failingOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Classification', () => {
    it('should identify retryable HTTP errors', () => {
      const retryableErrors = [
        new Error('500 Internal Server Error'),
        new Error('502 Bad Gateway'), 
        new Error('503 Service Unavailable'),
        new Error('504 Gateway Timeout'),
        new Error('429 Too Many Requests')
      ];

      retryableErrors.forEach(error => {
        expect(retryService.isErrorRetryable(error)).toBe(true);
      });
    });

    it('should identify non-retryable HTTP errors', () => {
      const nonRetryableErrors = [
        new Error('400 Bad Request'),
        new Error('401 Unauthorized'),
        new Error('403 Forbidden'),
        new Error('404 Not Found'),
        new Error('422 Unprocessable Entity')
      ];

      nonRetryableErrors.forEach(error => {
        expect(retryService.isErrorRetryable(error)).toBe(false);
      });
    });

    it('should identify retryable network errors', () => {
      const networkErrors = [
        new Error('ECONNRESET'),
        new Error('ETIMEDOUT'),
        new Error('ENOTFOUND'),
        new Error('ECONNREFUSED')
      ];

      networkErrors.forEach(error => {
        expect(retryService.isErrorRetryable(error)).toBe(true);
      });
    });
  });

  describe('Retry Configuration', () => {
    it('should use default configuration when not provided', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await retryService.executeWithRetry(
        'test-request-id',
        operation
      );

      expect(result.result).toBe('success');
      expect(result.attempts).toHaveLength(0); // No retry attempts needed on first success
    });

    it('should merge partial configuration with defaults', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await retryService.executeWithRetry(
        'test-request-id',
        operation,
        { maxAttempts: 5 } // Only override maxAttempts
      );

      expect(result.result).toBe('success');
      expect(result.attempts).toHaveLength(0); // No retry attempts needed on first success
    });

    it('should validate configuration parameters', () => {
      const invalidConfigs = [
        { maxAttempts: 0 },
        { maxAttempts: -1 },
        { baseDelay: -100 },
        { maxDelay: -1000 },
        { backoffFactor: 0 },
        { backoffFactor: -1 }
      ];

      invalidConfigs.forEach(config => {
        expect(() => {
          (retryService as any).validateConfig(config);
        }).toThrow();
      });
    });
  });

  describe('Logging', () => {
    it('should log retry attempts', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValue('success');

      await retryService.executeWithRetry(
        'test-request-id',
        failingOperation,
        {
          maxAttempts: 2,
          baseDelay: 10,
          maxDelay: 100,
          backoffFactor: 2,
          jitter: false
        }
      );

      expect(mockLogger.logRetryAttempt).toHaveBeenCalledWith(
        'test-request-id',
        expect.objectContaining({
          attemptNumber: 1,
          delayMs: expect.any(Number),
          error: expect.objectContaining({
            message: '503 Service Unavailable'
          })
        }),
        1 // maxRetries (maxAttempts - 1)
      );
    });

    it('should log successful retry completion', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValue('success');

      await retryService.executeWithRetry(
        'test-request-id',
        failingOperation,
        {
          maxAttempts: 2,
          baseDelay: 10,
          maxDelay: 100,
          backoffFactor: 2,
          jitter: false
        }
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Operation succeeded after retries'),
        expect.objectContaining({
          requestId: 'test-request-id',
          totalAttempts: 2
        })
      );
    });

    it('should log retry exhaustion', async () => {
      const failingOperation = vi.fn()
        .mockRejectedValue(new Error('503 Service Unavailable'));

      try {
        await retryService.executeWithRetry(
          'test-request-id',
          failingOperation,
          {
            maxAttempts: 2,
            baseDelay: 10,
            maxDelay: 100,
            backoffFactor: 2,
            jitter: false
          }
        );
      } catch (error) {
        // Expected to fail
      }

      expect(mockLogger.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Operation failed after all retries exhausted'),
        expect.objectContaining({
          requestId: 'test-request-id',
          totalAttempts: 2
        })
      );
    });
  });

  describe('Performance', () => {
    it('should complete retries within reasonable time', async () => {
      const startTime = Date.now();
      
      const failingOperation = vi.fn()
        .mockRejectedValue(new Error('503 Service Unavailable'));

      try {
        await retryService.executeWithRetry(
          'test-request-id',
          failingOperation,
          {
            maxAttempts: 3,
            baseDelay: 10,
            maxDelay: 50,
            backoffFactor: 2,
            jitter: false
          }
        );
      } catch (error) {
        // Expected to fail
      }

      const elapsed = Date.now() - startTime;
      
      // Should complete in reasonable time (base delays: 10 + 20 + 40 = 70ms + operation time)
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle concurrent retry operations', async () => {
      const operations = Array.from({ length: 10 }, (_, i) => 
        vi.fn().mockResolvedValue(`result-${i}`)
      );

      const promises = operations.map((operation, i) =>
        retryService.executeWithRetry(
          `test-request-${i}`,
          operation,
          {
            maxAttempts: 1,
            baseDelay: 10,
            maxDelay: 100,
            backoffFactor: 2,
            jitter: false
          }
        )
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.result).toBe(`result-${i}`);
        expect(result.attempts).toHaveLength(0); // No retry attempts needed on first success
      });
    });
  });
});
