/**
 * WorkflowObservability 在 workflow 重启后不得丢 R2 里已记的指标。
 *
 * Workflow 休眠（step.sleep / 等重试）或引擎换 isolate 后，run() 从头重跑：step.do 回缓存结果，
 * step 外的 logStep 调用会再执行一遍，但内存里的 metrics 数组是空的（Rules of Workflows:
 * "Do not rely on state outside of a step"）。这里用「R2 里已有上一段生命的指标 + 全新实例」模拟重启。
 * R2 用 workers pool 的本地模拟桶（wrangler.test.jsonc 的 ARTICLES_BUCKET）。
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { workflowObservabilityKey } from '@meridian/contracts';
import type { Env } from '../../src/index';
import { createWorkflowObservability, type WorkflowMetrics } from '../../src/lib/observability';

const testEnv = { ARTICLES_BUCKET: env.ARTICLES_BUCKET } as Env;
let n = 0;
const uniqWf = () => `wf-obs-${Date.now()}-${n++}`;

async function readSnapshot(wf: string): Promise<{ summary: any; detailedMetrics: WorkflowMetrics[] }> {
  const obj = await env.ARTICLES_BUCKET.get(workflowObservabilityKey(wf));
  if (!obj) throw new Error(`R2 里没有 ${wf} 的观测快照`);
  return JSON.parse(await obj.text());
}

/** 上一段引擎生命写进 R2 的状态：开跑、prepare_dataset 已完成（耗时 40s）、聚类已开始。 */
function priorLifetime(wf: string): WorkflowMetrics[] {
  const t0 = Date.parse('2026-09-26T13:00:00.000Z');
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  return [
    { workflowId: wf, stepName: 'workflow_start', timestamp: at(0), status: 'started', data: { triggeredBy: 'cron' } },
    { workflowId: wf, stepName: 'prepare_dataset', timestamp: at(1_000), status: 'started' },
    { workflowId: wf, stepName: 'prepare_dataset', timestamp: at(41_000), status: 'completed', duration: 40_000, data: { articleCount: 177 } },
    { workflowId: wf, stepName: 'clustering_analysis', timestamp: at(42_000), status: 'started' },
  ];
}

async function seed(wf: string, metrics: WorkflowMetrics[]) {
  await env.ARTICLES_BUCKET.put(workflowObservabilityKey(wf), JSON.stringify({ summary: {}, detailedMetrics: metrics }));
}

describe('WorkflowObservability 跨 workflow 重启', () => {
  it('重放 step 外的 logStep 不覆盖已有指标：旧条目原样保留（时间戳与耗时不被重放值改写）', async () => {
    const wf = uniqWf();
    const prior = priorLifetime(wf);
    await seed(wf, prior);

    // 新的引擎生命：内存为空，run() 从头重跑到同一位置
    const obs = createWorkflowObservability(wf, testEnv);
    await obs.logStep('workflow_start', 'started', { triggeredBy: 'cron' });

    // 重放的第一条就落盘了：此刻 R2 里不能只剩 1 条
    expect((await readSnapshot(wf)).detailedMetrics).toEqual(prior);

    await obs.logStep('prepare_dataset', 'started');
    await obs.logStep('prepare_dataset', 'completed', { articleCount: 177 });
    await obs.logStep('clustering_analysis', 'started');

    expect((await readSnapshot(wf)).detailedMetrics).toEqual(prior);
  });

  it('重启后新完成的 step 追加在后，耗时按上一段生命记下的 started 算', async () => {
    const wf = uniqWf();
    const prior = priorLifetime(wf);
    await seed(wf, prior);

    const obs = createWorkflowObservability(wf, testEnv);
    await obs.logStep('workflow_start', 'started', { triggeredBy: 'cron' });
    await obs.logStep('prepare_dataset', 'started');
    await obs.logStep('prepare_dataset', 'completed', { articleCount: 177 });
    await obs.logStep('clustering_analysis', 'started');
    await obs.logStep('clustering_analysis', 'completed', { clustersFound: 39 });

    const { summary, detailedMetrics } = await readSnapshot(wf);
    expect(detailedMetrics.slice(0, 4)).toEqual(prior);
    expect(detailedMetrics).toHaveLength(5);
    const done = detailedMetrics[4];
    expect(done).toMatchObject({ stepName: 'clustering_analysis', status: 'completed', data: { clustersFound: 39 } });
    expect(done.duration).toBe(Date.parse(done.timestamp) - Date.parse(prior[3].timestamp));
    // 摘要按全部指标算，总耗时从上一段生命的开跑时刻起算
    expect(summary.stepCount).toBe(5);
    expect(summary.stepDurations).toEqual({ prepare_dataset: 40_000, clustering_analysis: done.duration });
    expect(summary.totalDuration).toBeGreaterThanOrEqual(Date.parse(done.timestamp) - Date.parse(prior[0].timestamp));
  });

  it('同一 step 同一状态合法地记多次（workflow_complete 记两次）时，重放不吞掉第二条', async () => {
    const wf = uniqWf();
    const obs = createWorkflowObservability(wf, testEnv);
    await obs.logStep('workflow_start', 'started');
    await obs.logStep('workflow_complete', 'completed', { reportId: 1 });
    await obs.complete();
    const first = (await readSnapshot(wf)).detailedMetrics;
    expect(first.filter((m) => m.stepName === 'workflow_complete')).toHaveLength(2);

    // 整段重放
    const again = createWorkflowObservability(wf, testEnv);
    await again.logStep('workflow_start', 'started');
    await again.logStep('workflow_complete', 'completed', { reportId: 1 });
    await again.complete();
    expect((await readSnapshot(wf)).detailedMetrics).toEqual(first);
  });
});
