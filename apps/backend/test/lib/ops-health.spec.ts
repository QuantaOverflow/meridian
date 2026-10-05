/**
 * 运维台 Health：GET /observability/ops/health。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * Cloudflare GraphQL Analytics 由 test/fake-cloudflare.ts 假冒，AI_WORKER / ML_SERVICE 两个 service binding 换成按契约回包的假对象。
 * 「现在」用 vitest 的假时钟定（只换 Date），所以 22:00 这类钟点阈值的两侧都能卡准；被测代码没有只给测试用的入口。
 * 运行行的判灯规则本身在 ops-run-rows.spec.ts 钉过，这里看的是端点怎么把它们拼成「今天」、各面板和待处理清单。
 */
import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { $articles, $brief_runs, $sources, sql } from '@meridian/database';
import type { OpsHealth, OpsServiceVersion, RunOpsSummary } from '@meridian/contracts';
import { getDb } from '../../src/lib/database';
import { fakeCloudflare, type FakeCloudflareAnswer, type FakeCloudflareRequest } from '../fake-cloudflare';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const cf = fakeCloudflare(env.CF_API_BASE_URL);
const realBindings = { AI_WORKER: env.AI_WORKER, ML_SERVICE: env.ML_SERVICE };

const HOUR = 3_600_000;
const MIN = 60_000;
const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8';
const GLM = '@cf/zai-org/glm-4.7-flash';

// ── 时钟：今天 = 北京时间 2026-10-20 ──────────────────────────────────
/** 把「现在」定在北京时间 10 月 20 日的某个钟点 */
function atBeijing(hhmmss: string) {
  vi.setSystemTime(new Date(`2026-10-20T${hhmmss}+08:00`));
}
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

// ── 假的服务 binding ──────────────────────────────────────────────────
type Binding = { fetch(request: Request): Promise<Response> };

const aiWorkerVersion: OpsServiceVersion = {
  service: 'ai-worker',
  commit: 'a1b2c3d',
  title: 'fix(ai-worker): x',
  dirty: false,
  deployedAt: '2026-10-04T09:00:00.000Z',
  versionId: 'ai-version-id',
  health: 'healthy',
};
const aiWorker: Binding = { fetch: async () => Response.json({ success: true, data: aiWorkerVersion }) };
const mlHealthy: Binding = {
  fetch: async () => Response.json({ status: 'healthy', build_identity: { build_time: '2026-10-03T08:30:00Z', injected: true, git_commit: 'e4f5a6b' } }),
};
const unreachable: Binding = {
  fetch: async () => {
    throw new Error('Service binding not connected');
  },
};
const failing: Binding = { fetch: async () => new Response('boom', { status: 503 }) };

