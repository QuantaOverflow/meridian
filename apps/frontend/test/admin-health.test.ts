/**
 * 运维台 Health 页的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用本文件起的受控 HTTP 服务假冒（同 admin-cost.test.ts）。页面只渲染 backend 判好的 `OpsHealth`。
 */
import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPage, setup, url } from '@nuxt/test-utils/e2e';
import { builtSite } from './built-site';
import type { OpsHealth, OpsRunRow } from '@meridian/contracts';

/** day：10 月的哪一天，北京时间 21:00（= 13:00 UTC）开跑 */
function run(day: number, over: Partial<OpsRunRow> = {}): OpsRunRow {
  const started = Date.UTC(2026, 9, day, 13, 0);
  const durationMs = over.durationMs === undefined ? 30 * 60_000 : over.durationMs;
  return {
    workflowId: `cron-brief-${day}`,
    status: 'COMPLETED',
    level: 'ok',
    flags: [],
    startedAt: new Date(started).toISOString(),
    finishedAt: durationMs === null ? null : new Date(started + durationMs).toISOString(),
    articles: 400,
    stories: 25,
    blocks: 25,
    calls: 393,
    neurons: 86_052,
    usd: 0.946572,
    ...over,
    durationMs,
  };
}

// 白天、一切正常：今天的还没跑，基线已满
const quietDay: OpsHealth = {
  // 03:57 UTC = 北京时间 11:57
  generatedAt: '2026-10-12T03:57:00.000Z',
  today: { state: 'scheduled', level: 'ok', run: null, baselineRuns: 7, baselineMin: 5, medianDurationMs: 30 * 60_000, slowAboveMs: 45 * 60_000 },
  ingest24h: { processed: 501, fetchFailed: 7, junk: 2, viaBrowser: 45, bodies: 418, singleLine: 12, level: 'ok' },
  services: [
    { service: 'backend', commit: '0112c68', title: 'brief-v3 记录带上核查循环', dirty: false, deployedAt: '2026-10-04T17:48:00.000Z', versionId: 'b-1', health: 'healthy' },
    { service: 'ai-worker', commit: 'd0edbb3', title: 'v4-pro 遇故障退避后重发', dirty: true, deployedAt: '2026-10-04T19:26:00.000Z', versionId: 'a-1', health: 'healthy' },
    { service: 'ml-service', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'healthy' },
  ],
  workerErrors24h: { backend: 0, 'ai-worker': 0, 'ml-service': 0 },
  sources: { counts: { ok: 14, not_checked: 0, dead_feed: 0, fetch_failing: 0, bad_body: 0, paused: 1 }, worst: [] },
  spend: { cycleStart: '2026-10-04', cycleEnd: '2026-11-03', day: 9, days: 31, neurons: 3_273_508, freePool: 310_000, usd: 32.6, productionShare: 0.005 },
  attention: [],
  runs: [
    run(11),
    run(10, { level: 'yellow', flags: ['slow'], durationMs: 50 * 60_000 }),
    run(9, { status: 'DEGRADED', level: 'yellow', flags: ['degraded'] }),
    run(8, { calls: null, neurons: null, usd: null }),
  ],
};

// 晚上、出了事：今天的运行失败，基线还不满，Cloudflare 读不到
const REASON = 'Cloudflare analytics replied HTTP 403';
const failedRun = run(7, { status: 'FAILED', level: 'red', flags: ['failed'], durationMs: 4 * 60_000, blocks: null, calls: null, neurons: null, usd: null });
const badEvening: OpsHealth = {
  generatedAt: '2026-10-07T13:40:00.000Z',
  today: { state: 'done', level: 'red', run: failedRun, baselineRuns: 2, baselineMin: 5, medianDurationMs: null, slowAboveMs: null },
  ingest24h: { processed: 501, fetchFailed: 7, junk: 2, viaBrowser: 45, bodies: 418, singleLine: 323, level: 'yellow' },
  services: [
    quietDay.services[0],
    quietDay.services[1],
    { service: 'ml-service', commit: null, title: null, dirty: null, deployedAt: null, versionId: null, health: 'unknown' },
  ],
  workerErrors24h: { unavailable: REASON },
  sources: {
    counts: { ok: 4, not_checked: 1, dead_feed: 0, fetch_failing: 0, bad_body: 9, paused: 1 },
    worst: [
      { id: 3, name: 'CBS News World', kind: 'not_checked', detail: 'Last checked 2h 24m ago' },
      { id: 5, name: 'France24', kind: 'bad_body', detail: '77% single-line bodies' },
    ],
  },
  spend: { unavailable: REASON },
  attention: [
    { level: 'red', title: "Today's run failed", detail: 'LLM call exhausted retries', link: { run: 'cron-brief-7' } },
    { level: 'red', title: 'CBS News World has not been checked', detail: 'Last checked 2h 24m ago', link: 'sources' },
    { level: 'yellow', title: '77% of new article bodies are a single line', detail: '323 of 418 bodies in the last 24 hours · limit 20%', link: 'trends' },
    { level: 'yellow', title: 'ml-service could not be reached', detail: 'The health check got no answer', link: 'trends' },
  ],
  runs: [failedRun, run(6), run(5)],
};

