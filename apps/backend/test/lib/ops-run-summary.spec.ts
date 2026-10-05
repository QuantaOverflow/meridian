/**
 * run 结束时写进 brief_runs.ops_summary 的汇总（src/lib/ops/run-summary.ts）。
 * R2 用 workers pool 的本地模拟桶，库用本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」）。
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { llmCallKey, workflowObservabilityKey } from '@meridian/contracts';
import { $brief_runs, eq } from '@meridian/database';
import { getDb } from '../../src/lib/database';
import { recordRunOpsSummary } from '../../src/lib/ops/run-summary';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;

const T0 = Date.parse('2026-10-05T13:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

async function putCalls(wf: string, phase: string, neurons: Array<number | null>, startIndex = 0) {
  for (let i = 0; i < neurons.length; i += 100) {
    await Promise.all(
      neurons.slice(i, i + 100).map((v, k) =>
        env.ARTICLES_BUCKET.put(
          llmCallKey(wf, phase, startIndex + i + k),
          JSON.stringify({
            phase,
            call_index: startIndex + i + k,
            request: { model: 'm' },
            // 出错的调用没有 usage
            ...(v === null ? { error: 'boom' } : { response: { usage: { neurons: v } } }),
          })
        )
      )
    );
  }
}

async function putObservation(wf: string, metrics: Array<{ stepName: string; status: string; timestamp: string; data?: unknown }>) {
  await env.ARTICLES_BUCKET.put(
    workflowObservabilityKey(wf),
    JSON.stringify({ summary: {}, detailedMetrics: metrics.map((m) => ({ workflowId: wf, ...m })) })
  );
}

const readRun = async (wf: string) => (await db.select().from($brief_runs).where(eq($brief_runs.workflow_id, wf)))[0];

describe('run 汇总', () => {
  it('按阶段加总调用数与 neurons，带上步骤耗时、块与核查计数、降级原因', async () => {
    const wf = uniq('wf-summary');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'DEGRADED' });
    await putCalls(wf, 'cluster_judge', [10, 20.5, null]);
    await putCalls(wf, 'brief_block_v6', [100, 200]);
    await putCalls(wf, 'brief_block_v6_check', [1000]);
    await putObservation(wf, [
      { stepName: 'workflow_start', status: 'started', timestamp: at(0) },
      { stepName: 'prepare_dataset', status: 'started', timestamp: at(1) },
      { stepName: 'prepare_dataset', status: 'completed', timestamp: at(41) },
      { stepName: 'story_validation', status: 'started', timestamp: at(50) },
      { stepName: 'story_validation', status: 'degraded', timestamp: at(110) },
      // 这两步只在结束时记一条，没有 started：起点取上一步结束的时刻
      { stepName: 'story_rank', status: 'completed', timestamp: at(120) },
      { stepName: 'brief_generation', status: 'started', timestamp: at(900) },
      {
        stepName: 'brief_blocks',
        status: 'degraded',
        timestamp: at(901),
        data: {
          expected: 20,
          written: 19,
          tiers: { lead: 4, more: 7, brief: 8 },
          writeRejects: 3,
          checkOutcomes: { off: 0, clean: 15, fixed: 3, revise_failed: 0, still_flagged: 1, missing: 0 },
          uncheckedBlocks: 2,
          checkRevisions: 5,
        },
      },
      { stepName: 'brief_generation', status: 'completed', timestamp: at(960) },
    ]);

    const ok = await recordRunOpsSummary(env, wf, ['块生成失败 1 个（选中 20）']);

    expect(ok).toBe(true);
    const run = await readRun(wf);
    expect(run.status).toBe('DEGRADED');
    expect(run.ops_summary).toEqual({
      v: 1,
      llm: {
        calls: 6,
        neurons: 1330.5,
        byPhase: {
          cluster_judge: { calls: 3, neurons: 30.5 },
          brief_block_v6: { calls: 2, neurons: 300 },
          brief_block_v6_check: { calls: 1, neurons: 1000 },
        },
      },
      steps: [
        { name: 'prepare_dataset', status: 'completed', startedAt: at(1), ms: 40_000 },
        { name: 'story_validation', status: 'degraded', startedAt: at(50), ms: 60_000 },
        { name: 'story_rank', status: 'completed', startedAt: at(110), ms: 10_000 },
        { name: 'brief_blocks', status: 'degraded', startedAt: at(120), ms: 781_000 },
        { name: 'brief_generation', status: 'completed', startedAt: at(900), ms: 60_000 },
      ],
      blocks: { expected: 20, written: 19, tiers: { lead: 4, more: 7, brief: 8 }, writeRejects: 3 },
      check: {
        outcomes: { off: 0, clean: 15, fixed: 3, revise_failed: 0, still_flagged: 1, missing: 0 },
        uncheckedBlocks: 2,
        revisions: 5,
      },
      degradedReasons: ['块生成失败 1 个（选中 20）'],
    });
  });

  it('调用记录超过 1000 条也全部加进去（R2 一页最多 1000 个）', async () => {
    const wf = uniq('wf-summary-many');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'COMPLETED' });
    await putCalls(wf, 'brief_block_v6_check', Array.from({ length: 1003 }, () => 2));
    await putCalls(wf, 'brief_block_v6', [7, 7]);

    expect(await recordRunOpsSummary(env, wf, [])).toBe(true);

    expect((await readRun(wf)).ops_summary?.llm).toEqual({
      calls: 1005,
      neurons: 2020,
      byPhase: { brief_block_v6_check: { calls: 1003, neurons: 2006 }, brief_block_v6: { calls: 2, neurons: 14 } },
    });
  });

  it('中途失败的 run：有什么写什么——没结束的步骤记 failed、算到最后一条观测，块与核查为 null', async () => {
    const wf = uniq('wf-summary-failed');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'FAILED', error: 'ml down' });
    await putCalls(wf, 'cluster_judge', [5]);
    await putObservation(wf, [
      { stepName: 'workflow_start', status: 'started', timestamp: at(0) },
      { stepName: 'prepare_dataset', status: 'started', timestamp: at(1) },
      { stepName: 'prepare_dataset', status: 'completed', timestamp: at(41) },
      { stepName: 'clustering_analysis', status: 'started', timestamp: at(42) },
      { stepName: 'workflow_failed', status: 'failed', timestamp: at(72) },
    ]);

    expect(await recordRunOpsSummary(env, wf, [])).toBe(true);

    const run = await readRun(wf);
    expect(run.status).toBe('FAILED');
    expect(run.ops_summary).toEqual({
      v: 1,
      llm: { calls: 1, neurons: 5, byPhase: { cluster_judge: { calls: 1, neurons: 5 } } },
      steps: [
        { name: 'prepare_dataset', status: 'completed', startedAt: at(1), ms: 40_000 },
        { name: 'clustering_analysis', status: 'failed', startedAt: at(42), ms: 30_000 },
      ],
      blocks: null,
      check: null,
      degradedReasons: [],
    });
  });

  it('R2 里什么都没有的 run 也写一份空汇总', async () => {
    const wf = uniq('wf-summary-empty');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'FAILED' });

    expect(await recordRunOpsSummary(env, wf, [])).toBe(true);

    expect((await readRun(wf)).ops_summary).toEqual({
      v: 1,
      llm: { calls: 0, neurons: 0, byPhase: {} },
      steps: [],
      blocks: null,
      check: null,
      degradedReasons: [],
    });
  });

  it('R2 读失败：不抛错，ops_summary 留空，run 状态不变', async () => {
    const wf = uniq('wf-summary-r2-down');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'COMPLETED' });
    await putCalls(wf, 'cluster_judge', [5, 5]);
    // 列得出、读不出：R2 在读第二个对象时出错
    let reads = 0;
    const flaky = {
      list: (opts: R2ListOptions) => env.ARTICLES_BUCKET.list(opts),
      get: async (key: string) => {
        if (++reads === 2) throw new Error('R2 internal error (10001)');
        return env.ARTICLES_BUCKET.get(key);
      },
    } as unknown as R2Bucket;

    const ok = await recordRunOpsSummary({ ARTICLES_BUCKET: flaky, HYPERDRIVE: env.HYPERDRIVE }, wf, []);

    expect(ok).toBe(false);
    const run = await readRun(wf);
    expect(run.ops_summary).toBeNull();
    expect(run.status).toBe('COMPLETED');
  });

  it('有一条调用记录不是合法 JSON：不写缺一块的汇总，留空', async () => {
    const wf = uniq('wf-summary-corrupt');
    await db.insert($brief_runs).values({ workflow_id: wf, status: 'COMPLETED' });
    await putCalls(wf, 'cluster_judge', [5]);
    await env.ARTICLES_BUCKET.put(llmCallKey(wf, 'cluster_judge', 1), '{"phase": "cluster_ju');

    expect(await recordRunOpsSummary(env, wf, [])).toBe(false);
    expect((await readRun(wf)).ops_summary).toBeNull();
  });
});
