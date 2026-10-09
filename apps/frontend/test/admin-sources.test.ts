/**
 * 后台「源」管理的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用本文件起的受控 HTTP 服务假冒。前端不连数据库，页面读到的源列表 / 详情也来自这个假 backend。
 */
import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OpsSourceKind, OpsSources } from '@meridian/contracts';
import { $fetch, createPage, fetch, setup, url } from '@nuxt/test-utils/e2e';
import { builtSite } from './built-site';

// ── 假 backend ─────────────────────────────────────────────────────────
// 读（GET /observability/ops/sources、/admin/sources/:id/details）按内存里的源列表回答；
// 写（其余方法）的状态码由测试控制、记录请求，建源成功时把源加进列表（真 backend 就是这么做的），页面列表才读得到
interface FakeSource {
  id: number;
  url: string;
  name: string;
  pausedAt: string | null;
  kind?: OpsSourceKind;
  lastChecked?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  lastArticleAt?: string | null;
  articles7d?: number;
  articles48h?: number;
  fetchFailedPct?: number | null;
  junkPct?: number | null;
  singleLinePct?: number | null;
  viaBrowserPct?: number | null;
}
let sources: FakeSource[] = [];
let backendStatus = 200;
const backendHits: string[] = [];
const backendBodies: unknown[] = [];

const LEVELS: Record<OpsSourceKind, OpsSources['sources'][number]['level']> = {
  ok: 'ok',
  not_checked: 'red',
  dead_feed: 'red',
  fetch_failing: 'yellow',
  bad_body: 'yellow',
  paused: 'grey',
};

function opsSource(s: FakeSource): OpsSources['sources'][number] {
  const kind = s.kind ?? (s.pausedAt ? 'paused' : 'ok');
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    category: 'news',
    frequency: '4 Hours',
    kind,
    level: LEVELS[kind],
    lastChecked: s.lastChecked ?? null,
    lastAttemptAt: s.lastAttemptAt ?? null,
    lastError: s.lastError ?? null,
    lastArticleAt: s.lastArticleAt ?? null,
    pausedAt: s.pausedAt,
    articles7d: s.articles7d ?? 0,
    articles48h: s.articles48h ?? 0,
    fetchFailedPct: s.fetchFailedPct ?? null,
    junkPct: s.junkPct ?? null,
    singleLinePct: s.singleLinePct ?? null,
    viaBrowserPct: s.viaBrowserPct ?? null,
  };
}

function opsSourcesReply(): OpsSources {
  const rows = sources.map(opsSource);
  const counts: OpsSources['counts'] = { ok: 0, not_checked: 0, dead_feed: 0, fetch_failing: 0, bad_body: 0, paused: 0 };
  for (const r of rows) counts[r.kind]++;
  return {
    generatedAt: '2026-10-05T12:00:00.000Z',
    counts,
    sources: rows,
    thresholds: { fetchFailingPct: 30, badBodyPct: 20, deadFeedMinArticles7d: 7, deadFeedQuietHours: 48 },
  };
}

