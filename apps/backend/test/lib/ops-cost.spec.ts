/**
 * 运维台 Cost：GET /observability/ops/cost。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * Cloudflare GraphQL Analytics 由 test/fake-cloudflare.ts 假冒。「现在」用 vitest 的假时钟定（只换 Date）。
 * 文件末尾另有一组直接调 Cloudflare 客户端的 Worker 报错计数：08、09 号票的端点从同一个客户端取这个数，本票没有路由暴露它。
 */
import { env, exports } from 'cloudflare:workers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { $brief_runs, sql } from '@meridian/database';
import type { OpsCost, RunOpsSummary } from '@meridian/contracts';
import { getDb } from '../../src/lib/database';
import { workerErrorsByDay } from '../../src/lib/ops/cloudflare';
import { fakeCloudflare, type FakeCloudflareAnswer, type FakeCloudflareRequest } from '../fake-cloudflare';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const cf = fakeCloudflare(env.CF_API_BASE_URL);

const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8';
const GLM = '@cf/zai-org/glm-4.7-flash';
const V4 = '@cf/deepseek-ai/deepseek-v4-pro-0813';

// 同一份假数据答两种查询：账单合计按 UTC 日（date），每日用量图按小时（datetimeHour，这里放在北京当天 13 点）
const neuronRow = (date: string, modelId: string, totalNeurons: number) => ({
  sum: { totalNeurons },
  dimensions: { date, datetimeHour: `${date}T05:00:00Z`, modelId },
});

/** 只有模型用量有数据，其它数据集都回空 */
const onlyNeurons = (rows: unknown[]) => (request: FakeCloudflareRequest): FakeCloudflareAnswer =>
  request.dataset === 'aiInferenceAdaptiveGroups' ? rows : [];

async function getCost(cycle?: string) {
  const res = await exports.default.fetch(`http://backend/observability/ops/cost${cycle ? `?cycle=${cycle}` : ''}`, {
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
  });
  return { status: res.status, body: (await res.json()) as OpsCost };
}

function at(now: string) {
  vi.setSystemTime(new Date(now));
}

const summary = (neurons: number, byPhase: RunOpsSummary['llm']['byPhase'] = {}): RunOpsSummary => ({
  v: 1,
  llm: { calls: 10, neurons, byPhase },
  steps: [],
  blocks: null,
  check: null,
  degradedReasons: [],
});

/** 一次调用核查上线后的汇总：DashScope 花了 `dashscopeUsd`，这笔钱已按牌价折进 `neurons` */
const summaryWithDashscope = (neurons: number, dashscopeUsd: number): RunOpsSummary => ({
  ...summary(neurons),
  check: {
    outcomes: { off: 0, clean: 25, fixed: 0, revise_failed: 0, still_flagged: 0, missing: 0 },
    uncheckedBlocks: 0,
    revisions: 0,
    oneCall: { checks: 100, fallbacks: 0, fallbackReasons: {}, fallbackMessage: null, noMeaningSearchBlocks: 0, dashscopeUsd },
  },
});

