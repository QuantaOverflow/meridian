/**
 * 运维台 Trends（GET /observability/ops/trends?days=N）。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * Cloudflare GraphQL Analytics 由 test/fake-cloudflare.ts 假冒。「现在」用 vitest 的假时钟定（只换 Date）。
 */
import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { $articles, $brief_runs, $sources, sql } from '@meridian/database';
import type { OpsTrends, RunOpsSummary } from '@meridian/contracts';
import { getDb } from '../../src/lib/database';
import { fakeCloudflare } from '../fake-cloudflare';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const cf = fakeCloudflare(env.CF_API_BASE_URL);

// 北京时间 2026-10-20 12:00
const NOW = '2026-10-20T04:00:00Z';

async function getTrends(query = '') {
  const res = await exports.default.fetch(`http://backend/observability/ops/trends${query}`, {
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
  });
  return { status: res.status, body: (await res.json()) as OpsTrends };
}

const summary = (neurons: number, over: Partial<RunOpsSummary> = {}): RunOpsSummary => ({
  v: 1,
  llm: { calls: 10, neurons, byPhase: {} },
  steps: [],
  blocks: null,
  check: null,
  degradedReasons: [],
  ...over,
});

/** 北京 21:00 开跑（13:00 UTC），默认 30 分钟、80000 neurons */
async function insertRun(
  workflowId: string,
  day: string,
  over: { minutes?: number; neurons?: number; summary?: RunOpsSummary | null } = {}
) {
  const { minutes = 30, neurons = 80_000 } = over;
  const started = new Date(`${day}T13:00:00Z`);
  await db.insert($brief_runs).values({
    workflow_id: workflowId,
    status: 'COMPLETED',
    started_at: started,
    finished_at: new Date(started.getTime() + minutes * 60_000),
    ops_summary: over.summary === undefined ? summary(neurons) : over.summary,
  });
}

