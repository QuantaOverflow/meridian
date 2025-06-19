/**
 * 配额限制处理器工具类 - 生产环境版本
 */
export class QuotaHandler {
  
  /**
   * 检查是否为配额限制错误
   */
  static isQuotaLimitError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorString = JSON.stringify(error).toLowerCase();
    
    return (
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('resource exhausted') ||
      errorMessage.includes('too many requests') ||
      errorString.includes('quota') ||
      errorString.includes('rate_limit') ||
      errorString.includes('429')
    );
  }

  /**
   * 指数退避重试策略
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // 如果不是配额错误，直接抛出
        if (!this.isQuotaLimitError(error)) {
          throw error;
        }
        
        // 最后一次尝试失败
        if (attempt === maxRetries) {
          console.error(`[Intelligence] 重试 ${maxRetries} 次后仍失败，配额限制错误:`, {
            error: error.message,
            attempt: attempt + 1,
            timestamp: new Date().toISOString()
          });
          throw error;
        }
        
        // 计算延迟时间（指数退避）
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        
        console.warn(`[Intelligence] 配额限制错误，第 ${attempt + 1}/${maxRetries + 1} 次尝试，${delay}ms 后重试:`, {
          error: error.message,
          nextDelay: delay,
          timestamp: new Date().toISOString()
        });
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}

/**
 * 检查是否为配额相关错误
 */
export function isQuotaError(error: any): boolean {
  if (!error) return false
  
  const errorMessage = typeof error === 'string' ? error : error.message || ''
  const errorString = errorMessage.toLowerCase()
  
  // 配额和限流相关错误模式
  const quotaPatterns = [
    'quota', 'limit', 'rate limit', 'throttle', 'resource exhausted',
    '429', 'too many requests', 'exceeded',
    'context window', 'token limit', 'max_output_tokens must be positive',
    'insufficient quota', 'billing', 'usage limit'
  ]
  
  return quotaPatterns.some(pattern => errorString.includes(pattern))
}

/**
 * 检查是否为上下文窗口超限错误
 */
export function isContextWindowError(error: any): boolean {
  if (!error) return false
  
  const errorMessage = typeof error === 'string' ? error : error.message || ''
  const errorString = errorMessage.toLowerCase()
  
  const contextPatterns = [
    'context window', 'context length', 'token limit', 'exceeded',
    'input and maximum output tokens', 'model context window limit',
    'sequence length', 'maximum context length'
  ]
  
  return contextPatterns.some(pattern => errorString.includes(pattern))
}

/**
 * 检查是否为max_output_tokens配置错误
 */
export function isTokenConfigError(error: any): boolean {
  if (!error) return false
  
  const errorMessage = typeof error === 'string' ? error : error.message || ''
  const errorString = errorMessage.toLowerCase()
  
  return errorString.includes('max_output_tokens must be positive')
} 