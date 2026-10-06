/**
 * 运维台运行详情页的端到端测试：真实构建并启动 Nuxt 服务，backend 用本文件起的受控 HTTP 服务假冒，回放一份 fixture。
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createPage, fetch, setup, url } from '@nuxt/test-utils/e2e';

const ADMIN = { username: 'test-admin', password: 'test-pass' };
const HTML_TEXT = '<script>window.__pwned = true</script> and <b>bold</b>';

const row = (workflowId: string, over: object = {}) => ({
  workflowId, status: 'COMPLETED', level: 'ok', flags: [],
  startedAt: '2026-10-05T13:00:13.000Z', finishedAt: '2026-10-05T13:10:39.000Z', durationMs: 626_000,
  articles: 304, stories: 16, blocks: 2, calls: 61, neurons: 2097, usd: 0.023, ...over,
});

const RUNS: Record<string, unknown> = {
  'cron-brief-full': {
    run: row('cron-brief-full', { level: 'yellow', status: 'DEGRADED', flags: ['degraded'] }),
    params: null,
    error: 'step blew up',
    summary: {
      v: 1,
      llm: { calls: 61, neurons: 2097, byPhase: {} },
      steps: [
        { name: 'Prepare dataset', status: 'completed', startedAt: '2026-10-05T13:00:13.000Z', ms: 343_000 },
        { name: 'Brief blocks', status: 'degraded', startedAt: '2026-10-05T13:06:00.000Z', ms: 159_000 },
      ],
      blocks: null, check: null, degradedReasons: ['check agent unavailable'],
    },
    blocks: [
      { index: 4, tier: 'more', title: 'Ethiopia, Eritrea resume conflict', articles: 3, check: { outcome: 'fixed', revisions: 1, unchecked: 2 }, refusals: 0, calls: 2, neurons: 55, usd: 0.0006 },
      { index: 5, tier: 'brief', title: 'Other block', articles: 3, check: null, refusals: 0, calls: 0, neurons: 0, usd: 0 },
    ],
  },
  // 一次调用核查（ADR 0012）上线后的运行：DashScope 的 key 被拒过
  'cron-brief-auth': {
    run: row('cron-brief-auth'),
    params: null,
    error: null,
    summary: {
      v: 1,
      llm: { calls: 61, neurons: 2097, byPhase: {} },
      steps: [],
      blocks: null,
      check: {
        outcomes: { off: 0, clean: 3, fixed: 0, revise_failed: 0, still_flagged: 0, missing: 0 },
        uncheckedBlocks: 0,
        revisions: 0,
        oneCall: {
          checks: 30, fallbacks: 3, fallbackReasons: { auth: 2, unreadable: 1 }, fallbackMessage: 'Incorrect API key provided.',
          noMeaningSearchBlocks: 1, dashscopeUsd: 0.0123,
        },
      },
      degradedReasons: [],
    },
    blocks: [
      { index: 1, tier: 'lead', title: 'Key expired mid-block', articles: 9, check: { outcome: 'clean', revisions: 0, unchecked: 0, paths: { oneCall: 10, agent: 3 }, fallbacks: 3 }, refusals: 0, calls: 20, neurons: 900, usd: 0.0099 },
      { index: 2, tier: 'more', title: 'All on the one-call path', articles: 4, check: { outcome: 'clean', revisions: 0, unchecked: 0, paths: { oneCall: 17, agent: 0 }, fallbacks: 0 }, refusals: 0, calls: 19, neurons: 300, usd: 0.0033 },
      // 回滚到旧 ai-worker 写出的块：没有这两项
      { index: 3, tier: 'brief', title: 'Written by the old checker', articles: 3, check: { outcome: 'clean', revisions: 0, unchecked: 0 }, refusals: 0, calls: 8, neurons: 200, usd: 0.0022 },
    ],
  },
  // 回退很多，但没有 key 的问题；每块都用上了按意思搜
  'cron-brief-many': {
    run: row('cron-brief-many'),
    params: null,
    error: null,
    summary: {
      v: 1,
      llm: { calls: 61, neurons: 2097, byPhase: {} },
      steps: [],
      blocks: null,
      check: {
        outcomes: { off: 0, clean: 1, fixed: 0, revise_failed: 0, still_flagged: 0, missing: 0 },
        uncheckedBlocks: 0,
        revisions: 0,
        oneCall: {
          checks: 40, fallbacks: 12, fallbackReasons: { provider_error: 9, content_filter: 3 }, fallbackMessage: 'Request timed out',
          noMeaningSearchBlocks: 0, dashscopeUsd: 0.02,
        },
      },
      degradedReasons: [],
    },
    blocks: [
      { index: 1, tier: 'lead', title: 'Timeouts', articles: 9, check: { outcome: 'clean', revisions: 0, unchecked: 0, paths: { oneCall: 28, agent: 12 }, fallbacks: 12 }, refusals: 0, calls: 20, neurons: 900, usd: 0.0099 },
    ],
  },
  // 核查配成 agent 的运行：backend 给的和这之前的运行一样——汇总的 check 没有 oneCall，块的 check 只有三项
  'cron-brief-agent': {
    run: row('cron-brief-agent'),
    params: null,
    error: null,
    summary: {
      v: 1,
      llm: { calls: 61, neurons: 2097, byPhase: {} },
      steps: [],
      blocks: null,
      check: { outcomes: { off: 0, clean: 1, fixed: 0, revise_failed: 0, still_flagged: 0, missing: 0 }, uncheckedBlocks: 0, revisions: 0 },
      degradedReasons: [],
    },
    blocks: [
      { index: 1, tier: 'lead', title: 'Checked by the agent', articles: 9, check: { outcome: 'clean', revisions: 0, unchecked: 0 }, refusals: 0, calls: 20, neurons: 900, usd: 0.0099 },
    ],
  },
  'cron-brief-bare': {
    run: row('cron-brief-bare', { calls: null, neurons: null, usd: null, blocks: null }),
    params: null, error: null, summary: null, blocks: { unavailable: 'block record not found' },
  },
};

const CALL_KEY = 'llm-calls/cron-brief-full/brief_block_v6-1001.json';
const CALLS = [
  // 块 4 的写作调用（600 + 4 × 100 + 1）和核查调用（4 × 1000）；以及别的块的调用，不应出现
  { key: CALL_KEY, uploaded: '2026-10-05T13:08:04.000Z', size: 10, phase: 'brief_block_v6', call_index: 1001, model: '@cf/zai-org/glm-4.7-flash', tokens: { prompt_tokens: 1718, completion_tokens: 372, neurons: 23 }, latency_ms: 10200 },
  { key: 'llm-calls/cron-brief-full/brief_block_v6_check-4000.json', uploaded: '2026-10-05T13:08:30.000Z', size: 10, phase: 'brief_block_v6_check', call_index: 4000, model: 'qwen', tokens: { prompt_tokens: 10, completion_tokens: 5, neurons: 2 }, latency_ms: 1000 },
  { key: 'llm-calls/cron-brief-full/brief_block_v6-700.json', uploaded: '2026-10-05T13:08:00.000Z', size: 10, phase: 'brief_block_v6', call_index: 700, model: 'other-block-model', latency_ms: 1 },
];
const CALL_RECORD = {
  request: { model: 'glm', messages: [{ role: 'system', content: 'You write briefs.' }, { role: 'user', content: HTML_TEXT }] },
  response: { content: HTML_TEXT, finish_reason: 'stop' },
};

const backend = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Bearer test-token') return send(401, { error: 'Unauthorized' });
  const path = (req.url ?? '').split('?')[0];
  const detail = path.match(/^\/observability\/ops\/runs\/([^/]+)$/);
  if (detail) return RUNS[detail[1]] ? send(200, RUNS[detail[1]]) : send(404, { error: 'Run not found' });
  if (path === '/observability/runs/cron-brief-full/llm-calls') return send(200, { success: true, total: CALLS.length, calls: CALLS });
  if (path === `/observability/llm-calls/${CALL_KEY}`) return send(200, CALL_RECORD);
  send(404, { error: 'not found' });
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

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

async function adminPage(path: string) {
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
  await page.goto(url(path));
  return page;
}

describe('运行详情页', () => {
  it('完整的一次运行：头部、汇总格、步骤、降级原因、错误、块表都渲染，时间是北京时间', async () => {
    const page = await adminPage('/admin/runs/cron-brief-full');
    await page.waitForSelector('[data-test=header]');
    const header = await page.locator('[data-test=header]').innerText();
    expect(header).toContain('DEGRADED');
    expect(header).toContain('21:00'); // 13:00 UTC
    expect(header).toContain('10m 26s');
    expect(header).toContain('$0.023');
    expect(await page.locator('[data-test=run-error]').innerText()).toContain('step blew up');
    expect(await page.locator('[data-test=degraded]').innerText()).toContain('check agent unavailable');
    const steps = await page.locator('[data-test=steps]').innerText();
    expect(steps).toContain('Prepare dataset');
    expect(steps).toContain('21:00:13');
    expect(steps).not.toContain('not recorded');
    const rows = await page.locator('[data-test=block-row]').allInnerTexts();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Ethiopia, Eritrea resume conflict');
    expect(rows[0]).toContain('fixed');
    await page.close();
  });

  for (const id of ['cron-brief-full', 'cron-brief-agent']) {
    it(`这之前的运行、核查配成 agent 的运行（${id}）：没有逐句核查那一栏，块表也没有多出来的列`, async () => {
      const page = await adminPage(`/admin/runs/${id}`);
      await page.waitForSelector('[data-test=block-row]');
      expect(await page.locator('[data-test=sentence-check]').count()).toBe(0);
      expect(await page.locator('main, body').first().innerText()).not.toMatch(/fell back|fallback|one-call/i);
      expect(await page.locator('[data-test=blocks] thead th').count()).toBe(10);
      await page.close();
    });
  }

  it('有一次调用核查的运行、key 被拒过：逐句核查那一栏写出回退次数、原因、厂商报错、没按意思搜的块数和 DashScope 花费；每块列出各路次数与回退', async () => {
    const page = await adminPage('/admin/runs/cron-brief-auth');
    await page.waitForSelector('[data-test=sentence-check]');
    const check = await page.locator('[data-test=sentence-check]').innerText();
    expect(check).toContain('30 checks');
    expect(check).toContain('3 fell back to the agent');
    expect(check).toContain('key rejected 2');
    expect(check).toContain('unreadable reply 1');
    expect(check).toContain('Incorrect API key provided.');
    expect(check).toContain('1 block without meaning search');
    expect(check).toContain('$0.0123');

    const rows = await page.locator('[data-test=block-row]').allInnerTexts();
    expect(rows[0]).toContain('10 one-call · 3 agent');
    expect(await page.locator('[data-test=block-row]').nth(0).locator('[data-test=fallbacks]').innerText()).toBe('3');
    expect(rows[1]).toContain('17 one-call · 0 agent');
    expect(await page.locator('[data-test=block-row]').nth(1).locator('[data-test=fallbacks]').innerText()).toBe('0');
    // 不带这两项的块写「-」，不写成 0
    expect(await page.locator('[data-test=block-row]').nth(2).locator('[data-test=paths]').innerText()).toBe('-');
    expect(await page.locator('[data-test=block-row]').nth(2).locator('[data-test=fallbacks]').innerText()).toBe('-');
    await page.close();
  });

  it('回退很多但每块都按意思搜了：写出占比和原因，不提没按意思搜', async () => {
    const page = await adminPage('/admin/runs/cron-brief-many');
    await page.waitForSelector('[data-test=sentence-check]');
    const check = await page.locator('[data-test=sentence-check]').innerText();
    expect(check).toContain('12 fell back to the agent (30%)');
    expect(check).toContain('provider error 9');
    expect(check).toContain('content filter 3');
    expect(check).toContain('Request timed out');
    expect(check).not.toContain('meaning search');
    await page.close();
  });

  it('没有汇总和块记录：写「not recorded」和 unavailable，不是空表', async () => {
    const page = await adminPage('/admin/runs/cron-brief-bare');
    await page.waitForSelector('[data-test=header]');
    expect(await page.locator('[data-test=steps]').innerText()).toContain('not recorded');
    expect(await page.locator('[data-test=header]').innerText()).toContain('not recorded');
    expect(await page.locator('[data-test=blocks-unavailable]').innerText()).toContain('block record not found');
    expect(await page.locator('[data-test=block-row]').count()).toBe(0);
    await page.close();
  });

  it('没有这次运行：显示 Run not found', async () => {
    const page = await adminPage('/admin/runs/cron-brief-missing');
    await page.waitForSelector('[data-test=load-error]');
    expect(await page.locator('[data-test=load-error]').innerText()).toContain('Run not found');
    await page.close();
  });

  it('打开一块才取调用列表，只列这一块的调用；调用里的 HTML 按文本显示，不被渲染', async () => {
    const page = await adminPage('/admin/runs/cron-brief-full');
    await page.waitForSelector('[data-test=block-row]');
    const listRequests: string[] = [];
    page.on('request', r => {
      if (r.url().includes('/llm-calls') || r.url().includes('/calls')) listRequests.push(r.url());
    });
    expect(await page.locator('[data-test=calls]').count()).toBe(0);

    await page.locator('[data-test=open-calls]').first().click();
    await page.waitForSelector('[data-test=call-row]');
    expect(listRequests.length).toBeGreaterThan(0);
    const callRows = await page.locator('[data-test=call-row]').allInnerTexts();
    expect(callRows).toHaveLength(2); // 写作 #1001 与核查 #4000；块 1 的 #700 不属于它
    expect(callRows.join('\n')).not.toContain('other-block-model');
    expect(callRows[0]).toContain('brief_block_v6');
    expect(callRows[0]).toContain('glm-4.7-flash');
    expect(callRows[0]).toContain('21:08:04');
    expect(callRows[0]).toContain('1718 in → 372 out');
    expect(callRows[0]).toContain('23.0 neurons');
    expect(callRows[0]).toContain('10.2 s');

    await page.locator('[data-test=call-row]').first().click();
    await page.waitForSelector('[data-test=call-response]');
    expect(await page.locator('[data-test=call-response]').innerText()).toContain(HTML_TEXT);
    const requests = await page.locator('[data-test=call-request]').allInnerTexts();
    expect(requests).toEqual(['You write briefs.', HTML_TEXT]);
    // 没有被当成 HTML：没有 <b> 元素、脚本没跑
    expect(await page.locator('[data-test=call-detail] b').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
    await page.close();
  });

  it('没带会话：详情接口 401', async () => {
    const res = await fetch('/api/admin/ops/runs/cron-brief-full');
    expect(res.status).toBe(401);
  });
});
