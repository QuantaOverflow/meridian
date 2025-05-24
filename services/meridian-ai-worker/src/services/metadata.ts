import { RequestMetadata, AuthenticationConfig } from '../types'

export class MetadataService {
  /**
   * Creates comprehensive request metadata
   */
  createRequestMetadata(
    request: Request,
    authConfig?: AuthenticationConfig,
    additionalMetadata?: Partial<RequestMetadata>
  ): RequestMetadata {
    const timestamp = Date.now()
    const requestId = authConfig?.requestId || this.generateRequestId()
    
    return {
      requestId,
      timestamp,
      userId: this.extractUserId(request),
      clientId: authConfig?.clientId,
      userAgent: request.headers.get('User-Agent') || undefined,
      ipAddress: this.extractClientIP(request),
      region: this.extractRegion(request),
      source: {
        origin: request.headers.get('Origin') || undefined,
        userAgent: request.headers.get('User-Agent') || undefined,
        ip: this.extractClientIP(request)
      },
      cloudflare: this.extractCloudflareHeaders(request),
      headers: this.extractSafeHeaders(request),
      customTags: {
        ...this.extractCustomTags(request),
        ...additionalMetadata?.customTags
      },
      traceId: this.extractTraceId(request),
      spanId: this.generateSpanId(),
      ...additionalMetadata
    }
  }

  /**
   * Enriches metadata with processing information
   */
  enrichWithProcessingInfo(
    metadata: RequestMetadata,
    processingInfo: {
      provider: string
      model: string
      capability?: string
      startTime?: number
      endTime?: number
    }
  ): RequestMetadata {
    const processing = {
      provider: processingInfo.provider,
      model: processingInfo.model,
      capability: processingInfo.capability,
      startTime: processingInfo.startTime,
      ...(processingInfo.endTime && processingInfo.startTime && {
        duration: processingInfo.endTime - processingInfo.startTime
      })
    }
    
    return {
      ...metadata,
      processing
    }
  }

  /**
   * Creates metadata for tracking provider fallback
   */
  createFallbackMetadata(
    originalMetadata: RequestMetadata,
    failedProvider: string,
    fallbackProvider: string,
    reason: string
  ): RequestMetadata {
    return {
      ...originalMetadata,
      customTags: {
        ...originalMetadata.customTags,
        fallbackInitiated: 'true',
        originalProvider: failedProvider,
        fallbackProvider,
        fallbackReason: reason,
        fallbackTimestamp: Date.now().toString()
      }
    }
  }

  /**
   * Adds performance metrics to metadata
   */
  addPerformanceMetrics(
    metadata: RequestMetadata,
    performanceMetrics: RequestMetadata['performance']
  ): RequestMetadata {
    return {
      ...metadata,
      performance: performanceMetrics
    }
  }

  /**
   * Creates error tracking metadata
   */
  createErrorMetadata(
    originalMetadata: RequestMetadata,
    error: Error,
    context: {
      provider?: string
      retryAttempt?: number
      errorCategory?: string
    }
  ): RequestMetadata {
    return {
      ...originalMetadata,
      customTags: {
        ...originalMetadata.customTags,
        errorOccurred: 'true',
        errorMessage: error.message,
        errorName: error.name,
        errorTimestamp: Date.now().toString(),
        errorProvider: context.provider || '',
        errorRetryAttempt: context.retryAttempt?.toString() || '',
        errorCategory: context.errorCategory || this.categorizeError(error)
      }
    }
  }

  /**
   * Enriches metadata with authentication information
   */
  enrichWithAuthInfo(
    metadata: RequestMetadata,
    authResult: {
      isValid: boolean
      authConfig?: any
      apiKeyHash?: string
      errors: string[]
    }
  ): RequestMetadata {
    return {
      ...metadata,
      auth: {
        authenticated: authResult.isValid,
        userId: authResult.authConfig?.clientId,
        apiKeyUsed: !!authResult.authConfig?.apiKey,
        apiKeyHash: authResult.apiKeyHash,
        errors: authResult.errors
      }
    }
  }

  /**
   * Adds error information to metadata
   */
  addErrorInfo(
    metadata: RequestMetadata,
    errorInfo: {
      type: string
      message: string
      statusCode?: number
      retryable?: boolean
      code?: number
      retryAttempts?: number
    }
  ): RequestMetadata {
    return {
      ...metadata,
      error: errorInfo
    }
  }

  /**
   * Enriches metadata with custom data while sanitizing sensitive fields
   */
  enrichWithCustomData(
    metadata: RequestMetadata,
    customData: Record<string, any>
  ): RequestMetadata {
    const sanitizedCustomData: Record<string, any> = {}
    
    for (const [key, value] of Object.entries(customData)) {
      if (this.isSensitiveTag(key)) {
        sanitizedCustomData[key] = '[REDACTED]'
      } else {
        sanitizedCustomData[key] = value
      }
    }

    return {
      ...metadata,
      customTags: {
        ...metadata.customTags,
        ...sanitizedCustomData
      }
    }
  }