let n = 0;
let sourceId: number;
async function article(createdAtUtc: string, over: Partial<typeof $articles.$inferInsert> = {}) {
  await db.insert($articles).values({
    sourceId,
    title: 't',
    url: `https://news.example.com/trends-${n++}`,
    status: 'PROCESSED',
    createdAt: new Date(createdAtUtc),
    ...over,
  });
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

beforeEach(async () => {
  cf.reset();
  await db.execute(sql`truncate brief_runs, articles, sources restart identity cascade`);
  const [s] = await db
    .insert($sources)
    .values({ url: 'https://feeds.example.com/trends.xml', name: 'Trends source', category: 'news', scrape_frequency: 2 })
    .returning({ id: $sources.id });
  sourceId = s.id;
});

afterAll(() => {
  vi.useRealTimers();
  cf.restore();
});

describe('days 参数', () => {
  it('默认 30，范围 7–90；越界或不是数字回 400', async () => {
    expect((await getTrends()).body.days).toBe(30);
    expect((await getTrends('?days=7')).body.days).toBe(7);
    expect((await getTrends('?days=90')).body.days).toBe(90);
    for (const bad of ['6', '91', '0', '-5', 'abc', '', '7.5']) {
      expect((await getTrends(`?days=${bad}`)).status, bad).toBe(400);
    }
  });

  it('每个北京日一行，最后一行是今天，没有文章的日子补 0', async () => {
    const { body } = await getTrends('?days=7');
    expect(body.ingest.map(d => d.day)).toEqual([
      '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
    ]);
    expect(body.ingest[0]).toEqual({ day: '2026-10-14', processed: 0, fetchFailed: 0, junk: 0, bodies: 0, singleLine: null });
  });
});

describe('入库按北京日', () => {
  it('UTC 15:59 与 16:00 的文章落在不同的北京日', async () => {
    await article('2026-10-15T15:59:00Z');
    await article('2026-10-15T16:00:00Z');
    const { body } = await getTrends('?days=7');
    const byDay = Object.fromEntries(body.ingest.map(d => [d.day, d.processed]));
    expect(byDay['2026-10-15']).toBe(1);
    expect(byDay['2026-10-16']).toBe(1);
  });

  it('范围之前的文章不算；垃圾页与抓取失败分开数', async () => {
    await article('2026-10-13T15:59:00Z'); // 北京 10-13 23:59，在 7 天范围外
    await article('2026-10-18T02:00:00Z', { status: 'FETCH_FAILED', failReason: 'HTTP 503' });
    await article('2026-10-18T02:00:00Z', { status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: paywall' });
    await article('2026-10-18T02:00:00Z', { status: 'FETCH_FAILED', failReason: null });
    await article('2026-10-18T02:00:00Z');
    const { body } = await getTrends('?days=7');
    expect(body.ingest.reduce((a, d) => a + d.processed, 0)).toBe(1);
    expect(body.ingest.find(d => d.day === '2026-10-18')).toEqual({
      day: '2026-10-18', processed: 1, fetchFailed: 2, junk: 1, bodies: 0, singleLine: null,
    });
  });

  it('单行占比：有记录的日子给条数，没记录（body_lines 全为 null）的日子是 null，不是 0', async () => {
    await article('2026-10-18T02:00:00Z', { body_lines: 1 });
    await article('2026-10-18T02:00:00Z', { body_lines: 1 });
    await article('2026-10-18T02:00:00Z', { body_lines: 9 });
    await article('2026-10-19T02:00:00Z', { body_lines: null });
    await article('2026-10-20T02:00:00Z', { body_lines: 4 });
    const { body } = await getTrends('?days=7');
    const day = (d: string) => body.ingest.find(x => x.day === d)!;
    expect(day('2026-10-18')).toMatchObject({ bodies: 3, singleLine: 2 });
    expect(day('2026-10-19')).toMatchObject({ processed: 1, bodies: 0, singleLine: null });
    expect(day('2026-10-20')).toMatchObject({ bodies: 1, singleLine: 0 });
  });
});

describe('生产运行与基线', () => {
  it('只列定时触发的运行，旧的在前；手动运行不出现', async () => {
    await insertRun('cron-brief-b', '2026-10-17');
    await insertRun('manual-brief-x', '2026-10-18');
    await insertRun('cron-brief-a', '2026-10-16');
    const { body } = await getTrends('?days=7');
    expect(body.runs.map(r => r.workflowId)).toEqual(['cron-brief-a', 'cron-brief-b']);
  });

  it('基线从 2026-10-05 起算：之前的运行不判灯；满 5 次后慢和贵的运行被标黄，中位数给出', async () => {
    await insertRun('cron-brief-old', '2026-10-03', { minutes: 600, neurons: 9_000_000 });
    for (const d of [5, 6, 7, 8, 9]) await insertRun(`cron-brief-${d}`, `2026-10-0${d}`);
    await insertRun('cron-brief-slow', '2026-10-10', { minutes: 100, neurons: 400_000 });

    const { body } = await getTrends('?days=30');
    const row = (id: string) => body.runs.find(r => r.workflowId === id)!;
    expect(row('cron-brief-old')).toMatchObject({ level: 'ok', flags: [] });
    expect(row('cron-brief-9')).toMatchObject({ level: 'ok', flags: [] });
    expect(row('cron-brief-slow')).toMatchObject({ level: 'yellow', flags: ['slow', 'costly'] });
    expect(body.medianDurationMs).toBe(30 * 60_000);
    expect(body.medianUsd).toBeCloseTo((80_000 * 0.011) / 1000, 6);
  });

  it('基线内不足 5 次：中位数是 null，不判慢也不判贵', async () => {
    for (const d of [5, 6, 7]) await insertRun(`cron-brief-${d}`, `2026-10-0${d}`);
    await insertRun('cron-brief-slow', '2026-10-10', { minutes: 100, neurons: 400_000 });
    const { body } = await getTrends('?days=30');
    expect(body.medianDurationMs).toBeNull();
    expect(body.medianUsd).toBeNull();
    expect(body.runs.find(r => r.workflowId === 'cron-brief-slow')).toMatchObject({ level: 'ok', flags: [] });
  });
});

describe('核查结果', () => {
  it('只列汇总里有核查记录的运行', async () => {
    await insertRun('cron-brief-nosum', '2026-10-16', { summary: null });
    await insertRun('cron-brief-nocheck', '2026-10-17');
    await insertRun('cron-brief-checked', '2026-10-18', {
      summary: summary(80_000, {
        blocks: { expected: 20, written: 18, tiers: { lead: 4, more: 8, brief: 6 }, writeRejects: 0 },
        check: {
          outcomes: { off: 0, clean: 14, fixed: 3, revise_failed: 1, still_flagged: 0, missing: 0 },
          uncheckedBlocks: 1,
          revisions: 4,
        },
      }),
    });
    const { body } = await getTrends('?days=7');
    expect(body.checks).toEqual([
      { workflowId: 'cron-brief-checked', day: '2026-10-18', clean: 14, fixed: 3, unchecked: 1, notWritten: 2 },
    ]);
  });
});

describe('Worker 报错', () => {
  const invocation = (date: string, scriptName: string, status: string, requests: number) => ({
    sum: { requests },
    dimensions: { date, scriptName, status, scriptVersion: 'v1' },
  });

  it('按 UTC 日、按服务，范围内每天都有一行（没报错的补 0）', async () => {
    cf.answer = () => [
      invocation('2026-10-18', 'meridian-backend', 'scriptThrewException', 3),
      invocation('2026-10-18', 'meridian-ai-worker', 'exceededCpu', 2),
      invocation('2026-10-20', 'meridian-ml-service', 'scriptThrewException', 1),
    ];
    const { status, body } = await getTrends('?days=7');
    expect(status).toBe(200);
    if (!Array.isArray(body.workerErrors)) throw new Error('应当有数');
    expect(body.workerErrors.map(d => d.day)).toEqual([
      '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
    ]);
    expect(body.workerErrors.find(d => d.day === '2026-10-18')).toEqual({ day: '2026-10-18', backend: 3, aiWorker: 2, mlService: 0 });
    expect(body.workerErrors.find(d => d.day === '2026-10-20')).toEqual({ day: '2026-10-20', backend: 0, aiWorker: 0, mlService: 1 });
    expect(body.workerErrors.find(d => d.day === '2026-10-14')).toEqual({ day: '2026-10-14', backend: 0, aiWorker: 0, mlService: 0 });
  });

  it('Cloudflare 读不到：workerErrors 给 unavailable 与原因，端点仍回 200，其余照常', async () => {
    cf.answer = () => new Response('nope', { status: 500 });
    await insertRun('cron-brief-a', '2026-10-16');
    const { status, body } = await getTrends('?days=7');
    expect(status).toBe(200);
    expect(body.workerErrors).toEqual({ unavailable: 'Cloudflare analytics replied HTTP 500' });
    expect(body.runs).toHaveLength(1);
  });
});