async function insertRun(workflowId: string, startedAt: string, opsSummary: RunOpsSummary | null) {
  await db.insert($brief_runs).values({ workflow_id: workflowId, status: 'COMPLETED', started_at: new Date(startedAt), ops_summary: opsSummary });
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

beforeEach(async () => {
  cf.reset();
  await db.execute(sql`truncate brief_runs restart identity cascade`);
});

afterEach(() => {
  // 每个测试都读了 Cloudflare；一次都没问到 = 假服务没接上，后面的断言都是空转
  expect(cf.requests.length).toBeGreaterThan(0);
});

afterAll(() => {
  vi.useRealTimers();
  cf.restore();
});

describe('计费周期：每月 4 日到次月 3 日，按 UTC 日', () => {
  const cases: Array<{ name: string; now: string; which: 'current' | 'previous'; cycle: OpsCost['cycle']; queriedTo: string }> = [
    {
      name: '3 日的最后一秒还在上一个周期里',
      now: '2026-10-03T23:59:59Z',
      which: 'current',
      cycle: { start: '2026-09-04', end: '2026-10-03', day: 30, days: 30, complete: false },
      queriedTo: '2026-10-03',
    },
    {
      name: '4 日 0 点起是新周期的第 1 天（31 天的周期）',
      now: '2026-10-04T00:00:00Z',
      which: 'current',
      cycle: { start: '2026-10-04', end: '2026-11-03', day: 1, days: 31, complete: false },
      queriedTo: '2026-10-04',
    },
    {
      name: '上一个周期：已结束，30 天',
      now: '2026-10-04T00:00:00Z',
      which: 'previous',
      cycle: { start: '2026-09-04', end: '2026-10-03', day: 30, days: 30, complete: true },
      queriedTo: '2026-10-03',
    },
    {
      name: '二月开始的周期只有 28 天',
      now: '2026-02-10T08:00:00Z',
      which: 'current',
      cycle: { start: '2026-02-04', end: '2026-03-03', day: 7, days: 28, complete: false },
      queriedTo: '2026-02-10',
    },
    {
      name: '闰年二月开始的周期 29 天',
      now: '2028-03-02T08:00:00Z',
      which: 'current',
      cycle: { start: '2028-02-04', end: '2028-03-03', day: 28, days: 29, complete: false },
      queriedTo: '2028-03-02',
    },
    {
      name: '跨年：1 月 2 日属于 12 月 4 日开始的周期，它的上一个从 11 月 4 日开始',
      now: '2026-01-02T08:00:00Z',
      which: 'previous',
      cycle: { start: '2025-11-04', end: '2025-12-03', day: 30, days: 30, complete: true },
      queriedTo: '2025-12-03',
    },
  ];

  for (const { name, now, which, cycle, queriedTo } of cases) {
    it(name, async () => {
      at(now);
      const { status, body } = await getCost(which);

      expect(status).toBe(200);
      expect(body.cycle).toEqual(cycle);
      // 免费池跟着周期天数走
      expect(body.account).toMatchObject({ freePool: 10_000 * cycle.days });
      // 问 Cloudflare 的范围就是这个周期，没结束的只问到今天
      const asked = cf.requests.find(r => r.dataset === 'aiInferenceAdaptiveGroups')!;
      expect(asked.variables).toMatchObject({ from: cycle.start, to: queriedTo });
    });
  }

  it('不带 cycle 参数 = 当前周期；乱写的值 400', async () => {
    at('2026-10-05T12:00:00Z');
    expect((await getCost()).body.cycle.start).toBe('2026-10-04');
    expect((await getCost('next')).status).toBe(400);
  });
});

describe('模型账单', () => {
  it('实测读数：9 月 4 日 – 10 月 3 日用了 2,978,181 neurons，免费池 300,000，账单 $29.46', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = onlyNeurons([
      neuronRow('2026-09-04', GLM, 1_144_059),
      neuronRow('2026-09-04', QWEN, 279_170),
      neuronRow('2026-10-03', V4, 1_115_227),
      neuronRow('2026-10-03', '@cf/some/trial-model', 439_725),
    ]);

    const { status, body } = await getCost('previous');

    expect(status).toBe(200);
    expect(body.account).toEqual({ neurons: 2_978_181, freePool: 300_000, billable: 2_678_181, usd: 29.46, planFeeUsd: 5 });
    const asked = cf.requests.find(r => r.dataset === 'aiInferenceAdaptiveGroups')!;
    expect(asked.authorization).toBe(`Bearer ${env.CF_ANALYTICS_TOKEN}`);
    expect(asked.variables).toEqual({ accountTag: env.CF_ACCOUNT_ID, from: '2026-09-04', to: '2026-10-03' });
  });

  it('用量没超过免费池：计费 neurons 和账单都是 0，不会是负数', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = onlyNeurons([neuronRow('2026-10-04', GLM, 5_000)]);

    const { body } = await getCost('current');

    expect(body.account).toEqual({ neurons: 5_000, freePool: 310_000, billable: 0, usd: 0, planFeeUsd: 5 });
  });

  it('刚好用完免费池不计费，多 1,000 neurons 计 1 分钱', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = onlyNeurons([neuronRow('2026-10-04', GLM, 310_000)]);
    expect((await getCost('current')).body.account).toMatchObject({ billable: 0, usd: 0 });

    cf.answer = onlyNeurons([neuronRow('2026-10-04', GLM, 311_000)]);
    expect((await getCost('current')).body.account).toMatchObject({ billable: 1_000, usd: 0.01 });
  });

  it('按模型：周期合计、占比、牌价；按日：周期里到今天为止每天一行，没用量的日子也在', async () => {
    at('2026-10-06T12:00:00Z');
    cf.answer = onlyNeurons([
      neuronRow('2026-10-04', GLM, 100_000),
      neuronRow('2026-10-04', V4, 250_000.4),
      neuronRow('2026-10-06', V4, 50_000),
      neuronRow('2026-10-06', QWEN, 100_000),
    ]);

    const { body } = await getCost('current');

    expect(body.byModel).toEqual([
      { modelId: V4, neurons: 300_000, share: expect.closeTo(0.6, 5), usdAtList: expect.closeTo(3.3, 4) },
      { modelId: GLM, neurons: 100_000, share: expect.closeTo(0.2, 5), usdAtList: 1.1 },
      { modelId: QWEN, neurons: 100_000, share: expect.closeTo(0.2, 5), usdAtList: 1.1 },
    ]);
    expect(body.daily).toEqual([
      { day: '2026-10-04', byModel: { [GLM]: 100_000, [V4]: 250_000 } },
      { day: '2026-10-05', byModel: {} },
      { day: '2026-10-06', byModel: { [V4]: 50_000, [QWEN]: 100_000 } },
    ]);
  });
});

