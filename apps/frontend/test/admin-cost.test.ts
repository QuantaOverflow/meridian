/**
 * 运维台 Cost 页的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用本文件起的受控 HTTP 服务假冒（同 admin-sources.test.ts）。页面只渲染 backend 算好的 `OpsCost`。
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPage, setup, url } from '@nuxt/test-utils/e2e';
import type { OpsCost } from '@meridian/contracts';

const GLM = '@cf/zai-org/glm-4.7-flash';
const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8';
const V4 = '@cf/deepseek-ai/deepseek-v4-pro-0813';
const TRIAL = '@cf/openai/gpt-oss-120b';

// 已结束的周期，数字取 2026-10-05 的实测读数
const closedCycle: OpsCost = {
  cycle: { start: '2026-09-04', end: '2026-10-03', day: 30, days: 30, complete: true },
  account: { neurons: 2_978_181, freePool: 300_000, billable: 2_678_181, usd: 29.46, planFeeUsd: 5 },
  production: { neurons: 467_627, runs: 30, runNeurons: 188_457, analysisNeurons: 279_170, share: 467_627 / 2_978_181 },
  daily: [
    { day: '2026-09-04', byModel: { [GLM]: 68_109, [QWEN]: 10_832 } },
    { day: '2026-09-05', byModel: {} },
    { day: '2026-10-03', byModel: { [V4]: 1_051_549, [GLM]: 2_536, [QWEN]: 6_510, [TRIAL]: 57_290 } },
  ],
  byModel: [
    { modelId: GLM, neurons: 1_144_059, share: 0.3841, usdAtList: 12.584649 },
    { modelId: V4, neurons: 1_115_227, share: 0.3745, usdAtList: 12.267497 },
    { modelId: TRIAL, neurons: 439_725, share: 0.1477, usdAtList: 4.836975 },
    { modelId: QWEN, neurons: 279_170, share: 0.0937, usdAtList: 3.07087 },
  ],
  lastRunByStep: {
    workflowId: 'cron-brief-2026-10-03',
    // 13:00 UTC = 北京时间 21:00，同一天
    day: '2026-10-03T13:00:00.000Z',
    steps: [
      { phase: 'brief_block_v6', calls: 39, neurons: 1_791, usd: 0.019701 },
      { phase: 'ranking', calls: 3, neurons: 136, usd: 0.001496 },
    ],
  },
  otherItems: [
    { name: 'Workers requests', unit: 'requests', allowance: 10_000_000, used: 122_070, share: 0.012207 },
    { name: 'Durable Objects duration', unit: 'GB-s', allowance: 400_000, used: 108_640.4, share: 0.271601 },
    { name: 'Container memory', unit: 'GiB-hours', allowance: 25, used: null, share: null },
  ],
};

// 当前周期：Cloudflare 读不到，靠它的四块都是 unavailable
const REASON = 'Cloudflare analytics replied HTTP 403';
const unavailable = { unavailable: REASON };
const currentCycleCloudflareDown: OpsCost = {
  cycle: { start: '2026-10-04', end: '2026-11-03', day: 2, days: 31, complete: false },
  account: unavailable,
  production: unavailable,
  daily: unavailable,
  byModel: unavailable,
  lastRunByStep: null,
  otherItems: closedCycle.otherItems.map(i => ({ ...i, used: null, share: null })),
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
  const cost = req.url?.match(/^\/observability\/ops\/cost\?cycle=(current|previous)$/);
  if (req.method === 'GET' && cost) {
    res.end(JSON.stringify(cost[1] === 'previous' ? closedCycle : currentCycleCloudflareDown));
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

/** 登录后打开 Cost 页（默认是当前周期） */
async function costPage() {
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
  await page.goto(url('/admin/cost'));
  await page.waitForSelector('h1:has-text("Cost")');
  return page;
}

const panel = (page: Awaited<ReturnType<typeof costPage>>, heading: string) =>
  page.locator('section', { has: page.locator(`h2:has-text("${heading}")`) });

