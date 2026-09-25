/**
 * 后台「源」管理的端到端测试：真实构建并启动 Nuxt 服务（node-server preset），
 * 数据库用本机测试库，backend 用本文件起的受控 HTTP 服务假冒。
 *
 * 需要 FRONTEND_TEST_DATABASE_URL 指向一个已迁移到最新的**本机**库（见 README「测试」）。
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { $sources, getDb, sql } from '@meridian/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { $fetch, createPage, fetch, setup, url } from '@nuxt/test-utils/e2e';

const DB = process.env.FRONTEND_TEST_DATABASE_URL;
if (!DB) throw new Error('缺 FRONTEND_TEST_DATABASE_URL（本机测试库，见 apps/frontend/README.md「测试」）');
// 测试会 TRUNCATE sources：只许连本机库，防止误指到生产
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) throw new Error(`FRONTEND_TEST_DATABASE_URL 必须是本机库，拒绝: ${DB.replace(/:[^:@]*@/, ':***@')}`);

// ── 假 backend：状态码由测试控制，记录收到的请求 ──────────────────────────
let backendStatus = 200;
const backendHits: string[] = [];
const backend = http.createServer((req, res) => {
  backendHits.push(`${req.method} ${req.url}`);
  res.statusCode = backendStatus;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(backendStatus < 400 ? { success: true } : { error: 'backend exploded' }));
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const db = getDb(DB, { max: 1 });
const EXISTING_URL = 'https://example.com/feed.xml';
const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  browser: true,
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    NUXT_DATABASE_URL: DB,
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

let sourceId: number;
beforeEach(async () => {
  await db.execute(sql`truncate sources restart identity cascade`);
  const [row] = await db
    .insert($sources)
    .values({ url: EXISTING_URL, name: 'Example', category: 'news', scrape_frequency: 2 })
    .returning({ id: $sources.id });
  sourceId = row.id;
  backendHits.length = 0;
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