describe('每日用量图按北京日', () => {
  const hourRow = (datetimeHour: string, totalNeurons: number) => ({
    sum: { totalNeurons },
    dimensions: { date: datetimeHour.slice(0, 10), datetimeHour, modelId: GLM },
  });

  it('UTC 15 点还是北京当天，UTC 16 点已是北京第二天；各柱之和等于周期合计', async () => {
    at('2026-10-06T12:00:00Z');
    cf.answer = onlyNeurons([
      hourRow('2026-10-04T15:00:00Z', 1_000),
      hourRow('2026-10-04T16:00:00Z', 2_000),
      hourRow('2026-10-05T23:00:00Z', 4_000),
    ]);

    const { body } = await getCost('current');

    expect(body.daily).toEqual([
      { day: '2026-10-04', byModel: { [GLM]: 1_000 } },
      { day: '2026-10-05', byModel: { [GLM]: 2_000 } },
      { day: '2026-10-06', byModel: { [GLM]: 4_000 } },
    ]);
    expect(body.account).toMatchObject({ neurons: 7_000 });
  });

  it('已结束的周期：从北京 9 月 4 日到 10 月 4 日，比 UTC 日多一根（周期在北京 8 点起止）', async () => {
    at('2026-10-05T12:00:00Z');
    // 假服务对每次查询都回同一批行；按小时的查询分三段问，只让含这一小时的那段回它
    const inLastWindow = onlyNeurons([hourRow('2026-10-03T20:00:00Z', 500)]);
    cf.answer = request =>
      'since' in request.variables && request.variables.since !== '2026-09-24T00:00:00.000Z' ? [] : inLastWindow(request);

    const { body } = await getCost('previous');

    if (!Array.isArray(body.daily)) throw new Error('应当有数');
    expect(body.daily).toHaveLength(31);
    expect(body.daily[0].day).toBe('2026-09-04');
    expect(body.daily.at(-1)).toEqual({ day: '2026-10-04', byModel: { [GLM]: 500 } });
  });

  it('按小时的查询每次不超过 10 天', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = onlyNeurons([]);
    await getCost('previous');
    const hourly = cf.requests.filter(r => 'since' in r.variables).map(r => [r.variables.since, r.variables.until]);
    expect(hourly).toEqual([
      ['2026-09-04T00:00:00.000Z', '2026-09-14T00:00:00.000Z'],
      ['2026-09-14T00:00:00.000Z', '2026-09-24T00:00:00.000Z'],
      ['2026-09-24T00:00:00.000Z', '2026-10-04T00:00:00.000Z'],
    ]);
  });
});