let fixture: OpsHealth = quietDay;
const backendHits: string[] = [];
const backend = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer test-token') {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  backendHits.push(`${req.method} ${req.url}`);
  if (req.method === 'GET' && req.url === '/observability/ops/health') {
    res.end(JSON.stringify(fixture));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  ...builtSite,
  browser: true,
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

/** 登录（登录后落在 /admin，也就是 Health 页），再按给定的数据重新打开一次 */
async function healthPage(data: OpsHealth, viewport?: { width: number; height: number }) {
  fixture = data;
  const page = await createPage();
  if (viewport) await page.setViewportSize(viewport);
  // 只放行本地服务：页面 <head> 引 Google Fonts，外网慢时 goto 会等到超时
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto(url('/admin/login'));
  await page.fill('input[name=username]', ADMIN.username);
  await page.fill('input[name=password]', ADMIN.password);
  await Promise.all([page.waitForURL('**/admin'), page.click('button[type=submit]')]);
  backendHits.length = 0;
  await page.goto(url('/admin'));
  await page.waitForSelector('h1:has-text("Health")');
  await page.waitForSelector('[data-test=today]');
  return page;
}

type Page = Awaited<ReturnType<typeof healthPage>>;
const text = (page: Page, test: string) => page.locator(`[data-test=${test}]`).innerText();

describe('Health 页', () => {
  it('按 backend 给的数渲染各面板；时间是北京时间；运行表每行连到运行详情', async () => {
    const page = await healthPage(quietDay);

    expect(await text(page, 'updated')).toContain('updated 11:57');

    const today = await text(page, 'today');
    expect(today).toContain('Scheduled');
    expect(today).toContain('Runs at 21:00');
    expect(today).toContain('Typical run 30m 0s');
    // 今天的还没跑：卡片下半是上一次运行
    expect(today).toContain('Oct 11 · Completed');
    expect(await page.locator('[data-test=today] a').getAttribute('href')).toBe('/admin/runs/cron-brief-11');

    const ingest = await text(page, 'ingest');
    expect(ingest).toContain('OK');
    expect(ingest).toContain('501 processed');
    expect(ingest).toContain('7 failed (1.4%)');
    expect(ingest).toContain('45 via browser (9.0%)');
    expect(ingest).toContain('12 of 418');

    const services = await text(page, 'services');
    expect(services).toContain('0112c68');
    expect(services).toContain('Oct 5 01:48'); // 10-04 17:48 UTC
    expect(services).toContain('d0edbb3 (dirty)');
    expect(services).toContain('brief-v3 记录带上核查循环');
    expect(services).toContain('no commit recorded'); // 没经部署脚本的服务
    expect(services).toContain('Worker errors, 24 h: 0');

    const sources = await text(page, 'sources');
    expect(sources).toContain('All 14 active OK');
    expect(sources).toContain('1 paused · 14 OK');

    const attention = await text(page, 'attention');
    expect(attention).toContain('Everything is within limits.');
    expect(await page.locator('[data-test=attention-line]').count()).toBe(0);

    const spend = await text(page, 'spend');
    expect(spend).toContain('$32.60');
    expect(spend).toContain('Oct 4 08:00 – Nov 4 08:00 · day 9 of 31'); // 周期按 UTC 零点切，显示成北京时间
    expect(spend).toContain('3,273,508');
    expect(spend).toContain('310,000');
    expect(spend).toContain('0.5%');

    const runs = page.locator('[data-test=runs]');
    expect(await runs.locator('[data-test=baseline]').innerText()).toBe('Median 30m 0s · slow above 45m 0s (1.5×)');
    expect(await runs.locator('tbody tr').count()).toBe(4);
    const first = runs.locator('tr[data-run="cron-brief-11"]');
    expect(await first.locator('a').getAttribute('href')).toBe('/admin/runs/cron-brief-11');
    const firstText = await first.innerText();
    expect(firstText).toContain('Oct 11');
    expect(firstText).toContain('21:00');
    expect(firstText).toContain('Completed');
    expect(firstText).toContain('30m 0s');
    expect(firstText).toContain('393');
    expect(firstText).toContain('$0.947');
    // 状态用文字写出来，不只靠颜色
    expect(await runs.locator('tr[data-run="cron-brief-10"]').innerText()).toContain('Completed · slow');
    expect(await runs.locator('tr[data-run="cron-brief-9"]').innerText()).toContain('Degraded');
    // 没记汇总的运行写明没记
    expect(await runs.locator('tr[data-run="cron-brief-8"]').innerText()).toContain('not recorded');

    // 点运行表的一行：到运行详情
    await first.locator('a').click();
    await page.waitForURL('**/admin/runs/cron-brief-11');
    await page.close();
  });

  it('打开页面只向 backend 要一次，之后不轮询（读 ml-service 的健康会唤醒它的容器）', async () => {
    const page = await healthPage(quietDay);
    await page.waitForTimeout(3000);
    expect(backendHits.filter(h => h === 'GET /observability/ops/health')).toHaveLength(1);
    await page.close();
  });

  it('红的运行出现在待处理里并连到那次运行；读不到的面板写出原因；基线不满时写明几次', async () => {
    const page = await healthPage(badEvening);

    const today = await text(page, 'today');
    expect(today).toContain('Problem');
    expect(today).toContain('Failed');
    expect(today).toContain('baseline: 2 of 5 runs');

    const lines = page.locator('[data-test=attention-line]');
    expect(await lines.count()).toBe(4);
    const runLine = lines.nth(0);
    expect(await runLine.getAttribute('data-level')).toBe('red');
    expect(await runLine.getAttribute('href')).toBe('/admin/runs/cron-brief-7');
    const runLineText = await runLine.innerText();
    expect(runLineText).toContain("Today's run failed");
    expect(runLineText).toContain('LLM call exhausted retries');
    // 级别有文字（给读屏），不只靠图形颜色
    expect(await runLine.locator('.sr-only').innerText()).toBe('Problem:');
    expect(await lines.nth(1).getAttribute('href')).toBe('/admin/sources');
    expect(await lines.nth(2).getAttribute('href')).toBe('/admin/trends');
    expect(await lines.nth(2).getAttribute('data-level')).toBe('yellow');
    expect(await text(page, 'attention')).toContain('Everything else is within limits.');

    // 读不到的两块：写出原因，不是空着，也不是 0
    const spend = await text(page, 'spend');
    expect(spend).toContain('Not available');
    expect(spend).toContain(REASON);
    const workerErrors = await text(page, 'worker-errors');
    expect(workerErrors).toContain('Not available');
    expect(workerErrors).toContain(REASON);

    expect(await page.locator('[data-test=services] [data-service="ml-service"]').innerText()).toContain('could not be reached');
    expect(await page.locator('[data-test=services] [data-test=pill]').innerText()).toContain('Warn');

    const sources = await text(page, 'sources');
    expect(sources).toContain('Problem');
    expect(sources).toContain('1 not checked');
    expect(sources).toContain('9 bad body format');
    expect(sources).toContain('CBS News World');
    expect(sources).toContain('Last checked 2h 24m ago');

    expect(await text(page, 'ingest')).toContain('77.3% of bodies are one line');

    const runs = page.locator('[data-test=runs]');
    expect(await runs.locator('[data-test=baseline]').innerText()).toContain('baseline: 2 of 5 runs');
    expect(await runs.locator('tr[data-run="cron-brief-7"]').getAttribute('data-level')).toBe('red');
    await page.close();
  });

  it('手机宽度：「今天」那一排排成一列，不撑出横向滚动', async () => {
    const page = await healthPage(badEvening, { width: 375, height: 800 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    for (const card of ['today', 'ingest', 'services', 'sources']) {
      const box = (await page.locator(`[data-test=${card}]`).boundingBox())!;
      expect(box.x, card).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, card).toBeLessThanOrEqual(375);
      expect(box.width, card).toBeGreaterThan(300); // 一列，占满宽度
    }
    await page.close();
  });
});
