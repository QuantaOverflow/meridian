import { IntelligenceReportBuilder } from './intelligence-report-builder';
import { Story, Article, IntelligenceReport } from '../types/intelligence-types';

/**
 * 配额限制处理器工具类
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

  /**
   * 处理配额限制的fallback策略
   */
  static handleQuotaLimitFallback(
    story: Story, 
    articles: Article[], 
    error: any, 
    isTestMode: boolean
  ): IntelligenceReport {
    if (isTestMode) {
      // 测试模式：返回测试兼容的结果
      console.log(`[Intelligence] 测试模式配额限制，返回测试兼容结果: ${story.title}`);
      return IntelligenceReportBuilder.createTestCompatibleReport(story, articles);
    } else {
      // 生产环境：记录详细错误信息后返回基础报告
      console.error(`[Intelligence] 生产环境配额限制错误:`, {
        storyTitle: story.title,
        articlesCount: articles.length,
        error: error.message,
        errorType: 'QUOTA_LIMIT',
        timestamp: new Date().toISOString(),
        requestId: `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
      });
      
      return IntelligenceReportBuilder.createProductionFallbackReport(story, articles, error);
    }
  }
} 