async function request(bindings: Record<string, unknown> = {}, token: string | null = env.API_TOKEN) {
  // 走真正的子请求（每次请求自己的连接随请求结束关掉；用 app.request 时连接攒在测试这一个上下文里，几十次请求就把本机库的连接数占满）。
  // 子请求拿不到另传的 env，所以两个 service binding 直接换在共用的 env 上，afterAll 换回
  Object.assign(env, { AI_WORKER: aiWorker, ML_SERVICE: mlHealthy, ...bindings });
  return exports.default.fetch('http://backend/observability/ops/health', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function health(bindings: Record<string, unknown> = {}): Promise<OpsHealth> {
  const res = await request(bindings);
  expect(res.status).toBe(200);
  return (await res.json()) as OpsHealth;
}

// ── 灌数据 ────────────────────────────────────────────────────────────
const summary = (neurons: number, degradedReasons: string[] = []): RunOpsSummary => ({
  v: 1,
  llm: { calls: 10, neurons, byPhase: {} },
  steps: [],
  blocks: null,
  check: null,
  degradedReasons,
});

interface RunSpec {
  status?: (typeof $brief_runs.$inferInsert)['status'];
  /** 开跑时刻，默认那天北京时间 21:00 */
  startedAt?: string;
  /** 跑了多久；RUNNING 的没有结束时间 */
  ms?: number;
  neurons?: number | null;
  degradedReasons?: string[];
  id?: string;
  error?: string;
}

/** day：10 月的哪一天（北京日） */
async function run(day: number, spec: RunSpec = {}) {
  const { status = 'COMPLETED', ms = 30 * MIN, neurons = 80_000, degradedReasons, error } = spec;
  const started = new Date(spec.startedAt ?? `2026-10-${String(day).padStart(2, '0')}T21:00:00+08:00`);
  await db.insert($brief_runs).values({
    workflow_id: spec.id ?? `cron-brief-${day}`,
    status,
    started_at: started,
    finished_at: status === 'RUNNING' ? null : new Date(started.getTime() + ms),
    total_articles: 400,
    stories_identified: 25,
    intelligence_analyses: 25,
    error,
    ops_summary: neurons === null ? null : summary(neurons, degradedReasons),
  });
}

/** 基线：10 月 15–19 日五次正常运行，各 30 分钟、80,000 neurons */
const baseline = () => Promise.all([15, 16, 17, 18, 19].map(d => run(d)));

let n = 0;
/** 默认：每 4 小时一抓、1 小时前刚查过、没暂停 */
async function source(over: Partial<typeof $sources.$inferInsert> = {}) {
  n++;
  const [row] = await db
    .insert($sources)
    .values({ url: `https://feeds.example.com/ops-health-${n}.xml`, name: `Source ${n}`, category: 'news', scrape_frequency: 2, lastChecked: ago(1), ...over })
    .returning({ id: $sources.id });
  return row.id;
}

interface ArticleSpec {
  hoursAgo?: number;
  status?: (typeof $articles.$inferInsert)['status'];
  failReason?: string | null;
  bodyLines?: number | null;
  usedBrowser?: boolean | null;
}

async function articles(sourceId: number, count: number, spec: ArticleSpec = {}) {
  const { hoursAgo = 1, status = 'PROCESSED', failReason = null, bodyLines = 5, usedBrowser = null } = spec;
  await db.insert($articles).values(
    Array.from({ length: count }, () => ({
      sourceId,
      title: 't',
      url: `https://news.example.com/h-${n++}`,
      status,
      failReason,
      body_lines: bodyLines,
      used_browser: usedBrowser,
      createdAt: ago(hoursAgo),
    }))
  );
}

const neuronRow = (date: string, modelId: string, totalNeurons: number) => ({ sum: { totalNeurons }, dimensions: { date, modelId } });
const errorRow = (date: string, scriptName: string, status: string, requests: number, scriptVersion = 'v1') => ({
  sum: { requests },
  // Cloudflare 按小时给数（datetimeHour，UTC）
  dimensions: { datetimeHour: `${date}T05:00:00Z`, scriptName, status, scriptVersion },
});

function cloudflareAnswers(answers: { neurons?: unknown[]; errors?: unknown[] }) {
  cf.answer = (request: FakeCloudflareRequest): FakeCloudflareAnswer =>
    request.dataset === 'aiInferenceAdaptiveGroups' ? (answers.neurons ?? []) : request.dataset === 'workersInvocationsAdaptive' ? (answers.errors ?? []) : [];
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

beforeEach(async () => {
  cf.reset();
  atBeijing('12:00:00');
  await db.execute(sql`truncate brief_runs, sources, articles restart identity cascade`);
});

afterAll(() => {
  vi.useRealTimers();
  cf.restore();
  Object.assign(env, realBindings);
});

describe('今天的生产运行：状态表的每一行', () => {
  it('21:00 前还没有运行行：scheduled，不亮灯，不进待处理', async () => {
    atBeijing('20:59:59');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'scheduled', level: 'ok', run: null });
    expect(body.attention).toEqual([]);
    expect(body.generatedAt).toBe('2026-10-20T12:59:59.000Z');
  });

  it('21:00 到 22:00 之间还没有运行行：仍是 scheduled', async () => {
    atBeijing('21:59:59');
    expect((await health()).today).toMatchObject({ state: 'scheduled', level: 'ok', run: null });
  });

  it('22:00 还没有运行行：红，待处理里有一行说简报迟了或没出', async () => {
    atBeijing('22:00:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'red', run: null });
    expect(body.attention).toEqual([
      { level: 'red', title: "Today's brief is late or missing", detail: 'No production run has started today · due at 21:00, red after 22:00', link: 'trends' },
    ]);
  });

  it('运行中、22:00 前：running，不亮灯', async () => {
    await run(20, { status: 'RUNNING' });
    atBeijing('21:59:59');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'running', level: 'ok', run: { workflowId: 'cron-brief-20', status: 'RUNNING', flags: [] } });
    expect(body.attention).toEqual([]);
  });

  it('到 22:00 还在跑：红（late），待处理那行连到这次运行', async () => {
    await run(20, { status: 'RUNNING' });
    atBeijing('22:00:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'running', level: 'red', run: { flags: ['late'] } });
    expect(body.attention).toEqual([
      { level: 'red', title: "Today's run is still running after 22:00", detail: 'Started 21:00 · not finished by 22:00', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('失败：红，原因带在待处理那行里', async () => {
    await run(20, { status: 'FAILED', error: 'LLM call exhausted retries' });
    atBeijing('21:40:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'red', run: { status: 'FAILED', flags: ['failed'] } });
    expect(body.attention).toEqual([
      { level: 'red', title: "Today's run failed", detail: 'LLM call exhausted retries', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('没有 story 就结束：红', async () => {
    await run(20, { status: 'TERMINATED_NO_STORIES' });
    atBeijing('21:40:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'red', run: { flags: ['no_stories'] } });
    expect(body.attention).toEqual([
      { level: 'red', title: "Today's run ended with no stories", detail: 'No brief was published', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('DEGRADED：黄，待处理那行列出降级原因', async () => {
    await run(20, { status: 'DEGRADED', degradedReasons: ['brief_blocks: 2 of 25 blocks not written'] });
    atBeijing('21:40:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'yellow', run: { flags: ['degraded'] } });
    expect(body.attention).toEqual([
      { level: 'yellow', title: "Today's run was degraded", detail: 'brief_blocks: 2 of 25 blocks not written', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('耗时刚好是基线中位数的 1.5 倍不算慢，多一秒就黄', async () => {
    await baseline();
    await run(20, { ms: 45 * MIN });
    atBeijing('23:00:00');
    let body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'ok', run: { flags: [] } });
    expect(body.attention).toEqual([]);

    await db.execute(sql`delete from brief_runs where workflow_id = 'cron-brief-20'`);
    await run(20, { ms: 45 * MIN + 1000 });
    body = await health();
    expect(body.today).toMatchObject({ state: 'done', level: 'yellow', run: { flags: ['slow'] } });
    expect(body.attention).toEqual([
      { level: 'yellow', title: "Today's run was slow", detail: 'Took 45m 1s · slow above 45m 0s', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('成本刚好是基线中位数的 1.5 倍不算贵，多一个 neuron 就黄', async () => {
    await baseline();
    await run(20, { neurons: 120_000 });
    atBeijing('23:00:00');
    expect((await health()).today).toMatchObject({ level: 'ok', run: { flags: [] } });

    await db.execute(sql`delete from brief_runs where workflow_id = 'cron-brief-20'`);
    await run(20, { neurons: 120_001 });
    const body = await health();
    expect(body.today).toMatchObject({ level: 'yellow', run: { flags: ['costly'] } });
    expect(body.attention).toEqual([
      { level: 'yellow', title: "Today's run was costly", detail: 'Cost $1.32 · costly above $1.32', link: { run: 'cron-brief-20' } },
    ]);
  });

  it('「今天」按北京日：昨天深夜开跑的不算今天的，今天凌晨开跑的算', async () => {
    await run(19, { startedAt: '2026-10-19T23:59:59+08:00', id: 'cron-brief-yesterday' });
    atBeijing('09:00:00');
    expect((await health()).today).toMatchObject({ state: 'scheduled', run: null });

    await run(20, { startedAt: '2026-10-20T00:00:00+08:00', id: 'cron-brief-today' });
    expect((await health()).today).toMatchObject({ state: 'done', run: { workflowId: 'cron-brief-today' } });
  });

  it('手动运行不算今天的生产运行，也不进运行表', async () => {
    await run(20, { id: 'manual-brief-20', status: 'FAILED' });
    atBeijing('21:30:00');
    const body = await health();
    expect(body.today).toMatchObject({ state: 'scheduled', level: 'ok', run: null });
    expect(body.runs).toEqual([]);
  });
});

describe('基线与运行表', () => {
  it('基线不足 5 次：给出已有几次，没有中位数和慢线', async () => {
    await Promise.all([16, 17, 18, 19].map(d => run(d)));
    expect((await health()).today).toMatchObject({ baselineRuns: 4, baselineMin: 5, medianDurationMs: null, slowAboveMs: null });
  });

  it('满 5 次：中位数与慢线（1.5 倍）', async () => {
    await baseline();
    expect((await health()).today).toMatchObject({ baselineRuns: 5, baselineMin: 5, medianDurationMs: 30 * MIN, slowAboveMs: 45 * MIN });
  });

  it('运行表是最近 14 次生产运行，新的在前，每行带自己的灯', async () => {
    await Promise.all(Array.from({ length: 15 }, (_, i) => run(5 + i))); // 10 月 5–19 日
    await run(20, { ms: 50 * MIN });
    atBeijing('23:00:00');
    const { runs } = await health();
    expect(runs.map(r => r.workflowId)).toEqual(Array.from({ length: 14 }, (_, i) => `cron-brief-${20 - i}`));
    expect(runs[0]).toMatchObject({ level: 'yellow', flags: ['slow'], durationMs: 50 * MIN, articles: 400, stories: 25, calls: 10, neurons: 80_000, usd: 0.88 });
    expect(runs[1]).toMatchObject({ level: 'ok', flags: [] });
  });
});

describe('近 24 小时入库', () => {
  it('各项计数：垃圾页不算抓取失败，没记行数的不进正文数，24 小时前的不算', async () => {
    const id = await source();
    await articles(id, 4, { usedBrowser: true });
    await articles(id, 2, { status: 'FETCH_FAILED', failReason: 'HTTP 403', bodyLines: null });
    await articles(id, 1, { status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: captcha page', bodyLines: null });
    await articles(id, 1, { bodyLines: 1 });
    await articles(id, 3, { bodyLines: null });
    await articles(id, 2, { status: 'PENDING_FETCH', bodyLines: null }); // 还没处理
    await articles(id, 6, { hoursAgo: 25, bodyLines: 1 }); // 窗口外
    expect((await health()).ingest24h).toEqual({ processed: 11, fetchFailed: 2, junk: 1, viaBrowser: 4, bodies: 5, singleLine: 1, level: 'ok' });
  });

  it('黏成一行的正文刚好 20% 不亮灯', async () => {
    const id = await source();
    await articles(id, 8);
    await articles(id, 2, { bodyLines: 1 });
    const body = await health();
    expect(body.ingest24h).toMatchObject({ bodies: 10, singleLine: 2, level: 'ok' });
    expect(body.attention.filter(a => a.link === 'trends')).toEqual([]);
  });

  it('超过 20% 就黄，待处理那行连到 Trends', async () => {
    const id = await source();
    await articles(id, 7);
    await articles(id, 3, { bodyLines: 1 });
    const body = await health();
    expect(body.ingest24h).toMatchObject({ bodies: 10, singleLine: 3, level: 'yellow' });
    expect(body.attention).toContainEqual({
      level: 'yellow',
      title: '30% of new article bodies are a single line',
      detail: '3 of 10 bodies in the last 24 hours · limit 20%',
      link: 'trends',
    });
  });

  it('一篇正文都没记：不亮灯', async () => {
    expect((await health()).ingest24h).toEqual({ processed: 0, fetchFailed: 0, junk: 0, viaBrowser: 0, bodies: 0, singleLine: 0, level: 'ok' });
  });
});

describe('服务与 Worker 报错', () => {
  it('三个服务都健康、没有报错：各服务计数为 0，不进待处理', async () => {
    const body = await health();
    expect(body.services.map(s => [s.service, s.health])).toEqual([['backend', 'healthy'], ['ai-worker', 'healthy'], ['ml-service', 'healthy']]);
    expect(body.services[1]).toEqual(aiWorkerVersion);
    expect(body.workerErrors24h).toEqual({ backend: 0, 'ai-worker': 0, 'ml-service': 0 });
    expect(body.attention).toEqual([]);
    // 问的是到现在为止的 24 小时
    const asked = cf.requests.find(r => r.dataset === 'workersInvocationsAdaptive')!;
    expect(asked.variables).toMatchObject({ since: '2026-10-19T04:00:00.000Z', until: '2026-10-20T04:00:00.000Z' });
  });

  it('有生产 Worker 报错：按服务合计，黄，连到 Trends；预览会话和客户端断开不算', async () => {
    cloudflareAnswers({
      errors: [
        errorRow('2026-10-19', 'meridian-backend', 'scriptThrewException', 2),
        errorRow('2026-10-20', 'meridian-backend', 'exceededResources', 1),
        errorRow('2026-10-20', 'meridian-ml-service', 'scriptThrewException', 4),
        errorRow('2026-10-20', 'meridian-backend', 'loadShed', 900, ''),
        errorRow('2026-10-20', 'meridian-ai-worker', 'clientDisconnected', 7),
      ],
    });
    const body = await health();
    expect(body.workerErrors24h).toEqual({ backend: 3, 'ai-worker': 0, 'ml-service': 4 });
    expect(body.attention).toEqual([
      { level: 'yellow', title: '7 production Worker errors in the last 24 hours', detail: 'backend 3 · ml-service 4', link: 'trends' },
    ]);
  });

  it('只有一次报错也进待处理（单数）', async () => {
    cloudflareAnswers({ errors: [errorRow('2026-10-20', 'meridian-ai-worker', 'scriptThrewException', 1)] });
    expect((await health()).attention).toEqual([
      { level: 'yellow', title: '1 production Worker error in the last 24 hours', detail: 'ai-worker 1', link: 'trends' },
    ]);
  });

  it('ml-service 够不着：unknown，待处理里说够不着；其余照常', async () => {
    const body = await health({ ML_SERVICE: unreachable });
    expect(body.services[2]).toMatchObject({ service: 'ml-service', health: 'unknown' });
    expect(body.attention).toEqual([
      { level: 'yellow', title: 'ml-service could not be reached', detail: 'The health check got no answer', link: 'trends' },
    ]);
  });

  it('ml-service 答了但不健康：unhealthy，进待处理', async () => {
    const body = await health({ ML_SERVICE: failing });
    expect(body.services[2]).toMatchObject({ service: 'ml-service', health: 'unhealthy' });
    expect(body.attention).toEqual([
      { level: 'yellow', title: 'ml-service is unhealthy', detail: 'The health check did not answer healthy', link: 'trends' },
    ]);
  });
});

describe('来源', () => {
  it('各类计数；最差的源红在前黄在后、最多 5 个，各带一句说明；暂停的不算问题', async () => {
    const stale = await source({ name: 'Stale', scrape_frequency: 1, lastChecked: ago(2.5) });
    await source({ name: 'Never', lastChecked: null });
    const dead = await source({ name: 'Dead' });
    await articles(dead, 7, { hoursAgo: 72 });
    const failingSource = await source({ name: 'Failing' });
    await articles(failingSource, 6, { hoursAgo: 30 });
    await articles(failingSource, 4, { hoursAgo: 30, status: 'FETCH_FAILED', failReason: 'HTTP 403', bodyLines: null });
    const glued = await source({ name: 'Glued' });
    await articles(glued, 5, { hoursAgo: 30 });
    await articles(glued, 5, { hoursAgo: 30, bodyLines: 1 });
    const junky = await source({ name: 'Junky' });
    await articles(junky, 7, { hoursAgo: 30 });
    await articles(junky, 3, { hoursAgo: 30, status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: captcha', bodyLines: null });
    await source({ name: 'Paused', paused_at: ago(100), lastChecked: ago(100) });
    await source({ name: 'Fine' });

    const body = await health();

    expect(body.sources.counts).toEqual({ ok: 1, not_checked: 2, dead_feed: 1, fetch_failing: 1, bad_body: 2, paused: 1 });
    expect(body.sources.worst).toEqual([
      { id: expect.any(Number), name: 'Never', kind: 'not_checked', detail: 'Never checked' },
      { id: stale, name: 'Stale', kind: 'not_checked', detail: 'Last checked 2h 30m ago' },
      { id: dead, name: 'Dead', kind: 'dead_feed', detail: 'No new article in 48 hours · 7 in the last 7 days' },
      { id: failingSource, name: 'Failing', kind: 'fetch_failing', detail: '40% of new articles failed to fetch' },
      { id: glued, name: 'Glued', kind: 'bad_body', detail: '50% single-line bodies' },
    ]);
    // 待处理：红的源每个一行；黄的同一种只有一个时单列，有好几个时合成一行。红在前，都连到 Sources
    expect(body.attention).toEqual([
      { level: 'red', title: 'Never has never been checked', detail: 'Never checked', link: 'sources' },
      { level: 'red', title: 'Stale has not been checked', detail: 'Last checked 2h 30m ago', link: 'sources' },
      { level: 'red', title: 'Dead looks like a dead feed', detail: 'No new article in 48 hours · 7 in the last 7 days', link: 'sources' },
      { level: 'yellow', title: 'Failing is failing to fetch', detail: '40% of new articles failed to fetch', link: 'sources' },
      { level: 'yellow', title: '2 sources have a bad body format', detail: 'Glued, Junky', link: 'sources' },
    ]);
  });
});

describe('本周期模型花费', () => {
  it('当前计费周期到今天的账：用量、免费池、美元、生产占比', async () => {
    await run(18, { neurons: 30_000 });
    await run(19, { neurons: 20_000 });
    await run(3, { neurons: 999_999, id: 'cron-brief-previous-cycle' });
    await run(19, { neurons: 999_999, id: 'manual-brief-19' });
    cloudflareAnswers({ neurons: [neuronRow('2026-10-10', GLM, 900_000), neuronRow('2026-10-11', QWEN, 100_000)] });

    const body = await health();

    expect(body.spend).toEqual({
      cycleStart: '2026-10-04',
      cycleEnd: '2026-11-03',
      day: 17,
      days: 31,
      neurons: 1_000_000,
      freePool: 310_000,
      usd: 7.59,
      productionShare: expect.closeTo(0.15, 5),
    });
    const asked = cf.requests.find(r => r.dataset === 'aiInferenceAdaptiveGroups')!;
    expect(asked.variables).toMatchObject({ from: '2026-10-04', to: '2026-10-20' });
  });

  it('账户一点没用：生产占比没有意义，给 null', async () => {
    expect((await health()).spend).toMatchObject({ neurons: 0, usd: 0, productionShare: null });
  });
});

describe('Cloudflare 读不到', () => {
  it('两个面板各自说原因，端点照常 200，其余面板照常；读不到本身不进待处理', async () => {
    await run(20, { status: 'FAILED', error: 'boom' });
    atBeijing('21:30:00');
    cf.answer = () => ({ errors: [{ message: 'not authorized for that account' }] });

    const body = await health();

    expect(body.workerErrors24h).toEqual({ unavailable: 'Cloudflare analytics error: not authorized for that account' });
    expect(body.spend).toEqual({ unavailable: 'Cloudflare analytics error: not authorized for that account' });
    expect(body.today).toMatchObject({ state: 'done', level: 'red' });
    expect(body.services).toHaveLength(3);
    expect(body.attention.map(a => a.title)).toEqual(["Today's run failed"]);
  });

  it('只有一个数据集读不到：另一个面板照常', async () => {
    cf.answer = request => (request.dataset === 'aiInferenceAdaptiveGroups' ? new Response('nope', { status: 500 }) : []);
    const body = await health();
    expect(body.spend).toEqual({ unavailable: 'Cloudflare analytics replied HTTP 500' });
    expect(body.workerErrors24h).toEqual({ backend: 0, 'ai-worker': 0, 'ml-service': 0 });
  });
});

describe('待处理清单的顺序与鉴权', () => {
  it('红的排在黄的前面', async () => {
    await run(20, { status: 'DEGRADED' });
    atBeijing('21:40:00');
    await source({ name: 'Never', lastChecked: null });
    cloudflareAnswers({ errors: [errorRow('2026-10-20', 'meridian-backend', 'scriptThrewException', 1)] });

    const body = await health({ ML_SERVICE: unreachable });

    expect(body.attention.map(a => [a.level, a.title])).toEqual([
      ['red', 'Never has never been checked'],
      ['yellow', "Today's run was degraded"],
      ['yellow', '1 production Worker error in the last 24 hours'],
      ['yellow', 'ml-service could not be reached'],
    ]);
    // 没记下原因的降级运行（回填的汇总）也有一句说明
    expect(body.attention[1].detail).toBe('Finished with partial failures · open the run for the reasons');
  });

  it('不带 token 是 401', async () => {
    expect((await request({}, null)).status).toBe(401);
  });
});
