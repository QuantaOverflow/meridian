/**
 * 后台「源」管理的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用本文件起的受控 HTTP 服务假冒。前端不连数据库，页面读到的源列表 / 详情也来自这个假 backend。
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { $fetch, createPage, fetch, setup, url } from '@nuxt/test-utils/e2e';

// ── 假 backend ─────────────────────────────────────────────────────────
// 读（GET /admin/sources、/admin/sources/:id/details）按内存里的源列表回答；
// 写（其余方法）的状态码由测试控制、记录请求，建源成功时把源加进列表（真 backend 就是这么做的），页面列表才读得到
interface FakeSource {
  id: number;
  url: string;
  name: string;
  pausedAt: string | null;
}
let sources: FakeSource[] = [];
let backendStatus = 200;
const backendHits: string[] = [];
const backendBodies: unknown[] = [];

function sourceStats(s: FakeSource) {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    category: 'news',
    paywall: false,
    frequency: '4 Hours',
    totalArticles: 0,
    avgPerDay: 0,
    processSuccessRate: null,
    errorRate: null,
    lowQualityRate: null,
  };
}

function readReply(path: string): { status: number; body: unknown } {
  if (path === '/admin/sources') {
    return {
      status: 200,
      body: {
        overview: {
          lastSourceCheck: null,
          lastArticleProcessed: null,
          lastArticleFetched: null,
          articlesProcessedToday: 0,
          articlesFetchedToday: 0,
          errorsToday: 0,
          staleSourcesCount: 0,
          totalSourcesCount: sources.length,
        },
        sources: sources.map(sourceStats),
      },
    };
  }
  const details = path.match(/^\/admin\/sources\/(\d+)\/details(\?|$)/);
  const source = details && sources.find(s => s.id === Number(details[1]));
  if (source) {
    return {
      status: 200,
      body: {
        name: source.name,
        url: source.url,
        initialized: true,
        pausedAt: source.pausedAt,
        frequency: '4 Hours',
        articles: [],
        pagination: { totalPages: 0, totalItems: 0 },
      },
    };
  }
  return { status: 404, body: { error: 'Source not found' } };
}

const backend = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer test-token') {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (req.method === 'GET') {
    const reply = readReply(req.url ?? '');
    res.statusCode = reply.status;
    res.end(JSON.stringify(reply.body));
    return;
  }
  backendHits.push(`${req.method} ${req.url}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : undefined;
  backendBodies.push(body);
  if (backendStatus >= 400) {
    res.statusCode = backendStatus;
    res.end(JSON.stringify({ success: false, error: `backend says ${backendStatus}` }));
    return;
  }
  if (req.method === 'POST' && req.url === '/admin/sources') {
    const row = { id: Math.max(0, ...sources.map(s => s.id)) + 1, url: body.url, name: 'Unknown', pausedAt: null };
    sources.push(row);
    res.statusCode = 201;
    res.end(JSON.stringify({ success: true, data: row }));
    return;
  }
  res.statusCode = backendStatus;
  res.end(JSON.stringify({ success: true }));
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const EXISTING_URL = 'https://example.com/feed.xml';
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

const sourceId = 1;
beforeEach(() => {
  sources = [{ id: sourceId, url: EXISTING_URL, name: 'Example', pausedAt: null }];
  backendStatus = 200;
  backendHits.length = 0;
  backendBodies.length = 0;
});

async function loginCookie(): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  expect(res.status).toBe(201);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

describe('POST /api/admin/login', () => {
  const login = (body: unknown) =>
    fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('密码错（等长、不等长）或用户名错：401，不发 cookie', async () => {
    for (const body of [
      { ...ADMIN, password: 'x'.repeat(ADMIN.password.length) },
      { ...ADMIN, password: 'short' },
      { ...ADMIN, username: 'someone-else' },
    ]) {
      const res = await login(body);
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it('账号密码对：201 并发会话 cookie', async () => {
    const res = await login(ADMIN);
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });
});

describe('POST /api/admin/sources/:id/init-dos', () => {
  it('backend 初始化失败时如实报错，不回 success', async () => {
    backendStatus = 500;
    const cookie = await loginCookie();
    const res = await fetch(`/api/admin/sources/${sourceId}/init-dos`, { method: 'POST', headers: { cookie } });
    expect(backendHits).toContain(`POST /do/admin/source/${sourceId}/init`);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('反向对照：backend 成功时返回 success', async () => {
    backendStatus = 200;
    const cookie = await loginCookie();
    const body = await $fetch(`/api/admin/sources/${sourceId}/init-dos`, { method: 'POST', headers: { cookie } });
    expect(body).toEqual({ success: true });
  });
});

describe('后台页面「Add Source」', () => {
  async function adminPageAnswering(promptAnswer: string) {
    const page = await createPage();
    // 只放行本地服务：页面 <head> 引 Google Fonts，外网慢时 goto 会等到超时，让测试失败的原因变成网络而不是被测行为
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
    });
    await page.goto(url('/admin/login'));
    const dialogs: string[] = [];
    page.on('dialog', async d => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      if (d.type() === 'prompt') await d.accept(promptAnswer);
      else await d.accept();
    });
    await page.fill('input[name=username]', ADMIN.username);
    await page.fill('input[name=password]', ADMIN.password);
    await Promise.all([page.waitForURL('**/admin'), page.click('button[type=submit]')]);
    await page.waitForSelector(`a[href="${EXISTING_URL}"]`);
    return { page, dialogs };
  }

  it('添加已存在的 URL：用户能看到失败提示', async () => {
    backendStatus = 409;
    const { page, dialogs } = await adminPageAnswering(EXISTING_URL);
    await page.click('text=Add Source');
    await expect.poll(() => dialogs.filter(d => d.startsWith('alert')), { timeout: 10_000 })
      .toEqual([expect.stringMatching(/fail/i)]);
    await page.close();
  });

  it('添加新 URL：不刷新页面，列表里就出现这一行', async () => {
    const NEW_URL = 'https://example.org/new-feed.xml';
    const { page, dialogs } = await adminPageAnswering(NEW_URL);
    await page.click('text=Add Source');
    await expect.poll(() => dialogs.some(d => d.startsWith('alert') && /success/i.test(d)), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => page.locator(`a[href="${NEW_URL}"]`).count(), { timeout: 10_000 }).toBe(1);
    await page.close();
  });
});