describe('Cost 页', () => {
  it('Cloudflare 读不到：每个受影响的面板都写出原因，不是空着', async () => {
    const page = await costPage();

    expect(backendHits).toContain('GET /observability/ops/cost?cycle=current');
    await expect.poll(() => page.locator('text=Oct 4 08:00 – Nov 4 08:00').count()).toBeGreaterThan(0);
    for (const heading of ['Estimated model bill', 'Production vs everything else', 'Daily usage by model', 'By model · this cycle']) {
      const text = await panel(page, heading).innerText();
      expect(text, heading).toContain('Not available');
      expect(text, heading).toContain(REASON);
    }
    // 周期本身不靠 Cloudflare，照常显示；没有生产运行的汇总时说明没记，而不是留一张空表
    expect(await page.locator('main').innerText()).toContain('day 2 of 31');
    expect(await panel(page, 'Last production run, by step').innerText()).toContain('No production run has a recorded summary');
    // 读不到的计费项留在表里
    const others = await panel(page, 'Other Cloudflare items').innerText();
    expect(others).toContain('Workers requests');
    expect(others).toContain('not available');
    await page.close();
  });

  it('切到上一个周期：账单、生产占比、按模型、按阶段、其它计费项都按 backend 给的数渲染', async () => {
    const page = await costPage();
    await page.click('button:has-text("Previous cycle")');
    await expect.poll(() => page.locator('text=$29.46').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(backendHits).toContain('GET /observability/ops/cost?cycle=previous');
    expect(await page.getAttribute('button:has-text("Previous cycle")', 'aria-pressed')).toBe('true');

    const bill = await panel(page, 'Estimated model bill').innerText();
    expect(bill).toContain('Sep 4 08:00 – Oct 4 08:00');
    expect(bill).toContain('closed');
    expect(bill).toContain('2,978,181'); // 用量
    expect(bill).toContain('300,000'); // 免费池
    expect(bill).toContain('10,000 × 30 days');
    expect(bill).toContain('2,678,181'); // 计费 neurons
    expect(bill).toContain('$5.00');

    const production = await panel(page, 'Production vs everything else').innerText();
    expect(production).toContain('15.7%');
    expect(production).toContain('467,627');
    expect(production).toContain('84.3%');
    expect(production).toContain('2,510,554'); // 其它 = 账户合计 − 生产
    // 生产数是近似值，页面上要写明
    expect(production).toMatch(/approximat/i);

    const byModel = await panel(page, 'By model · this cycle').innerText();
    expect(byModel).toContain('glm-4.7-flash');
    expect(byModel).toContain('1,144,059');
    expect(byModel).toContain('38.4%');
    expect(byModel).toContain('$12.58');
    expect(byModel).toContain('gpt-oss-120b');

    // 图：每天一根柱（没用量的日子也占位），图例列出模型
    const chart = panel(page, 'Daily usage by model');
    expect(await chart.locator('[data-day]').count()).toBe(3);
    expect(await chart.innerText()).toContain('deepseek-v4-pro');
    // 悬停一根柱：读数里有那天的合计
    await chart.locator('[data-day="2026-10-03"]').hover();
    await expect.poll(() => chart.locator('[role=tooltip]').innerText()).toContain('Oct 3');
    expect(await chart.locator('[role=tooltip]').innerText()).toContain('1,117,885');

    const steps = await panel(page, 'Last production run, by step').innerText();
    expect(steps).toContain('Oct 3');
    expect(steps).toContain('brief_block_v6');
    expect(steps).toContain('1,791');
    expect(steps).toContain('1,927'); // 合计
    expect(steps).toContain('$0.021');

    const others = await panel(page, 'Other Cloudflare items').innerText();
    expect(others).toContain('Workers requests');
    expect(others).toContain('1.2%');
    expect(others).toContain('27.2%');
    // 读不到的项留在表里
    expect(others).toMatch(/Container memory[\s\S]*not available/);
    await page.close();
  });
});
