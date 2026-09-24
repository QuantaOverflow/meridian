/**
 * 配额限制处理器工具类 - 生产环境版本
 */
export class QuotaHandler {
  
  /**
   * 这次失败值不值得重试。
   *
   * ⚠️ 名字窄于实际语义：除配额/限流，还覆盖两类会自愈的传输层失败（见下）。
   *
   * 2026-09-22 补进后两条。来历：`brief-generation.ts` 原有一个私有的 `BriefErrorHandler`，
   * 与本类逐字节几乎相同（只改日志前缀），合并时才发现它**多认三个模式**：
   * `no response received` / `ai gateway` / `invalid api key`。前两类是上游抖动、重试就好；
   * 第三类永不自愈，重试只是把失败拖长——这个仓库为它付过代价（一次 key 失效让整条管线
   * 静默停摆 12 天）。所以只补前两条，`invalid api key` 有意不加：让它立刻失败、立刻可见。
   */
  static isQuotaLimitError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorString = JSON.stringify(error).toLowerCase();

    return (
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('resource exhausted') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('no response received') ||
      errorMessage.includes('ai gateway') ||
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
