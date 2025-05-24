import { CloudflareEnv, LogEntry, LogLevel, RequestMetadata, RetryAttempt } from '../types'

export class Logger {
  private logLevel: LogLevel
  private enableDetailedLogging: boolean

  constructor(private env: CloudflareEnv) {
    this.logLevel = (env.LOG_LEVEL as LogLevel) || 'info'
    this.enableDetailedLogging = env.ENABLE_DETAILED_LOGGING === 'true'
  }

  log(level: LogLevel, message: string, metadata?: Record<string, any>, error?: Error, duration?: number): void {
    if (!this.shouldLog(level)) {
      return
    }

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      requestId: metadata?.requestId || 'unknown',
      message,
      metadata: this.enableDetailedLogging ? metadata : this.sanitizeMetadata(metadata),
      error,
      duration
    }

    this.writeLog(entry)
  }

  logRequest(requestId: string, method: string, url: string, metadata?: RequestMetadata): void {
    this.log('info', 'Request started', {
      requestId,
      method,
      url,
      userId: metadata?.userId,
      clientId: metadata?.clientId,
      region: metadata?.region,
      customTags: metadata?.customTags
    })
  }

  logResponse(requestId: string, statusCode: number, duration: number, provider?: string): void {
    this.log('info', 'Request completed', {
      requestId,
      statusCode,
      duration,
      provider
    })
  }

  logRetryAttempt(requestId: string, attempt: RetryAttempt, totalRetries: number): void {
    this.log('warn', 'Retry attempt', {
      requestId,
      attemptNumber: attempt.attemptNumber,
      totalRetries,
      delayMs: attempt.delayMs,
      error: attempt.error?.message,
      timestamp: attempt.timestamp
    })
  }

  logProviderError(requestId: string, provider: string, error: Error, context?: Record<string, any>): void {
    this.log('error', 'Provider request failed', {
      requestId,
      provider,
      errorMessage: error.message,
      errorStack: this.enableDetailedLogging ? error.stack : undefined,
      ...context
    }, error)
  }

  logAuthenticationEvent(requestId: string, event: string, success: boolean, details?: Record<string, any>): void {
    this.log(success ? 'info' : 'warn', `Authentication ${event}`, {
      requestId,
      event,
      success,
      ...details
    })
  }

  logPerformanceMetric(requestId: string, metric: string, value: number, unit: string): void {
    this.log('info', 'Performance metric', {
      requestId,
      metric,
      value,
      unit
    })
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.logLevel)
    const messageLevelIndex = levels.indexOf(level)
    
    return messageLevelIndex >= currentLevelIndex
  }

  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined

    const sanitized: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(metadata)) {
      // Remove sensitive fields
      if (this.isSensitiveField(key)) {
        sanitized[key] = '[REDACTED]'
      } else if (typeof value === 'string' && value.length > 100) {
        // Truncate long strings
        sanitized[key] = value.substring(0, 100) + '...'
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }

  private isSensitiveField(fieldName: string): boolean {
    const sensitivePatterns = [
      /api.*key/i,
      /password/i,
      /secret/i,
      /token/i,
      /auth/i,
      /credential/i
    ]

    return sensitivePatterns.some(pattern => pattern.test(fieldName))
  }

  private writeLog(entry: LogEntry): void {
    const logObject = {
      timestamp: new Date(entry.timestamp).toISOString(),
      level: entry.level.toUpperCase(),
      requestId: entry.requestId,
      message: entry.message,
      ...(entry.metadata && { metadata: entry.metadata }),
      ...(entry.error && { 
        error: {
          message: entry.error.message,
          stack: this.enableDetailedLogging ? entry.error.stack : undefined
        }
      }),
      ...(entry.duration && { duration: `${entry.duration}ms` })
    }

    // Use console methods based on log level
    switch (entry.level) {
      case 'debug':
        console.debug(JSON.stringify(logObject))
        break
      case 'info':
        console.info(JSON.stringify(logObject))
        break
      case 'warn':
        console.warn(JSON.stringify(logObject))
        break
      case 'error':
        console.error(JSON.stringify(logObject))
        break
    }
  }

  // Utility method to create a child logger with additional context
  createChild(additionalMetadata: Record<string, any>): ChildLogger {
    return new ChildLogger(this, additionalMetadata)
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private additionalMetadata: Record<string, any>
  ) {}

  log(level: LogLevel, message: string, metadata?: Record<string, any>, error?: Error, duration?: number): void {
    const combinedMetadata = {
      ...this.additionalMetadata,
      ...metadata
    }
    this.parent.log(level, message, combinedMetadata, error, duration)
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata)
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata)
  }

  error(message: string, metadata?: Record<string, any>, error?: Error): void {
    this.log('error', message, metadata, error)
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata)
  }
}
