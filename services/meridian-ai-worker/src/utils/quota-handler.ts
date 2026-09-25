/**
 * 配额限制处理器工具类 - 生产环境版本
 */
export class QuotaHandler {
  
  /**
   * 这次失败值不值得重试。
   *
   * ⚠️ 名字窄于实际语义：除配额/限流，还覆盖 Workers AI 两类会自愈的失败：
   * `3040: Capacity temporarily exceeded`、`3046: Request timeout`。
   *
   * 2026-09-25 去掉了原来的 `ai gateway` / `no response received` 两条：Gateway 已不在调用链上，
   * 而 brief-generation 把**所有**错误都包成 "AI Gateway request failed: …"，于是任何失败
   * （含空正文这类重试也不会变的）都被当成配额错误退避重试 4 次。
   * `invalid api key` 这类永不自愈的错误有意不认：让它立刻失败、立刻可见
   * （这个仓库为它付过代价：一次 key 失效让整条管线静默停摆 12 天）。
   */
  static isQuotaLimitError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorString = JSON.stringify(error).toLowerCase();

    return (
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('resource exhausted') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('capacity temporarily exceeded') ||
      errorMessage.includes('request timeout') ||
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
          console.error(`[QuotaHandler] 重试 ${maxRetries} 次后仍失败，配额限制错误:`, {
            error: error.message,
            attempt: attempt + 1,
            timestamp: new Date().toISOString()
          });
          throw error;
        }
        
        // 计算延迟时间（指数退避）
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        
        console.warn(`[QuotaHandler] 配额限制错误，第 ${attempt + 1}/${maxRetries + 1} 次尝试，${delay}ms 后重试:`, {
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
