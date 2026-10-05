/**
 * 运维台 Trends 页的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用本文件起的受控 HTTP 服务假冒（同 admin-cost.test.ts）。页面只渲染 backend 算好的 `OpsTrends`。
 * 默认范围 30 天回 `withData`（基线不足、有核查记录）；切到 7 天回 `cloudflareDown`（有中位数、Worker 报错读不到）。
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPage, setup, url } from '@nuxt/test-utils/e2e';
import type { OpsRunRow, OpsTrends } from '@meridian/contracts';

const run = (day: number, over: Partial<OpsRunRow> = {}): OpsRunRow => ({
  workflowId: `cron-brief-2026-10-${day}`,
  status: 'COMPLETED',
  level: 'ok',
  flags: [],
  // 13:00 UTC = 北京 21:00，同一天
  startedAt: `2026-10-${String(day).padStart(2, '0')}T13:00:00.000Z`,
  finishedAt: `2026-10-${String(day).padStart(2, '0')}T13:30:00.000Z`,
  durationMs: 30 * 60_000,
  articles: 400,
  stories: 25,
  blocks: 20,
  calls: 60,
  neurons: 80_000,
  usd: 0.88,
  ...over,
});

const ingestDays = [
  { day: '2026-10-17', processed: 600, fetchFailed: 30, junk: 10, bodies: 0, singleLine: null },
  { day: '2026-10-18', processed: 500, fetchFailed: 5, junk: 0, bodies: 400, singleLine: 120 },
  { day: '2026-10-19', processed: 0, fetchFailed: 0, junk: 0, bodies: 0, singleLine: null },
];

// 基线内只有 3 次运行：中位数是 null
const withData: OpsTrends = {
  days: 30,
  runs: [run(5), run(6), run(7, { durationMs: 41 * 60_000 + 7_000 })],
  medianDurationMs: null,
  medianUsd: null,
  ingest: ingestDays,
  workerErrors: [
    { day: '2026-10-17', backend: 0, aiWorker: 0, mlService: 0 },
    { day: '2026-10-18', backend: 3, aiWorker: 2, mlService: 0 },
  ],
  checks: [{ workflowId: 'cron-brief-2026-10-7', day: '2026-10-07', clean: 14, fixed: 3, unchecked: 1, notWritten: 2 }],
};

const REASON = 'Cloudflare analytics replied HTTP 403';
const cloudflareDown: OpsTrends = {
  ...withData,
  days: 7,
  runs: [run(5), run(6), run(7, { durationMs: 60 * 60_000, level: 'yellow', flags: ['slow'] })],
  medianDurationMs: 30 * 60_000,
  medianUsd: 0.88,
  workerErrors: { unavailable: REASON },
  checks: [],
};

const backendHits: string[] = [];
const backend = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer test-token') {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  backendHits.push(`${req.method} ${req.url}`);
  const trends = req.url?.match(/^\/observability\/ops\/trends\?days=(\d+)$/);
  if (req.method === 'GET' && trends) {
    res.end(JSON.stringify(trends[1] === '7' ? cloudflareDown : withData));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  browser: true,
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    NUXT_PUBLIC_WORKER_API: backendUrl,
    NUXT_WORKER_API_TOKEN: 'test-token',
    NUXT_ADMIN_USERNAME: ADMIN.username,
    NUXT_ADMIN_PASSWORD: ADMIN.password,
    NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
  },
});

afterAll(() => {
  backend.close();
});

beforeEach(() => {
  backendHits.length = 0;
});

async function trendsPage() {
  const page = await createPage();
  // 只放行本地服务：页面 <head> 引 Google Fonts，外网慢时 goto 会等到超时
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto(url('/admin/login'));
  await page.fill('input[name=username]', ADMIN.username);
  await page.fill('input[name=password]', ADMIN.password);
  await Promise.all([page.waitForURL('**/admin'), page.click('button[type=submit]')]);
  await page.goto(url('/admin/trends'));
  await page.waitForSelector('h1:has-text("Trends")');
  return page;
}

type Page = Awaited<ReturnType<typeof trendsPage>>;
const chart = (page: Page, id: string) => page.locator(`[data-chart="${id}"]`);

