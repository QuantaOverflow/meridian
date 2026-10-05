/**
 * 运维台「一次生产运行」的判灯（src/lib/ops/run-rows.ts）。健康页、趋势页、运行详情页共用这份判据，
 * 三张票并行实现时都拿它当既定事实，所以在各端点接上之前先钉住。端点自己的测试走 HTTP（见各票）。
 */
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RunOpsSummary } from '@meridian/contracts';
import { BASELINE_MIN_RUNS, baselineFrom, toRunRow, type BriefRunRecord } from '../../src/lib/ops/run-rows';

const summary = (neurons: number): RunOpsSummary => ({
  v: 1,
  llm: { calls: 10, neurons, byPhase: {} },
  steps: [],
  blocks: { expected: 20, written: 20, tiers: { lead: 4, more: 8, brief: 8 }, writeRejects: 0 },
  check: null,
  degradedReasons: [],
});

/** day：2026-10-<day> 的 21:00 北京时间开跑 */
function run(day: number, over: Partial<BriefRunRecord> & { minutes?: number; neurons?: number | null } = {}): BriefRunRecord {
  const { minutes = 30, neurons = 80_000, ...rest } = over;
  const started = new Date(Date.UTC(2026, 9, day, 13, 0));
  return {
    id: day,
    workflow_id: `cron-brief-${day}`,
    status: 'COMPLETED',
    params: null,
    started_at: started,
    finished_at: new Date(started.getTime() + minutes * 60_000),
    total_articles: 400,
    clusters_found: 30,
    stories_identified: 25,
    intelligence_analyses: 25,
    brief_content_length: 20_000,
    report_id: null,
    error: null,
    ops_summary: neurons === null ? null : summary(neurons),
    ...rest,
  };
}

const NOW = new Date('2026-10-20T00:00:00Z');
const fiveBaselineRuns = [5, 6, 7, 8, 9].map(d => run(d));

describe('基线', () => {
  it(`基线内不足 ${BASELINE_MIN_RUNS} 次：没有中位数，不判慢也不判贵`, () => {
    const earlier = fiveBaselineRuns.slice(0, BASELINE_MIN_RUNS - 1);
    const baseline = baselineFrom(earlier);
    expect(baseline).toEqual({ runs: BASELINE_MIN_RUNS - 1, medianDurationMs: null, medianNeurons: null });
    expect(toRunRow(run(10, { minutes: 300, neurons: 9_000_000 }), baseline, NOW)).toMatchObject({ level: 'ok', flags: [] });
  });

  it('基线开始日之前的运行不进中位数', () => {
    const old = [1, 2, 3, 4].map(d => run(d, { minutes: 5, neurons: 2_000 }));
    expect(baselineFrom([...old, ...fiveBaselineRuns])).toEqual({
      runs: 5,
      medianDurationMs: 30 * 60_000,
      medianNeurons: 80_000,
    });
  });

  it('没跑完的、没记汇总的运行：前者不算基线，后者不进成本中位数', () => {
    const failed = run(10, { status: 'FAILED' });
    const noSummary = run(11, { neurons: null, minutes: 40 });
    const baseline = baselineFrom([...fiveBaselineRuns, failed, noSummary]);
    expect(baseline.runs).toBe(6);
    expect(baseline.medianNeurons).toBe(80_000);
  });
});

describe('判灯', () => {
  const baseline = baselineFrom(fiveBaselineRuns);

  it('耗时恰好 1.5 倍不算慢，超过才算；成本同理', () => {
    expect(toRunRow(run(10, { minutes: 45 }), baseline, NOW).flags).toEqual([]);
    expect(toRunRow(run(10, { minutes: 46 }), baseline, NOW)).toMatchObject({ level: 'yellow', flags: ['slow'] });
    expect(toRunRow(run(10, { neurons: 120_000 }), baseline, NOW).flags).toEqual([]);
    expect(toRunRow(run(10, { neurons: 120_001 }), baseline, NOW)).toMatchObject({ level: 'yellow', flags: ['costly'] });
  });

  it('DEGRADED 黄；FAILED、没选出新闻红', () => {
    expect(toRunRow(run(10, { status: 'DEGRADED' }), baseline, NOW)).toMatchObject({ level: 'yellow', flags: ['degraded'] });
    expect(toRunRow(run(10, { status: 'FAILED', finished_at: null }), baseline, NOW)).toMatchObject({ level: 'red', flags: ['failed'] });
    expect(toRunRow(run(10, { status: 'TERMINATED_NO_STORIES' }), baseline, NOW)).toMatchObject({ level: 'red', flags: ['no_stories'] });
  });

  it('还在跑：北京时间 22:00 前不亮灯，到 22:00 还没完红', () => {
    const running = run(10, { status: 'RUNNING', finished_at: null });
    expect(toRunRow(running, baseline, new Date('2026-10-10T13:59:59Z'))).toMatchObject({ level: 'ok', flags: [] });
    expect(toRunRow(running, baseline, new Date('2026-10-10T14:00:00Z'))).toMatchObject({ level: 'red', flags: ['late'] });
  });

  it('成本按牌价算；没记汇总时调用数、neurons、成本都是 null', () => {
    expect(toRunRow(run(10, { neurons: 100_000 }), baseline, NOW)).toMatchObject({ calls: 10, neurons: 100_000, usd: 1.1 });
    expect(toRunRow(run(10, { neurons: null }), baseline, NOW)).toMatchObject({ calls: null, neurons: null, usd: null, blocks: 25 });
  });
});

describe('运维台端点的门', () => {
  const paths = ['health', 'trends', 'cost', 'sources', 'runs/cron-brief-1'];

  it('不带 token 一律 401', async () => {
    for (const p of paths) {
      expect((await exports.default.fetch(`http://backend/observability/ops/${p}`)).status, p).toBe(401);
    }
  });

  it('带 token 能打到各自的 handler（不是没挂上路由）', async () => {
    for (const p of paths) {
      const res = await exports.default.fetch(`http://backend/observability/ops/${p}`, {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(res.status, p).not.toBe(401);
      // 没挂上的路由回的是 Hono 默认的纯文本 404；运行详情查不到那次运行时回的是 JSON 404，属于打到了
      expect(res.headers.get('content-type') ?? '', p).toContain('application/json');
    }
  });
});