  /**
   * Extracts and sanitizes metadata for logging
   */
  sanitizeForLogging(metadata: RequestMetadata): Record<string, any> {
    const sanitized = { ...metadata }
    
    // Remove or redact sensitive information
    if (sanitized.customTags) {
      const cleanTags: Record<string, string> = {}
      for (const [key, value] of Object.entries(sanitized.customTags)) {
        if (this.isSensitiveTag(key)) {
          cleanTags[key] = '[REDACTED]'
        } else {
          cleanTags[key] = value
        }
      }
      sanitized.customTags = cleanTags
    }

    // Redact sensitive IDs partially
    if (sanitized.userId) {
      sanitized.userId = this.partiallyRedact(sanitized.userId)
    }

    return sanitized
  }

  /**
   * Creates Cloudflare-specific headers for AI Gateway
   */
  createCloudflareHeaders(metadata: RequestMetadata): Record<string, string> {
    const headers: Record<string, string> = {
      'cf-aig-cache-ttl': '3600',
      'cf-request-id': metadata.requestId
    }

    if (metadata.traceId) {
      headers['cf-trace-id'] = metadata.traceId
    }

    if (metadata.userId) {
      headers['cf-user-id'] = metadata.userId
    }

    if (metadata.region) {
      headers['cf-region'] = metadata.region
    }

    // Add custom tags as headers (with cf-custom- prefix)
    if (metadata.customTags) {
      for (const [key, value] of Object.entries(metadata.customTags)) {
        if (!this.isSensitiveTag(key) && value) {
          headers[`cf-custom-${key.toLowerCase()}`] = value
        }
      }
    }

    return headers
  }

  private extractUserId(request: Request): string | undefined {
    return request.headers.get('X-User-ID') || 
           request.headers.get('x-user-id') ||
           undefined
  }

  private extractClientIP(request: Request): string | undefined {
    // Try different headers for client IP
    return request.headers.get('CF-Connecting-IP') ||
           request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
           request.headers.get('X-Real-IP') ||
           undefined
  }

  private extractRegion(request: Request): string | undefined {
    return request.headers.get('CF-Ray')?.split('-')[1] ||
           request.headers.get('CF-IPCountry') ||
           undefined
  }

  private extractCustomTags(request: Request): Record<string, string> {
    const tags: Record<string, string> = {}
    
    // Extract headers starting with X-Tag-
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase().startsWith('x-tag-')) {
        const tagName = key.substring(6) // Remove 'x-tag-' prefix
        tags[tagName] = value
      }
    }

    return tags
  }

  private extractTraceId(request: Request): string | undefined {
    return request.headers.get('X-Trace-ID') ||
           request.headers.get('traceparent')?.split('-')[1] ||
           undefined
  }

  private generateRequestId(): string {
    // Generate ID with format req_[16 chars] as expected by tests
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = 'req_'
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 18)
  }

  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase()
    const name = error.name.toLowerCase()

    if (message.includes('timeout') || name.includes('timeout')) {
      return 'timeout'
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'network'
    }
    if (message.includes('unauthorized') || message.includes('forbidden')) {
      return 'authentication'
    }
    if (message.includes('rate limit') || message.includes('too many')) {
      return 'rate_limit'
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation'
    }
    
    return 'unknown'
  }

  private isSensitiveTag(tagName: string): boolean {
    const sensitivePatterns = [
      /api.*key/i,
      /password/i,
      /secret/i,
      /token/i,
      /credential/i,
      /auth/i
    ]

    return sensitivePatterns.some(pattern => pattern.test(tagName))
  }

  private partiallyRedact(value: string): string {
    if (value.length <= 8) {
      return value.substring(0, 2) + '***'
    }
    return value.substring(0, 4) + '***' + value.substring(value.length - 4)
  }

  private extractCloudflareHeaders(request: Request): RequestMetadata['cloudflare'] {
    const cfHeaders = {
      country: request.headers.get('CF-IPCountry') || undefined,
      region: request.headers.get('CF-Region') || undefined,
      colo: request.headers.get('CF-Colo') || undefined,
      ray: request.headers.get('CF-Ray') || undefined,
      visitor: request.headers.get('CF-Visitor') || undefined,
      worker: request.headers.get('CF-Worker') || undefined
    }

    // Only return if at least one Cloudflare header is present
    const hasCloudflareData = Object.values(cfHeaders).some(value => value !== undefined)
    return hasCloudflareData ? cfHeaders : undefined
  }

  private extractSafeHeaders(request: Request): Record<string, string> {
    const safeHeaders: Record<string, string> = {}
    const safeHeaderNames = [
      'content-type',
      'content-length', 
      'accept',
      'accept-encoding',
      'accept-language',
      'cache-control',
      'user-agent'
    ]
    
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase()
      if (safeHeaderNames.includes(lowerKey) && !this.isSensitiveHeader(lowerKey)) {
        safeHeaders[lowerKey] = value
      }
    }
    
    return safeHeaders
  }

  private isSensitiveHeader(headerName: string): boolean {
    const sensitivePatterns = [
      /authorization/i,
      /api.*key/i,
      /secret/i,
      /token/i,
      /password/i,
      /auth/i,
      /credential/i
    ]
    return sensitivePatterns.some(pattern => pattern.test(headerName))
  }
}