describe('生产 = 周期内生产运行的汇总 + 文章分析模型的全账户用量', () => {
  it('只算定时触发、在周期内开始的运行；没记汇总的算次数不算 neurons', async () => {
    at('2026-10-05T12:00:00Z');
    await insertRun('cron-brief-before', '2026-09-03T23:59:59', summary(1_000_000)); // 周期开始前一秒
    await insertRun('cron-brief-first', '2026-09-04T00:00:00', summary(3_000)); // 周期第一秒
    await insertRun('cron-brief-last', '2026-10-03T23:59:59', summary(2_000)); // 周期最后一秒
    await insertRun('cron-brief-after', '2026-10-04T00:00:00', summary(1_000_000)); // 下个周期
    await insertRun('cron-brief-unrecorded', '2026-09-20T13:00:00', null);
    await insertRun('manual-brief-1', '2026-09-20T14:00:00', summary(1_000_000)); // 手动运行不算生产
    cf.answer = onlyNeurons([neuronRow('2026-09-10', QWEN, 15_000), neuronRow('2026-09-10', GLM, 80_000)]);

    const { body } = await getCost('previous');

    expect(body.production).toEqual({ neurons: 20_000, runs: 3, runNeurons: 5_000, analysisNeurons: 15_000, share: expect.closeTo(20_000 / 95_000, 5) });
  });

  it('账户一点没用时占比是 0，不是 NaN', async () => {
    at('2026-10-05T12:00:00Z');
    const { body } = await getCost('current');
    expect(body.production).toEqual({ neurons: 0, runs: 0, runNeurons: 0, analysisNeurons: 0, share: 0 });
  });

  it('最近一次生产运行按阶段拆开：取周期结束前最近一次记了汇总的，阶段按 neurons 从大到小', async () => {
    at('2026-10-06T12:00:00Z');
    await insertRun('cron-brief-0930', '2026-09-30T13:00:00', summary(900, { brief_block_v6: { calls: 30, neurons: 900 } }));
    await insertRun(
      'cron-brief-1003',
      '2026-10-03T13:00:00',
      summary(2_100, { ranking: { calls: 3, neurons: 100 }, brief_block_v6: { calls: 39, neurons: 2_000 } })
    );
    await insertRun('cron-brief-1004', '2026-10-04T13:00:00', null); // 更新，但没记汇总
    await insertRun('manual-brief-1005', '2026-10-05T13:00:00', summary(50, { ranking: { calls: 1, neurons: 50 } }));
    await insertRun('cron-brief-1005', '2026-10-05T13:00:00', summary(80_000, { brief_block_v6: { calls: 390, neurons: 80_000 } }));

    expect((await getCost('current')).body.lastRunByStep).toEqual({
      workflowId: 'cron-brief-1005',
      day: '2026-10-05T13:00:00.000Z',
      steps: [{ phase: 'brief_block_v6', calls: 390, neurons: 80_000, usd: 0.88 }],
    });
    // 上一个周期只看到它结束之前的运行
    expect((await getCost('previous')).body.lastRunByStep).toEqual({
      workflowId: 'cron-brief-1003',
      day: '2026-10-03T13:00:00.000Z',
      steps: [
        { phase: 'brief_block_v6', calls: 39, neurons: 2_000, usd: 0.022 },
        { phase: 'ranking', calls: 3, neurons: 100, usd: 0.0011 },
      ],
    });
  });

  it('一次汇总都没有：lastRunByStep 是 null', async () => {
    at('2026-10-05T12:00:00Z');
    await insertRun('cron-brief-1004', '2026-10-04T13:00:00', null);
    expect((await getCost('current')).body.lastRunByStep).toBeNull();
  });
});

