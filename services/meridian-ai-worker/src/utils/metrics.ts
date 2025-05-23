import { Env } from '../types';
import { getLogger } from './logger';

/**
 * 指标类型
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
}

/**
 * 简单的指标收集器
 * 在生产环境中可以扩展该类将指标发送到监控系统
 */
export class Metrics {
  private env: Env;
  private logger: ReturnType<typeof getLogger>;
  private metrics: Record<string, { type: MetricType; value: number; tags?: Record<string, string> }> = {};

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
  }

  /**
   * 递增计数器
   */
  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    const metricKey = this.getMetricKey(name, tags);
    
    if (!this.metrics[metricKey]) {
      this.metrics[metricKey] = { type: MetricType.COUNTER, value: 0, tags };
    }
    
    this.metrics[metricKey].value += value;
    
    // 可选：在调试环境中记录指标变化
    if (this.env.ENVIRONMENT === 'dev') {
      this.logger.debug(`Metric ${name} incremented`, { 
        name, 
        type: MetricType.COUNTER, 
        value: this.metrics[metricKey].value, 
        tags 
      });
    }
  }

  /**
   * 设置测量值
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    const metricKey = this.getMetricKey(name, tags);
    this.metrics[metricKey] = { type: MetricType.GAUGE, value, tags };
    
    // 可选：在调试环境中记录指标变化
    if (this.env.ENVIRONMENT === 'dev') {
      this.logger.debug(`Metric ${name} set`, { name, type: MetricType.GAUGE, value, tags });
    }
  }

  /**
   * 记录直方图数据点
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const metricKey = this.getMetricKey(name, tags);
    
    if (!this.metrics[metricKey]) {
      this.metrics[metricKey] = { type: MetricType.HISTOGRAM, value: 0, tags };
    }
    
    // 简单实现，只存储最新值
    // 在实际系统中，可以收集更详细的直方图数据
    this.metrics[metricKey].value = value;
    
    // 可选：在调试环境中记录指标变化
    if (this.env.ENVIRONMENT === 'dev') {
      this.logger.debug(`Metric ${name} recorded`, { name, type: MetricType.HISTOGRAM, value, tags });
    }
  }

  /**
   * 记录请求指标
   * 用于跟踪AI模型请求的性能和使用情况
   */
  recordRequest(taskType: string, provider: string, duration: number): void {
    // 记录请求计数
    this.incrementCounter('ai_requests_total', 1, {
      task_type: taskType,
      provider: provider
    });
    
    // 记录请求持续时间
    this.recordHistogram('ai_request_duration_ms', duration, {
      task_type: taskType,
      provider: provider
    });
    
    // 记录提供商使用统计
    this.incrementCounter('ai_provider_usage', 1, {
      provider: provider
    });
    
    // 记录任务类型统计
    this.incrementCounter('ai_task_usage', 1, {
      task_type: taskType
    });
    
    // 可选：记录详细的性能指标
    if (this.env.ENVIRONMENT === 'dev') {
      this.logger.debug('Request metrics recorded', {
        taskType,
        provider,
        duration,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 记录请求错误
   */
  recordRequestError(taskType: string, provider: string, errorType: string): void {
    this.incrementCounter('ai_request_errors_total', 1, {
      task_type: taskType,
      provider: provider,
      error_type: errorType
    });
  }

  /**
   * 记录令牌使用情况
   */
  recordTokenUsage(provider: string, inputTokens: number, outputTokens: number): void {
    this.incrementCounter('ai_tokens_used', inputTokens + outputTokens, {
      provider: provider,
      token_type: 'total'
    });
    
    this.incrementCounter('ai_tokens_used', inputTokens, {
      provider: provider,
      token_type: 'input'
    });
    
    this.incrementCounter('ai_tokens_used', outputTokens, {
      provider: provider,
      token_type: 'output'
    });
  }

  /**
   * 计时器便捷方法
   * 返回一个函数，调用时会记录从创建到调用的时间
   */
  startTimer(name: string, tags?: Record<string, string>): () => number {
    const startTime = Date.now();
    
    return () => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      this.recordHistogram(name, duration, tags);
      return duration;
    };
  }

  /**
   * 获取所有收集的指标
   */
  getAllMetrics(): Record<string, { type: MetricType; value: number; tags?: Record<string, string> }> {
    return { ...this.metrics };
  }

  /**
   * 生成指标键名
   */
  private getMetricKey(name: string, tags?: Record<string, string>): string {
    if (!tags) return name;
    
    const sortedTags = Object.entries(tags)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');
    
    return `${name}{${sortedTags}}`;
  }
}