import type { Env } from '../../index';

// 可观测性指标类型定义
export interface WorkflowMetrics {
  workflowId: string;
  stepName: string;
  timestamp: string;
  duration?: number;
  status: 'started' | 'completed' | 'degraded' | 'failed';
  data?: any;
  error?: string;
}

// 核心可观测性类
export class WorkflowObservability {
  private workflowId: string;
  private env: Env;
  private metrics: WorkflowMetrics[] = [];
  private startTime: number;

  constructor(workflowId: string, env: Env) {
    this.workflowId = workflowId;
    this.env = env;
    this.startTime = Date.now();
  }

  // 记录工作流步骤
  async logStep(stepName: string, status: 'started' | 'completed' | 'degraded' | 'failed', data?: any, error?: string) {
    const metric: WorkflowMetrics = {
      workflowId: this.workflowId,
      stepName,
      timestamp: new Date().toISOString(),
      status,
      data: this.sanitizeData(data),
      error
    };

    if (status === 'completed' || status === 'failed') {
      const startMetric = this.metrics.find(m => 
        m.stepName === stepName && m.status === 'started'
      );
      if (startMetric) {
        metric.duration = Date.now() - new Date(startMetric.timestamp).getTime();
      }
    }

    this.metrics.push(metric);

    // 记录到控制台（带结构化格式）
    console.log(`[观测性-${stepName}] ${status.toUpperCase()}`, {
      工作流ID: this.workflowId,
      时间戳: metric.timestamp,
      耗时: metric.duration ? `${metric.duration}ms` : 'N/A',
      数据摘要: this.summarizeData(data),
      错误: error || '无'
    });

    // 每次状态变化都持久化，保证 mid-flight 崩溃的 workflow 也能在 R2 中查到
    await this.persistMetrics();
  }

  // 生成工作流摘要报告
  generateSummaryReport(): any {
    const totalDuration = Date.now() - this.startTime;
    const stepDurations = this.metrics
      .filter(m => m.duration)
      .reduce((acc, m) => {
        acc[m.stepName] = (acc[m.stepName] || 0) + (m.duration || 0);
        return acc;
      }, {} as Record<string, number>);

    const errors = this.metrics.filter(m => m.status === 'failed');
    
    return {
      workflowId: this.workflowId,
      totalDuration,
      stepCount: this.metrics.length,
      completedSteps: this.metrics.filter(m => m.status === 'completed').length,
      failedSteps: errors.length,
      stepDurations,
      errors: errors.map(e => ({ step: e.stepName, error: e.error })),
      efficiency: {
        avgStepDuration: Object.values(stepDurations).reduce((a, b) => a + b, 0) / Object.keys(stepDurations).length,
        longestStep: Object.entries(stepDurations).reduce((a, b) => a[1] > b[1] ? a : b, ['', 0]),
        shortestStep: Object.entries(stepDurations).reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity])
      }
    };
  }

  // 持久化指标到存储
  // 使用稳定 key 覆盖写：每个 workflow 一份 R2 对象，反映最新状态
  private async persistMetrics() {
    try {
      const summary = this.generateSummaryReport();
      const key = `observability/${this.workflowId}.json`;

      await this.env.ARTICLES_BUCKET.put(key, JSON.stringify({
        summary,
        detailedMetrics: this.metrics
      }, null, 2));
    } catch (error) {
      console.error('[可观测性] 保存指标失败:', error);
    }
  }

  // 清理敏感数据
  private sanitizeData(data: any): any {
    if (!data) return data;
    
    // 移除敏感信息，如API密钥、完整内容等
    const sanitized = { ...data };
    
    if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 500) {
      sanitized.content = sanitized.content.substring(0, 500) + '...[截断]';
    }
    
    if (sanitized.embedding && Array.isArray(sanitized.embedding)) {
      sanitized.embedding = `[向量数组,长度:${sanitized.embedding.length}]`;
    }
    
    return sanitized;
  }

  // 生成数据摘要
  private summarizeData(data: any): string {
    if (!data) return '无数据';
    
    if (Array.isArray(data)) {
      return `数组[${data.length}项]`;
    }
    
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      return `对象{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
    }
    
    return typeof data;
  }

  // 完成工作流
  async complete() {
    await this.logStep('workflow_complete', 'completed', this.generateSummaryReport());
    await this.persistMetrics();
  }

  // 处理工作流失败
  async fail(error: string) {
    await this.logStep('workflow_failed', 'failed', null, error);
    await this.persistMetrics();
  }
}

// 工厂函数
export function createWorkflowObservability(workflowId: string, env: Env): WorkflowObservability {
  return new WorkflowObservability(workflowId, env);
}