describe('DashScope 的花费：Cloudflare 看不到，从生产运行的汇总来', () => {
  it('每日用量里单列一项（按牌价折成 neurons），只出现在有它的北京日；手动运行和没有这一项的汇总不算', async () => {
    at('2026-10-07T12:00:00Z');
    await insertRun('cron-brief-1004', '2026-10-04T13:00:00', summary(80_000)); // 一次调用核查上线之前
    await insertRun('cron-brief-1005', '2026-10-05T13:00:00', summaryWithDashscope(30_000, 0.11));
    // UTC 6 日 16:30 = 北京 7 日 00:30：算在 7 日
    await insertRun('cron-brief-1006', '2026-10-06T16:30:00', summaryWithDashscope(30_000, 0.055));
    await insertRun('manual-brief-1005', '2026-10-05T14:00:00', summaryWithDashscope(30_000, 0.5));
    cf.answer = onlyNeurons([neuronRow('2026-10-05', V4, 20_000)]);

    const { body } = await getCost('current');

    expect(body.daily).toEqual([
      { day: '2026-10-04', byModel: {} },
      { day: '2026-10-05', byModel: { [V4]: 20_000, dashscope: 10_000 } },
      { day: '2026-10-06', byModel: {} },
      { day: '2026-10-07', byModel: { dashscope: 5_000 } },
    ]);
    // Cloudflare 的账与按模型的表不含它
    expect(body.account).toMatchObject({ neurons: 20_000 });
    expect(body.byModel).toEqual([{ modelId: V4, neurons: 20_000, share: 1, usdAtList: 0.22 }]);
  });

  it('生产占比只算 Workers AI：运行汇总里折进去的 DashScope 那部分先减掉', async () => {
    at('2026-10-07T12:00:00Z');
    await insertRun('cron-brief-1005', '2026-10-05T13:00:00', summaryWithDashscope(30_000, 0.11));
    cf.answer = onlyNeurons([neuronRow('2026-10-05', V4, 40_000)]);

    const { body } = await getCost('current');

    expect(body.production).toEqual({ neurons: 20_000, runs: 1, runNeurons: 20_000, analysisNeurons: 0, share: 0.5 });
  });
});

describe('其它计费项：占免费额度多少', () => {
  it('读得到的给用量和占比；容器内存、Workers Logs 没有数据集，留在表里、用量是 null', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = ({ dataset }) => {
      if (dataset === 'workersInvocationsAdaptive') return [{ sum: { requests: 122_070, cpuTimeUs: 2_041_003_690 } }];
      if (dataset === 'durableObjectsPeriodicGroups') return [{ sum: { duration: 100_000 } }];
      if (dataset === 'queueMessageOperationsAdaptiveGroups') return [{ sum: { billableOperations: 16_547 } }];
      if (dataset === 'r2OperationsAdaptiveGroups') {
        return [
          { sum: { requests: 90_003 }, dimensions: { actionType: 'PutObject' } }, // A 类
          { sum: { requests: 79 }, dimensions: { actionType: 'ListObjects' } }, // A 类
          { sum: { requests: 81_025 }, dimensions: { actionType: 'GetObject' } }, // B 类，不计
          { sum: { requests: 24 }, dimensions: { actionType: 'DeleteObject' } }, // 免费，不计
        ];
      }
      return [];
    };

    const { body } = await getCost('previous');

    expect(body.otherItems).toEqual([
      { name: 'Workers requests', unit: 'requests', allowance: 10_000_000, used: 122_070, share: expect.closeTo(0.012207, 6) },
      { name: 'Workers CPU time', unit: 'CPU ms', allowance: 30_000_000, used: expect.closeTo(2_041_003.69, 2), share: expect.closeTo(0.068033, 5) },
      { name: 'Durable Objects duration', unit: 'GB-s', allowance: 400_000, used: 100_000, share: 0.25 },
      { name: 'R2 Class A operations', unit: 'operations', allowance: 1_000_000, used: 90_082, share: expect.closeTo(0.090082, 6) },
      { name: 'Queues operations', unit: 'operations', allowance: 1_000_000, used: 16_547, share: expect.closeTo(0.016547, 6) },
      { name: 'Container memory', unit: 'GiB-hours', allowance: 25, used: null, share: null },
      { name: 'Workers Logs events', unit: 'events', allowance: 20_000_000, used: null, share: null },
    ]);
    // 每个数据集都按这个周期问：按日的问 UTC 日的两端，每日用量图按小时问、落在周期的 UTC 起止之内
    for (const r of cf.requests) {
      if ('from' in r.variables) expect(r.variables).toMatchObject({ from: '2026-09-04', to: '2026-10-03' });
      else {
        expect(r.variables.since >= '2026-09-04T00:00:00.000Z').toBe(true);
        expect(r.variables.until <= '2026-10-04T00:00:00.000Z').toBe(true);
      }
    }
  });

  it('一个数据集报错：只有那一项变成读不到，别的项和模型账单照常', async () => {
    at('2026-10-05T12:00:00Z');
    cf.answer = ({ dataset }) => {
      if (dataset === 'r2OperationsAdaptiveGroups') return { errors: [{ message: 'unknown field "requests"' }] };
      if (dataset === 'queueMessageOperationsAdaptiveGroups') return [{ sum: { billableOperations: 500_000 } }];
      if (dataset === 'aiInferenceAdaptiveGroups') return [neuronRow('2026-10-04', GLM, 5_000)];
      return [];
    };

    const { status, body } = await getCost('current');

    expect(status).toBe(200);
    const item = (name: string) => body.otherItems.find(i => i.name === name);
    expect(item('R2 Class A operations')).toEqual({ name: 'R2 Class A operations', unit: 'operations', allowance: 1_000_000, used: null, share: null });
    expect(item('Queues operations')).toMatchObject({ used: 500_000, share: 0.5 });
    expect(body.account).toMatchObject({ neurons: 5_000 });
  });
});