describe('Trends 页', () => {
  it('按 backend 给的数渲染：每个北京日一根柱，运行柱按开跑日，基线不足时写明', async () => {
    const page = await trendsPage();
    await expect.poll(() => page.locator('[data-chart="duration"] [data-bar]').count()).toBe(3);
    expect(backendHits).toContain('GET /observability/ops/trends?days=30');
    expect(await page.getAttribute('button:has-text("30 days")', 'aria-pressed')).toBe('true');

    expect(await chart(page, 'cost').locator('[data-bar]').count()).toBe(3);
    expect(await chart(page, 'ingest').locator('[data-bar]').count()).toBe(3);
    expect(await chart(page, 'failure').locator('[data-bar]').count()).toBe(3);
    expect(await chart(page, 'singleLine').locator('[data-bar]').count()).toBe(3);

    // 基线不足：中位数为 null 时给「已有几次」，不画慢阈值线
    expect(await chart(page, 'duration').innerText()).toContain('baseline: 3 of 5 runs');
    expect(await chart(page, 'duration').innerText()).not.toContain('slow above');

    // 悬停：读数是那天 / 那次的值
    await chart(page, 'duration').locator('[data-bar="cron-brief-2026-10-7"]').hover();
    await expect.poll(() => chart(page, 'duration').locator('[role=tooltip]').innerText()).toContain('Oct 7 · 41m 7s');
    await chart(page, 'ingest').locator('[data-bar="2026-10-17"]').hover();
    expect(await chart(page, 'ingest').locator('[role=tooltip]').innerText()).toContain('600 processed · 30 fetch failed · 10 junk');
    await chart(page, 'failure').locator('[data-bar="2026-10-17"]').hover();
    expect(await chart(page, 'failure').locator('[role=tooltip]').innerText()).toContain('4.7% fetch failed');
    await page.close();
  });

  it('没记单行占比的日子显示 not recorded，不是 0%', async () => {
    const page = await trendsPage();
    const single = chart(page, 'singleLine');
    await expect.poll(() => single.locator('[data-bar]').count()).toBe(3);
    expect(await single.locator('[data-stub]').count()).toBe(2);

    await single.locator('[data-bar="2026-10-17"]').hover();
    expect(await single.locator('[role=tooltip]').innerText()).toContain('not recorded');
    await single.locator('[data-bar="2026-10-18"]').hover();
    expect(await single.locator('[role=tooltip]').innerText()).toContain('30.0% single-line (120 of 400)');
    expect(await single.innerText()).toContain('Measured from Oct 18');
    await page.close();
  });

  it('核查结果只列有记录的运行；Worker 报错有数时给合计与分服务', async () => {
    const page = await trendsPage();
    const checks = page.locator('[data-panel="checks"]');
    await expect.poll(() => checks.locator('[data-bar]').count()).toBe(1);
    await checks.locator('[data-bar="cron-brief-2026-10-7"]').hover();
    expect(await checks.locator('[role=tooltip]').innerText()).toContain('14 passed · 3 fixed · 1 unchecked · 2 not written');

    const errors = await page.locator('[data-panel="worker-errors"]').innerText();
    expect(errors).toContain('5');
    expect(errors).toContain('backend 3 · ai-worker 2 · ml-service 0');
    await page.close();
  });

  it('切到 7 天：有中位数时画慢阈值线、慢的运行带标记；Worker 报错读不到时面板写出原因，没有核查记录时说明', async () => {
    const page = await trendsPage();
    await page.click('button:has-text("7 days")');
    await expect.poll(() => chart(page, 'duration').innerText()).toContain('slow above 45.0');
    expect(backendHits).toContain('GET /observability/ops/trends?days=7');
    expect(await chart(page, 'duration').locator('svg path').count()).toBe(1); // 慢的那次带三角标记

    const errors = await page.locator('[data-panel="worker-errors"]').innerText();
    expect(errors).toContain('Not available');
    expect(errors).toContain(REASON);
    // 其余面板照常
    expect(await chart(page, 'ingest').locator('[data-bar]').count()).toBe(3);
    expect(await page.locator('[data-panel="checks"]').innerText()).toContain('No run in this range has a check record');
    await page.close();
  });
});