function readReply(path: string): { status: number; body: unknown } {
  if (path === '/observability/ops/sources') return { status: 200, body: opsSourcesReply() };
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

describe('后台页面「Sources」视图', () => {
  async function sourcesPage() {
    const page = await createPage();
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
    });
    await page.goto(url('/admin/login'));
    await page.fill('input[name=username]', ADMIN.username);
    await page.fill('input[name=password]', ADMIN.password);
    await Promise.all([page.waitForURL('**/admin'), page.click('button[type=submit]')]);
    await page.goto(url('/admin/sources'));
    await page.waitForSelector('text=What counts as a problem');
    return page;
  }

  const fixture = (): FakeSource[] => [
    { id: 1, url: 'https://a.example/feed', name: 'Quiet Feed', pausedAt: null, kind: 'not_checked', lastChecked: '2026-10-05T09:33:00.000Z', lastArticleAt: '2026-10-05T08:33:00.000Z', articles7d: 85, articles48h: 24, fetchFailedPct: 0, junkPct: 0, singleLinePct: 7, viaBrowserPct: 6 },
    { id: 2, url: 'https://b.example/feed', name: 'Dead Feed', pausedAt: null, kind: 'dead_feed', articles7d: 9, articles48h: 0 },
    { id: 3, url: 'https://c.example/feed', name: 'Failing Feed', pausedAt: null, kind: 'fetch_failing', articles7d: 10, articles48h: 3, fetchFailedPct: 40 },
    { id: 4, url: 'https://d.example/feed', name: 'Flat Feed', pausedAt: null, kind: 'bad_body', articles7d: 536, articles48h: 161, singleLinePct: 100, junkPct: 0.9, viaBrowserPct: 74 },
    { id: 5, url: 'https://e.example/feed', name: 'Good Feed', pausedAt: null, kind: 'ok', articles7d: 43, articles48h: 17, singleLinePct: null },
    { id: 6, url: 'https://f.example/feed', name: 'Held Feed', pausedAt: '2026-09-25T17:04:00.000Z', kind: 'paused' },
  ];

  it('去了但失败的源：状态写 Check failing，Last checked 下面写出什么时候试的、为什么失败', async () => {
    sources = [
      { id: 1, url: 'https://a.example/feed', name: 'Blocked Feed', pausedAt: null, kind: 'not_checked', lastChecked: '2026-10-05T12:33:00.000Z', lastAttemptAt: '2026-10-05T15:54:00.000Z', lastError: 'Fetch failed with status: 406 Not Acceptable' },
      { id: 2, url: 'https://b.example/feed', name: 'Silent Feed', pausedAt: null, kind: 'not_checked', lastChecked: '2026-10-05T09:33:00.000Z' },
    ];
    const page = await sourcesPage();
    const rows = await page.locator('tbody tr[data-kind=not_checked]').allInnerTexts();
    const blocked = rows.find(r => r.includes('Blocked Feed'))!;
    const silent = rows.find(r => r.includes('Silent Feed'))!;
    expect(blocked).toContain('Check failing');
    // 15:54 UTC = 北京 23:54
    expect(blocked).toContain('Last attempt Oct 5 23:54 failed: Fetch failed with status: 406 Not Acceptable');
    expect(silent).toContain('Not checked');
    expect(silent).not.toContain('Last attempt');
    await page.close();
  });

  it('每种状态的计数、表格的每一行（状态名、7 天数字、比例）和规则图例', async () => {
    sources = fixture();
    const page = await sourcesPage();
    const summary = (kind: string) => page.locator(`section[aria-label=Summary] [data-kind=${kind}]`).innerText();
    expect(await summary('not_checked')).toMatch(/1\s+not checked/);
    expect(await summary('dead_feed')).toMatch(/1\s+dead feeds/);
    expect(await summary('fetch_failing')).toMatch(/1\s+fetch failing/);
    expect(await summary('bad_body')).toMatch(/1\s+bad body format/);
    expect(await summary('paused')).toMatch(/1\s+paused/);
    expect(await summary('ok')).toMatch(/1\s+OK/);

    const row = (kind: string) => page.locator(`tbody tr[data-kind=${kind}]`).innerText();
    expect(await row('not_checked')).toContain('Not checked');
    expect(await row('dead_feed')).toContain('Dead feed');
    expect(await row('fetch_failing')).toContain('Fetch failing');
    expect(await row('fetch_failing')).toContain('40%');
    const bad = await row('bad_body');
    expect(bad).toContain('Bad body');
    expect(bad).toContain('536');
    expect(bad).toContain('100%');
    expect(bad).toContain('74%');
    expect(await row('ok')).toContain('—'); // single-line 为 null：显示破折号，不是 0%
    expect(await page.locator('tbody tr').count()).toBe(6);

    const legend = await page.locator('section:has(h2:text("What counts as a problem"))').innerText();
    expect(legend).toContain('No successful check for two scrape intervals');
    expect(legend).toContain('At least 7 new articles in 7 days, none in the last 48 h');
    expect(legend).toContain('More than 30% of new articles failed to fetch');
    expect(legend).toContain('More than 20% junk pages or single-line bodies');
    expect(legend).toContain('Paused sources are grey and never count as a problem');
    await page.close();
  });

  it('时间按北京时间显示（UTC 09:33 → 17:33），从没有的显示 -', async () => {
    sources = fixture();
    const page = await sourcesPage();
    const first = await page.locator('tbody tr[data-kind=not_checked]').innerText();
    expect(first).toContain('Oct 5 17:33');
    expect(first).toContain('Oct 5 16:33');
    expect(await page.locator('tbody tr[data-kind=dead_feed]').innerText()).toContain('-');
    await page.close();
  });

  it('过滤：Problems 只留红黄，Paused 只留暂停的；暂停的源不算 Problems', async () => {
    sources = fixture();
    const page = await sourcesPage();
    await page.click('button:has-text("Problems 4")');
    expect(await page.locator('tbody tr').count()).toBe(4);
    expect(await page.locator('tbody tr[data-kind=paused]').count()).toBe(0);
    await page.click('button:has-text("Paused 1")');
    expect(await page.locator('tbody tr').count()).toBe(1);
    expect(await page.locator('tbody tr[data-kind=paused]').innerText()).toContain('Held Feed');
    await page.close();
  });

  it('「View Feed」链到单个源的页面', async () => {
    sources = fixture();
    const page = await sourcesPage();
    const href = await page.locator('tbody tr[data-kind=ok] a:has-text("View Feed")').getAttribute('href');
    expect(href).toBe('/admin/feed/5');
    await page.close();
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
    // 登录后落在运维台首页（Health），来源表在 Sources 页
    await page.goto(url('/admin/sources'));
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