describe('Cloudflare 读不到：受影响的块说明原因，端点照常回 200', () => {
  const failures: Array<{ name: string; answer: () => FakeCloudflareAnswer; reason: string }> = [
    {
      name: 'HTTP 403（token 没权限或已失效）',
      answer: () => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }),
      reason: 'Cloudflare analytics replied HTTP 403',
    },
    {
      name: 'GraphQL 层报错（HTTP 200 带 errors）',
      answer: () => ({ errors: [{ message: 'quota exceeded: time range too large' }] }),
      reason: 'Cloudflare analytics error: quota exceeded: time range too large',
    },
    {
      name: '连不上',
      answer: () => {
        throw new TypeError('connection reset');
      },
      reason: 'Cloudflare analytics unreachable: connection reset',
    },
  ];

  for (const { name, answer, reason } of failures) {
    it(name, async () => {
      at('2026-10-05T12:00:00Z');
      await insertRun('cron-brief-1004', '2026-10-04T13:00:00', summary(2_097, { ranking: { calls: 3, neurons: 136 } }));
      cf.answer = answer;

      const { status, body } = await getCost('current');

      expect(status).toBe(200);
      expect(body.account).toEqual({ unavailable: reason });
      expect(body.production).toEqual({ unavailable: reason });
      expect(body.daily).toEqual({ unavailable: reason });
      expect(body.byModel).toEqual({ unavailable: reason });
      // 不靠 Cloudflare 的部分照常给
      expect(body.cycle).toEqual({ start: '2026-10-04', end: '2026-11-03', day: 2, days: 31, complete: false });
      expect(body.lastRunByStep?.workflowId).toBe('cron-brief-1004');
      // 其它项全在表里，用量都是 null
      expect(body.otherItems).toHaveLength(7);
      expect(body.otherItems.every(i => i.used === null && i.share === null)).toBe(true);
    });
  }
});

