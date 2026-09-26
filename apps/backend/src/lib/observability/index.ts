import type { Env } from '../../index';
import { workflowObservabilityKey } from '@meridian/contracts';
import { Logger } from '../core/logger';

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
//
// 为什么不能只靠内存数组：logStep 在 workflow 的 step.do 之外调用。Workflow 休眠（step.sleep、
// 等重试）或换 isolate 后，run() 从头重放——step.do 回缓存结果，step 外的 logStep 会再执行一遍，
// 但实例是新建的、内存为空（Rules of Workflows：Do not rely on state outside of a step）。
// 以前每次整份覆盖写 R2，重放的第一条 logStep 就把整份指标冲成 1 条，之后重建的条目时间戳/耗时
// 都是重放时的值。
//
// 现在每次 logStep 先读 R2 里已有的指标再合并写回（read-merge-write），按「(stepName, status)
// 在本段生命里第几次出现」判断重放：重放按原顺序经过同样的 logStep，第 k 次调用对应 R2 里该键
// 的第 k 条。R2 里已有 → 是重放，原条目保留不动；没有 → 新记录，追加。
// 已知边界：`wrangler workflows instances restart` 复用同一个 id、从头真跑，也会被当成重放——
// 已记过的 (step, status, 第 k 次) 保留第一次的条目，只追加新出现的。
export class WorkflowObservability {
  private workflowId: string;
  private env: Env;
  /** 最近一次从 R2 读回并合并后的全部指标（含上一段引擎生命记下的） */
  private metrics: WorkflowMetrics[] = [];
  /** 本段引擎生命里每个 (stepName, status) 已调用 logStep 的次数 */
  private calls = new Map<string, number>();
  private startTime: number;
  private log: Logger;

  constructor(workflowId: string, env: Env) {
    this.workflowId = workflowId;
    this.env = env;
    this.log = new Logger({ component: 'WorkflowObservability', workflow_id: workflowId });
    this.startTime = Date.now();
  }

  // 记录工作流步骤
  async logStep(stepName: string, status: 'started' | 'completed' | 'degraded' | 'failed', data?: any, error?: string) {
    const key = `${stepName}\u0000${status}`;
    const occurrence = this.calls.get(key) ?? 0;
    this.calls.set(key, occurrence + 1);

    let metric: WorkflowMetrics = {
      workflowId: this.workflowId,
      stepName,
      timestamp: new Date().toISOString(),
      status,
      data: this.sanitizeData(data),
      error
    };

    const persisted = await this.loadPersisted();
    if (persisted) this.metrics = persisted;
    const recorded = this.metrics.filter(m => m.stepName === stepName && m.status === status);
    const replayed = persisted !== null && occurrence < recorded.length;

    if (replayed) {
      metric = recorded[occurrence];
    } else {
      if (status === 'completed' || status === 'failed') {
        const startMetric = this.metrics.find(m =>
          m.stepName === stepName && m.status === 'started'
        );
        if (startMetric) {
          metric.duration = Date.now() - new Date(startMetric.timestamp).getTime();
        }
      }
      this.metrics.push(metric);
    }

    // 记录到控制台（带结构化格式）
    this.log.info(`[观测性-${stepName}] ${status.toUpperCase()}`, {
      step: stepName,
      step_status: status,
      step_timestamp: metric.timestamp,
      ...(metric.duration ? { duration_ms: metric.duration } : {}),
      data_summary: this.summarizeData(data),
      ...(error ? { step_error: error } : {}),
    });

    // 每次新记录都持久化，保证 mid-flight 崩溃的 workflow 也能在 R2 中查到。
    // 读 R2 失败时不写：宁可这一条只进日志，也不拿不全的内存数组覆盖 R2 里已有的整份。
    if (!replayed && persisted) {
      await this.persistMetrics();
    }
  }

  /** 读 R2 里已有的指标；对象不存在返回 []，读失败返回 null（调用方据此不写回）。 */
  private async loadPersisted(): Promise<WorkflowMetrics[] | null> {
    try {
      const obj = await this.env.ARTICLES_BUCKET.get(workflowObservabilityKey(this.workflowId));
      if (!obj) return [];
      const parsed = JSON.parse(await obj.text());
      return Array.isArray(parsed?.detailedMetrics) ? parsed.detailedMetrics : [];
    } catch (error) {
      this.log.error('[可观测性] 读取已有指标失败:', undefined, error);
      return null;
    }
  }

  // 生成工作流摘要报告
  generateSummaryReport(): any {
    // 从本 run 第一条指标起算（可能是上一段引擎生命记的），不是本实例的构造时刻
    const firstAt = this.metrics.length > 0 ? new Date(this.metrics[0].timestamp).getTime() : this.startTime;
    const totalDuration = Date.now() - Math.min(firstAt, this.startTime);
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
      const key = workflowObservabilityKey(this.workflowId);

      await this.env.ARTICLES_BUCKET.put(key, JSON.stringify({
        summary,
        detailedMetrics: this.metrics
      }, null, 2));
    } catch (error) {
      this.log.error('[可观测性] 保存指标失败:', undefined, error);
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
    // logStep 已落盘；不再额外整份写回——读 R2 失败时内存数组不全，写回会覆盖已有指标
    await this.logStep('workflow_complete', 'completed', this.generateSummaryReport());
  }

  // 处理工作流失败
  async fail(error: string) {
    await this.logStep('workflow_failed', 'failed', null, error);
  }
}

// 工厂函数
export function createWorkflowObservability(workflowId: string, env: Env): WorkflowObservability {
  return new WorkflowObservability(workflowId, env);
}
