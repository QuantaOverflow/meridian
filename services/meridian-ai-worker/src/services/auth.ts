import { CloudflareEnv, AuthenticationConfig, LogEntry, LogLevel } from '../types'
import { Logger } from './logger'

export class AuthenticationService {
  private logger: Logger

  constructor(private env: CloudflareEnv) {
    this.logger = new Logger(env)
  }

  /**
   * Validates API key from request headers
   */
  async validateApiKey(request: Request): Promise<boolean> {
    const apiKey = this.extractApiKey(request)
    
    if (!apiKey) {
      this.logger.log('warn', 'Missing API key in request', {
        headers: Object.fromEntries(request.headers.entries()),
        url: request.url
      })
      return false
    }

    // Check against environment secret keys
    const gatewayKeys = this.env.GATEWAY_API_KEYS?.split(',') || []
    const secretKey = this.env.API_SECRET_KEY
    
    // Check if API key matches any of the configured keys
    const isValid = gatewayKeys.includes(apiKey) || (secretKey && apiKey === secretKey)
    
    if (!isValid) {
      this.logger.log('warn', 'Invalid API key provided', {
        providedKey: apiKey.substring(0, 8) + '...',
        url: request.url
      })
      return false
    }

    this.logger.log('info', 'API key validation successful', {
      keyPrefix: apiKey.substring(0, 8) + '...'
    })
    return true
  }

  /**
   * Validates request origin against allowed origins
   */
  async validateOrigin(request: Request): Promise<boolean> {
    const origin = request.headers.get('Origin')
    const allowedOrigins = this.env.ALLOWED_ORIGINS?.split(',') || []

    if (allowedOrigins.length === 0) {
      // No origin restrictions configured
      return true
    }

    if (!origin) {
      // Direct API calls without origin header are allowed
      this.logger.log('warn', 'No origin header in request')
      return true
    }

    const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*')
    
    if (!isAllowed) {
      this.logger.log('warn', 'Origin not allowed', {
        origin,
        allowedOrigins
      })
    }

    return isAllowed
  }

  /**
   * Creates authentication configuration from request
   */
  createAuthConfig(request: Request): AuthenticationConfig {
    const apiKey = this.extractApiKey(request)
    const requestId = this.generateRequestId()
    
    return {
      apiKey,
      requestId,
      clientId: request.headers.get('X-Client-ID') || undefined,
      customHeaders: this.extractCustomHeaders(request)
    }
  }

  /**
   * Validates complete request authentication
   */
  async authenticateRequest(request: Request): Promise<{
    isValid: boolean
    authConfig: AuthenticationConfig
    errors: string[]
  }> {
    const startTime = Date.now()
    const errors: string[] = []
    const authConfig = this.createAuthConfig(request)

    // Validate API key
    const apiKeyValid = await this.validateApiKey(request)
    if (!apiKeyValid) {
      const authHeader = request.headers.get('Authorization')
      const xApiKey = request.headers.get('X-API-Key')
      
      if (!authHeader && !xApiKey) {
        errors.push('Missing or invalid authorization header')
      } else if (authHeader && !authHeader.startsWith('Bearer ')) {
        errors.push('Missing or invalid authorization header')
      } else {
        errors.push('Invalid API key')
      }
    }

    // Validate origin
    const originValid = await this.validateOrigin(request)
    if (!originValid) {
      errors.push('Origin not allowed')
    }

    // Validate request signature if provided
    const signatureValid = this.verifyRequestSignature(request)
    if (!signatureValid) {
      errors.push('Invalid request signature')
    }

    const isValid = errors.length === 0
    const duration = Date.now() - startTime

    this.logger.log(isValid ? 'info' : 'warn', 'Authentication completed', {
      requestId: authConfig.requestId,
      isValid,
      errors,
      duration,
      clientId: authConfig.clientId
    })

    return {
      isValid,
      authConfig,
      errors
    }
  }

  private extractApiKey(request: Request): string | undefined {
    // Try different header formats
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7)
    }

    return request.headers.get('X-API-Key') || 
           request.headers.get('x-api-key') ||
           undefined
  }

  private extractCustomHeaders(request: Request): Record<string, string> {
    const customHeaders: Record<string, string> = {}
    
    // Extract headers starting with X-Custom-
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase().startsWith('x-custom-')) {
        customHeaders[key] = value
      }
    }

    return customHeaders
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Creates CORS headers for response
   */
  createCorsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('Origin')
    const allowedOrigins = this.env.ALLOWED_ORIGINS?.split(',') || ['*']

    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Client-ID, X-Request-Signature',
      'Access-Control-Max-Age': '3600'
    }

    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Credentials'] = 'true'
    } else {
      headers['Access-Control-Allow-Origin'] = '*'
    }

    return headers
  }

  /**
   * Handles preflight OPTIONS requests
   */
  handlePreflightRequest(request: Request): Response {
    const origin = request.headers.get('Origin')
    const allowedOrigins = this.env.ALLOWED_ORIGINS?.split(',') || ['*']
    
    if (origin && !allowedOrigins.includes(origin) && !allowedOrigins.includes('*')) {
      return new Response(null, { status: 403 })
    }

    const corsHeaders = this.createCorsHeaders(request)
    return new Response(null, { 
      status: 200,
      headers: corsHeaders
    })
  }

  /**
   * Adds CORS headers to a response
   */
  addCorsHeaders(response: Response, request: Request): Response {
    const corsHeaders = this.createCorsHeaders(request)
    const newHeaders = new Headers(response.headers)
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value)
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }

  /**
   * Verifies request signature
   */
  private verifyRequestSignature(request: Request): boolean {
    const signature = request.headers.get('X-Request-Signature')
    
    // If no signature provided, skip validation
    if (!signature) {
      return true
    }

    // TODO: Implement signature validation logic
    // This would typically involve HMAC verification
    // For now, we'll just log that signature validation was requested
    this.logger.log('info', 'Signature validation requested but not implemented', {
      signature: signature.substring(0, 16) + '...'
    })

    return true
  }
}