describe('Cloudflare 客户端：生产 Worker 的报错次数（08、09 号票用）', () => {
  // Cloudflare 按小时给数（datetimeHour，UTC）；date 是北京日，这里放在北京当天 13 点
  const invocation = (date: string, scriptName: string, status: string, scriptVersion: string, requests: number) => ({
    sum: { requests },
    dimensions: { datetimeHour: `${date}T05:00:00Z`, scriptName, status, scriptVersion },
  });

  it('只算生产版本（scriptVersion 非空）；success 和 clientDisconnected 不算报错；按日、按服务合计', async () => {
    cf.answer = () => [
      invocation('2026-10-04', 'meridian-backend', 'scriptThrewException', 'v-backend-1', 2),
      invocation('2026-10-04', 'meridian-backend', 'exceededCpu', 'v-backend-2', 1), // 同日另一个版本、另一种报错，合进同一格
      invocation('2026-10-04', 'meridian-backend', 'scriptThrewException', '', 2_342), // 本地 wrangler dev 的预览会话
      invocation('2026-10-04', 'meridian-backend', 'success', 'v-backend-1', 110),
      invocation('2026-10-04', 'meridian-backend', 'clientDisconnected', 'v-backend-1', 12),
      invocation('2026-10-04', 'meridian-ai-worker', 'loadShed', '', 1_351),
      invocation('2026-10-05', 'meridian-ai-worker', 'loadShed', 'v-ai-1', 4),
      invocation('2026-10-05', 'meridian-ml-service', 'internalError', 'v-ml-1', 1),
      invocation('2026-10-05', 'some-other-worker', 'scriptThrewException', 'v-x', 9),
    ];

    const rows = await workerErrorsByDay(env, new Date('2026-10-04T00:00:00Z'), new Date('2026-10-06T00:00:00Z'));

    expect(rows).toEqual([
      { day: '2026-10-04', service: 'backend', errors: 3 },
      { day: '2026-10-05', service: 'ai-worker', errors: 4 },
      { day: '2026-10-05', service: 'ml-service', errors: 1 },
    ]);
    expect(cf.requests).toHaveLength(1);
    expect(cf.requests[0].variables).toMatchObject({ since: '2026-10-04T00:00:00.000Z', until: '2026-10-06T00:00:00.000Z' });
  });

  it('按北京日归日：UTC 15 点还是北京当天，UTC 16 点已是北京第二天', async () => {
    const at = (datetimeHour: string, requests: number) => ({
      sum: { requests },
      dimensions: { datetimeHour, scriptName: 'meridian-backend', status: 'scriptThrewException', scriptVersion: 'v1' },
    });
    cf.answer = () => [at('2026-10-04T15:00:00Z', 1), at('2026-10-04T16:00:00Z', 2), at('2026-10-04T23:00:00Z', 4)];

    const rows = await workerErrorsByDay(env, new Date('2026-10-04T00:00:00Z'), new Date('2026-10-06T00:00:00Z'));

    expect(rows).toEqual([
      { day: '2026-10-04', service: 'backend', errors: 1 },
      { day: '2026-10-05', service: 'backend', errors: 6 },
    ]);
  });

  it('超过 31 天的范围分段查，结果拼在一起', async () => {
    cf.answer = ({ variables }) =>
      variables.since.startsWith('2026-07')
        ? [invocation('2026-07-10', 'meridian-backend', 'scriptThrewException', 'v1', 1)]
        : [invocation('2026-09-20', 'meridian-backend', 'scriptThrewException', 'v2', 5)];

    const rows = await workerErrorsByDay(env, new Date('2026-07-07T00:00:00Z'), new Date('2026-10-05T00:00:00Z'));

    expect(cf.requests.map(r => [r.variables.since, r.variables.until])).toEqual([
      ['2026-07-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z'],
      ['2026-08-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'],
      ['2026-09-07T00:00:00.000Z', '2026-10-05T00:00:00.000Z'],
    ]);
    expect(rows).toEqual([
      { day: '2026-07-10', service: 'backend', errors: 1 },
      { day: '2026-09-20', service: 'backend', errors: 10 },
    ]);
  });

  it('Cloudflare 报错时抛出带原因的错误，由调用方转成 unavailable', async () => {
    cf.answer = () => new Response('nope', { status: 500 });
    await expect(workerErrorsByDay(env, new Date('2026-10-04T00:00:00Z'), new Date('2026-10-05T00:00:00Z'))).rejects.toThrow(
      'Cloudflare analytics replied HTTP 500'
    );
  });
});
