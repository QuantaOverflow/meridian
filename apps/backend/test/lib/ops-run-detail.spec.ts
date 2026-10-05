/**
 * 运维台运行详情 `GET /observability/ops/runs/:workflowId`：走真实路由 + 本机测试库 + 测试环境的 R2 binding。
 * 块记录放进 ARTICLES_BUCKET（key 与生产同一个 briefV3RecordKey）。
 */
import { briefV3RecordKey, type BriefV3Record, type BriefV3WrittenBlock, type OpsRunDetail, type RunOpsSummary } from '@meridian/contracts';
import { $brief_runs, sql } from '@meridian/database';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/lib/database';
import { writtenBlock } from '../fixtures/reader/fixture';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);

const summary: RunOpsSummary = {
  v: 1,
  llm: { calls: 40, neurons: 5_000, byPhase: { brief_block_v6: { calls: 40, neurons: 5_000 } } },
  steps: [{ name: 'persist', status: 'degraded', startedAt: '2026-10-05T13:00:00.000Z', ms: 1000 }],
  blocks: { expected: 2, written: 2, tiers: { lead: 1, more: 1, brief: 0 }, writeRejects: 1 },
  check: null,
  degradedReasons: ['check unavailable'],
};

async function seedRun(workflowId: string, over: Partial<typeof $brief_runs.$inferInsert> = {}) {
  await db.insert($brief_runs).values({
    workflow_id: workflowId,
    status: 'COMPLETED',
    params: { date: '2026-10-05' },
    started_at: new Date('2026-10-05T13:00:00Z'),
    finished_at: new Date('2026-10-05T13:30:00Z'),
    total_articles: 400,
    stories_identified: 25,
    ...over,
  });
}

async function putRecord(workflowId: string, blocks: BriefV3Record['blocks']) {
  const record: BriefV3Record = { workflowId, createdAt: '2026-10-05T13:30:00.000Z', title: 't', sections: 0, blocks };
  await env.ARTICLES_BUCKET.put(briefV3RecordKey(workflowId), JSON.stringify(record));
}

const get = (id: string) =>
  exports.default.fetch(`http://backend/observability/ops/runs/${id}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });

beforeEach(async () => {
  await db.execute(sql`truncate brief_runs restart identity cascade`);
});

describe('GET /observability/ops/runs/:workflowId', () => {
  it('没有这次运行：404', async () => {
    const res = await get('cron-brief-nope');
    expect(res.status).toBe(404);
  });

  it('没有汇总：summary 为 null，行里成本为 null；错误原文带出', async () => {
    await seedRun('cron-brief-1', { status: 'FAILED', error: 'boom' });
    await putRecord('cron-brief-1', []);
    const res = await get('cron-brief-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as OpsRunDetail;
    expect(body.summary).toBeNull();
    expect(body.error).toBe('boom');
    expect(body.params).toEqual({ date: '2026-10-05' });
    expect(body.run).toMatchObject({ workflowId: 'cron-brief-1', status: 'FAILED', level: 'red', calls: null, neurons: null, usd: null });
  });

  it('有汇总和块记录：块带出档位、核查结果、拒绝数、调用数和成本；失败块不列', async () => {
    await seedRun('cron-brief-2', { status: 'DEGRADED', ops_summary: summary });
    const lead: BriefV3WrittenBlock = {
      ...writtenBlock(0, 'lead block', 'lead'),
      storyIdx: 3,
      articles: 12,
      writeRejects: ['a'],
      llmCalls: 9,
      neurons: 1_000,
      check: {
        epochs: 1, outcome: 'fixed', revisions: 1, unchecked: [2, 4], stillFlagged: [], draft: null, rounds: [], calls: 6, neurons: 500, ms: 1_000,
      },
    };
    const more = { ...writtenBlock(1, 'more block', 'more'), storyIdx: 5, articles: 4, llmCalls: 2, neurons: 2_000 };
    await putRecord('cron-brief-2', [lead, more, { storyIdx: 6, title: 'x', ok: false, error: 'e' }]);

    const body = (await (await get('cron-brief-2')).json()) as OpsRunDetail;
    expect(body.summary).toEqual(summary);
    expect(body.run).toMatchObject({ level: 'yellow', flags: ['degraded'], calls: 40, neurons: 5_000 });
    expect(body.blocks).toEqual([
      { index: 3, tier: 'lead', title: 'lead block', articles: 12, check: { outcome: 'fixed', revisions: 1, unchecked: 2 }, refusals: 1, calls: 9, neurons: 1_000, usd: 0.011 },
      { index: 5, tier: 'more', title: 'more block', articles: 4, check: null, refusals: 0, calls: 2, neurons: 2_000, usd: 0.022 },
    ]);
  });

  it('没有块记录：blocks 是 unavailable，端点仍是 200', async () => {
    await seedRun('cron-brief-3');
    const res = await get('cron-brief-3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as OpsRunDetail;
    expect(body.blocks).toEqual({ unavailable: expect.stringContaining('block record') });
  });

  it('块记录读不出来（不是 JSON）：同样是 unavailable', async () => {
    await seedRun('cron-brief-4');
    await env.ARTICLES_BUCKET.put(briefV3RecordKey('cron-brief-4'), 'not json');
    const body = (await (await get('cron-brief-4')).json()) as OpsRunDetail;
    expect(body.blocks).toEqual({ unavailable: expect.any(String) });
  });

  it('手动运行也能打开：没有基线，不标慢和贵', async () => {
    await seedRun('manual-1', { finished_at: new Date('2026-10-05T19:00:00Z'), ops_summary: summary });
    const body = (await (await get('manual-1')).json()) as OpsRunDetail;
    expect(body.run).toMatchObject({ workflowId: 'manual-1', level: 'ok', flags: [] });
  });
});
