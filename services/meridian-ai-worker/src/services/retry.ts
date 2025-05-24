import { RetryConfig, RetryAttempt } from '../types'
import { Logger } from './logger'

export class RetryService {
  private defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    exponentialBase: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: [
      'TIMEOUT',
      'NETWORK_ERROR', 
      'CONNECTION_RESET',
      'ECONNRESET',
      'ENOTFOUND',
      'EAI_AGAIN'
    ]
  }

  constructor(private logger: Logger, defaultConfig?: Partial<RetryConfig>) {
    if (defaultConfig) {
      this.defaultConfig = { ...this.defaultConfig, ...defaultConfig }
    }
  }

  /**
   * Executes a function with retry logic using exponential backoff
   */
  async executeWithRetry<T>(
    requestId: string,
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<{ result: T; attempts: RetryAttempt[] }> {
    // Validate configuration if provided
    if (config) {
      this.validateConfig(config)
    }
    
    const retryConfig = { ...this.defaultConfig, ...config }
    // Support both maxRetries and maxAttempts for backward compatibility
    const maxRetries = retryConfig.maxAttempts ? retryConfig.maxAttempts - 1 : retryConfig.maxRetries
    const attempts: RetryAttempt[] = []
    let lastError: Error = new Error('No attempts made')

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const attemptStartTime = Date.now()
      
      try {
        const result = await operation()
        
        if (attempt > 1) {
          this.logger.log('info', 'Operation succeeded after retries', {
            requestId,
            totalAttempts: attempt,
            successfulAttempt: attempt
          })
        }
        
        return { result, attempts }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        const attemptRecord: RetryAttempt = {
          attemptNumber: attempt,
          delayMs: 0,
          error: lastError,
          timestamp: attemptStartTime
        }
        
        attempts.push(attemptRecord)

        // Check if this is the last attempt
        if (attempt > maxRetries) {
          this.logger.log('error', 'Operation failed after all retries exhausted', {
            requestId,
            totalAttempts: attempt,
            finalError: lastError.message,
            allAttempts: attempts.map(a => ({
              attempt: a.attemptNumber,
              error: a.error?.message,
              delayMs: a.delayMs
            }))
          })
          break
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError, retryConfig)) {
          this.logger.log('warn', 'Non-retryable error encountered', {
            requestId,
            attempt,
            error: lastError.message,
            errorType: this.getErrorType(lastError)
          })
          break
        }

        // Calculate delay for next attempt
        const delayMs = this.calculateDelay(attempt, retryConfig)
        attemptRecord.delayMs = delayMs

        this.logger.logRetryAttempt(requestId, attemptRecord, maxRetries)

        // Wait before next attempt
        await this.delay(delayMs)
      }
    }

    // If we get here, all retries have been exhausted
    throw new RetryExhaustedError(
      `Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`,
      attempts,
      lastError
    )
  }

  /**
   * Determines if an error is retryable based on configuration
   */
  private isRetryableError(error: Error, config: RetryConfig): boolean {
    // Check if error message contains retryable patterns
    const errorMessage = error.message.toLowerCase()
    const retryableErrors = config.retryableErrors || this.defaultConfig?.retryableErrors || []
    
    for (const retryableError of retryableErrors) {
      if (errorMessage.includes(retryableError.toLowerCase())) {
        return true
      }
    }

    // Check for HTTP status codes in error message (both fetch errors and regular errors)
    const statusCode = this.extractStatusCode(error)
    if (statusCode && (config.retryableStatusCodes || this.defaultConfig?.retryableStatusCodes || []).includes(statusCode)) {
      return true
    }

    // Check for specific error types
    return this.isNetworkError(error) || this.isTimeoutError(error)
  }

  /**
   * Public method to check if an error is retryable (for testing)
   */
  public isErrorRetryable(error: Error, config?: Partial<RetryConfig>): boolean {
    const retryConfig = { ...this.defaultConfig, ...config }
    return this.isRetryableError(error, retryConfig)
  }

  /**
   * Calculates delay for next retry attempt using exponential backoff with jitter
   */
  private calculateDelay(attemptNumber: number, config: RetryConfig): number {
    // Support both old and new config property names for backward compatibility
    // Use the new property names first, then fall back to old ones, then defaults
    const baseDelayMs = config.baseDelay !== undefined ? config.baseDelay : 
                       config.baseDelayMs !== undefined ? config.baseDelayMs : 
                       this.defaultConfig.baseDelayMs || 1000
    const exponentialBase = config.backoffFactor !== undefined ? config.backoffFactor :
                           config.exponentialBase !== undefined ? config.exponentialBase :
                           this.defaultConfig.exponentialBase || 2
    const maxDelayMs = config.maxDelay !== undefined ? config.maxDelay :
                      config.maxDelayMs !== undefined ? config.maxDelayMs :
                      this.defaultConfig.maxDelayMs || 30000
    const enableJitter = config.jitter !== undefined ? config.jitter : true
    
    const exponentialDelay = baseDelayMs * Math.pow(exponentialBase, attemptNumber - 1)
    
    let finalDelay = exponentialDelay
    
    // Add jitter if enabled (keep result between 50%-100% of base delay)
    if (enableJitter) {
      // For first attempt, use base delay range with jitter
      if (attemptNumber === 1) {
        const jitterRange = baseDelayMs * 0.5 // 50% of base delay
        const minDelay = baseDelayMs * 0.5   // 50% of base delay
        finalDelay = minDelay + Math.random() * jitterRange
      } else {
        // For subsequent attempts, apply jitter to exponential delay but cap at reasonable bounds
        const jitterRange = exponentialDelay * 0.1 // ±10% jitter for exponential delays
        const jitter = (Math.random() - 0.5) * 2 * jitterRange
        finalDelay = exponentialDelay + jitter
      }
    }
    
    // Cap at maximum delay and ensure minimum of 0
    return Math.max(0, Math.min(finalDelay, maxDelayMs))
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private isFetchError(error: Error): boolean {
    return error.name === 'TypeError' && error.message.includes('fetch')
  }

  private extractStatusCode(error: Error): number | null {
    const match = error.message.match(/(\d{3})/)
    return match ? parseInt(match[1], 10) : null
  }

  private isNetworkError(error: Error): boolean {
    const networkErrorPatterns = [
      /network/i,
      /connection/i,
      /timeout/i,
      /econnreset/i,
      /econnrefused/i,
      /etimedout/i,
      /enotfound/i,
      /eai_again/i
    ]
    
    return networkErrorPatterns.some(pattern => 
      pattern.test(error.message) || pattern.test(error.name)
    )
  }

  private isTimeoutError(error: Error): boolean {
    return error.name === 'AbortError' || 
           error.message.toLowerCase().includes('timeout') ||
           error.message.toLowerCase().includes('aborted')
  }

  private getErrorType(error: Error): string {
    if (this.isTimeoutError(error)) return 'TIMEOUT'
    if (this.isNetworkError(error)) return 'NETWORK'
    if (this.isFetchError(error)) return 'FETCH'
    return 'UNKNOWN'
  }

  /**
   * Validates retry configuration parameters
   */
  private validateConfig(config: Partial<RetryConfig>): void {
    if (config.maxAttempts !== undefined && config.maxAttempts <= 0) {
      throw new Error('maxAttempts must be greater than 0')
    }
    
    if (config.maxRetries !== undefined && config.maxRetries < 0) {
      throw new Error('maxRetries must be non-negative')
    }
    
    if (config.baseDelay !== undefined && config.baseDelay < 0) {
      throw new Error('baseDelay must be non-negative')
    }
    
    if (config.baseDelayMs !== undefined && config.baseDelayMs < 0) {
      throw new Error('baseDelayMs must be non-negative')
    }
    
    if (config.maxDelay !== undefined && config.maxDelay < 0) {
      throw new Error('maxDelay must be non-negative')
    }
    
    if (config.maxDelayMs !== undefined && config.maxDelayMs < 0) {
      throw new Error('maxDelayMs must be non-negative')
    }
    
    if (config.backoffFactor !== undefined && config.backoffFactor <= 0) {
      throw new Error('backoffFactor must be greater than 0')
    }
    
    if (config.exponentialBase !== undefined && config.exponentialBase <= 0) {
      throw new Error('exponentialBase must be greater than 0')
    }
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: RetryAttempt[],
    public readonly lastError: Error
  ) {
    super(message)
    this.name = 'RetryExhaustedError'
  }
}

/**
 * Utility function to create retry configuration from environment variables
 */
export function createRetryConfigFromEnv(env: Record<string, string | undefined>): Partial<RetryConfig> {
  const config: Partial<RetryConfig> = {}

  if (env.DEFAULT_MAX_RETRIES) {
    const maxRetries = parseInt(env.DEFAULT_MAX_RETRIES, 10)
    if (!isNaN(maxRetries)) {
      config.maxRetries = maxRetries
    }
  }

  if (env.DEFAULT_RETRY_DELAY_MS) {
    const baseDelayMs = parseInt(env.DEFAULT_RETRY_DELAY_MS, 10)
    if (!isNaN(baseDelayMs)) {
      config.baseDelayMs = baseDelayMs
    }
  }

  return config
}