// 源的写操作（建源的默认值、拉起 DO、删源的外键检查）归 backend，前端只转发（backend 侧见 apps/backend/test/lib/sources.spec.ts）
describe('POST /api/admin/sources', () => {
  it('转给 backend 的 POST /admin/sources，只带 url', async () => {
    const NEW_URL = 'https://example.net/forwarded-feed.xml';
    const cookie = await loginCookie();
    const body = await $fetch('/api/admin/sources', {
      method: 'POST',
      headers: { cookie },
      body: { url: NEW_URL },
    });
    expect(body).toEqual({ success: true });
    expect(backendHits).toEqual(['POST /admin/sources']);
    expect(backendBodies).toEqual([{ url: NEW_URL }]);
  });

  it('backend 回 409（URL 已存在）：前端也回 409，带上 backend 的错误文本', async () => {
    backendStatus = 409;
    const cookie = await loginCookie();
    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ url: EXISTING_URL }),
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('backend says 409');
  });

  it('backend 5xx：前端回 502', async () => {
    backendStatus = 500;
    const cookie = await loginCookie();
    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.net/x.xml' }),
    });
    expect(res.status).toBe(502);
  });
});

describe('DELETE /api/admin/sources/:id', () => {
  it('转给 backend；backend 回 409（有文章被简报引用）时前端也回 409', async () => {
    backendStatus = 409;
    const cookie = await loginCookie();
    const res = await fetch(`/api/admin/sources/${sourceId}`, { method: 'DELETE', headers: { cookie } });
    expect(backendHits).toEqual([`DELETE /do/admin/source/${sourceId}`]);
    expect(res.status).toBe(409);
  });

  it('源是否存在由 backend 判定（404 原样透传）', async () => {
    backendStatus = 404;
    const cookie = await loginCookie();
    const res = await fetch('/api/admin/sources/999999', { method: 'DELETE', headers: { cookie } });
    expect(backendHits).toEqual(['DELETE /do/admin/source/999999']);
    expect(res.status).toBe(404);
  });
});

describe('暂停 / 恢复自动抓取：接口', () => {
  for (const action of ['pause', 'resume'] as const) {
    it(`${action}：转给 backend；backend 失败时如实报错`, async () => {
      backendStatus = 500;
      const cookie = await loginCookie();
      const res = await fetch(`/api/admin/sources/${sourceId}/${action}`, { method: 'POST', headers: { cookie } });
      expect(backendHits).toContain(`POST /do/admin/source/${sourceId}/${action}`);
      expect(res.status).toBeGreaterThanOrEqual(500);
    });

    it(`${action}：源不存在由 backend 回 404 并原样透传`, async () => {
      backendStatus = 404;
      const cookie = await loginCookie();
      const res = await fetch(`/api/admin/sources/999999/${action}`, { method: 'POST', headers: { cookie } });
      expect(backendHits).toEqual([`POST /do/admin/source/999999/${action}`]);
      expect(res.status).toBe(404);
    });

    it(`${action}：反向对照，backend 成功时返回 success`, async () => {
      backendStatus = 200;
      const cookie = await loginCookie();
      const body = await $fetch(`/api/admin/sources/${sourceId}/${action}`, { method: 'POST', headers: { cookie } });
      expect(body).toEqual({ success: true });
    });
  }
});

describe('源详情页：暂停状态与按钮', () => {
  async function feedPage() {
    const page = await createPage();
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
    });
    const dialogs: string[] = [];
    page.on('dialog', async d => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      await d.accept();
    });
    await page.goto(url('/admin/login'));
    await page.fill('input[name=username]', ADMIN.username);
    await page.fill('input[name=password]', ADMIN.password);
    await Promise.all([page.waitForURL('**/admin'), page.click('button[type=submit]')]);
    await page.goto(url(`/admin/feed/${sourceId}`));
    await page.waitForSelector('text=Source URL');
    return { page, dialogs };
  }

  it('已暂停的源：显示已暂停，只给「恢复」，不给「Init DOs」；点恢复会调 backend', async () => {
    backendStatus = 200;
    sources[0].pausedAt = '2026-09-26T00:00:00.000Z';
    const { page, dialogs } = await feedPage();

    expect(await page.locator('text=Paused since').count()).toBe(1);
    expect(await page.locator('button:has-text("Init DOs")').count()).toBe(0);
    expect(await page.locator('button:has-text("Pause Fetching")').count()).toBe(0);
    await page.click('button:has-text("Resume Fetching")');
    await expect.poll(() => backendHits, { timeout: 10_000 }).toContain(`POST /do/admin/source/${sourceId}/resume`);
    expect(dialogs.filter(d => d.startsWith('alert'))).toEqual([]);
    await page.close();
  });

  it('未暂停的源：给「暂停」；backend 失败时用户能看到失败提示', async () => {
    backendStatus = 500;
    const { page, dialogs } = await feedPage();

    expect(await page.locator('text=Paused since').count()).toBe(0);
    await page.click('button:has-text("Pause Fetching")');
    await expect.poll(() => backendHits, { timeout: 10_000 }).toContain(`POST /do/admin/source/${sourceId}/pause`);
    await expect.poll(() => dialogs.filter(d => d.startsWith('alert')), { timeout: 10_000 })
      .toEqual([expect.stringMatching(/fail/i)]);
    await page.close();
  });
});
