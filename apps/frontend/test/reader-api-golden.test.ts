/**
 * 读者与后台读接口（`/api/briefs*`、`/api/stories*`、`/api/admin/sources*` 的 GET）的响应快照。
 * 真实构建并启动 Nuxt 服务（node-server preset），给本机测试库灌固定 fixture
 * （apps/backend/test/fixtures/reader/fixture.ts），把每个接口的状态码、cache-control 与响应体原文存成 golden。
 * 只拦「改动改变了响应」，不判断对错。日期换成相对记号，见 fixtures/reader/dates.ts。
 *
 * 需要 FRONTEND_TEST_DATABASE_URL 指向一个已迁移到最新的**本机**库（见 README「测试」）。
 */
import { fileURLToPath } from 'node:url';
import { getDb } from '@meridian/database';
import { describe, expect, it } from 'vitest';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { anchorFromDate, tokenizeDates } from '../../backend/test/fixtures/reader/dates';
import { dbToday, seedReaderFixture } from '../../backend/test/fixtures/reader/fixture';

const DB = process.env.FRONTEND_TEST_DATABASE_URL;
if (!DB) throw new Error('缺 FRONTEND_TEST_DATABASE_URL（本机测试库，见 apps/frontend/README.md「测试」）');
// 测试会 TRUNCATE 表：只许连本机库，防止误指到生产
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) throw new Error(`FRONTEND_TEST_DATABASE_URL 必须是本机库，拒绝: ${DB.replace(/:[^:@]*@/, ':***@')}`);

const db = getDb(DB, { max: 1 });
const anchor = anchorFromDate(await dbToday(db));
await seedReaderFixture(db, anchor);

const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    // 与生产（Cloudflare，UTC）一致
    TZ: 'UTC',
    NUXT_DATABASE_URL: DB,
    NUXT_WORKER_API_TOKEN: 'test-token',
    NUXT_ADMIN_USERNAME: ADMIN.username,
    NUXT_ADMIN_PASSWORD: ADMIN.password,
    NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
  },
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

/** golden 名 → 请求路径；后台那组带登录会话 */
const READER_CASES: Record<string, string> = {
  'briefs-list': '/api/briefs',
  'briefs-list-page': '/api/briefs?limit=3&offset=2',
  'briefs-search-hit': '/api/briefs?q=ukraine',
  'briefs-search-percent': '/api/briefs?q=100%25',
  'briefs-search-miss': '/api/briefs?q=zzz-no-match',
  'briefs-invalid-query': '/api/briefs?limit=0',
  'briefs-latest': '/api/briefs/latest',
  'brief-3-top-stories': '/api/briefs/3',
  'brief-1-legacy': '/api/briefs/1',
  'brief-2-artifacts': '/api/briefs/2',
  'brief-404': '/api/briefs/999',
  'brief-invalid-slug': '/api/briefs/abc',
  'stories-list': '/api/stories',
  'story-1-streak': '/api/stories/1',
  'story-2-importance': '/api/stories/2',
  'story-3-disputed': '/api/stories/3',
  'story-4-dormant': '/api/stories/4',
  'story-5-below-threshold': '/api/stories/5',
  'story-invalid-id': '/api/stories/0',
};
const ADMIN_CASES: Record<string, string> = {
  'admin-sources': '/api/admin/sources',
  'admin-source-1-details': '/api/admin/sources/1/details',
  'admin-source-1-page-2': '/api/admin/sources/1/details?page=2',
  'admin-source-1-processed-asc': '/api/admin/sources/1/details?status=PROCESSED&sortBy=processedAt&sortOrder=asc',
  'admin-source-1-junk': '/api/admin/sources/1/details?quality=JUNK',
  'admin-source-1-partial-by-published': '/api/admin/sources/1/details?completeness=PARTIAL_USEFUL&sortBy=publishedAt',
  'admin-source-1-invalid-filters': '/api/admin/sources/1/details?status=NOPE&sortOrder=weird&page=x',
  'admin-source-2-details': '/api/admin/sources/2/details',
  'admin-source-3-paused-empty': '/api/admin/sources/3/details',
  'admin-source-404': '/api/admin/sources/999/details',
  'admin-source-invalid-id': '/api/admin/sources/abc/details',
};

async function snapshot(name: string, path: string, cookie?: string) {
  const res = await fetch(path, cookie === undefined ? undefined : { headers: { cookie } });
  const meta = JSON.stringify({ status: res.status, 'cache-control': res.headers.get('cache-control') });
  // 错误响应体里带请求的完整 URL，端口每次随机
  const body = tokenizeDates(await res.text(), anchor).replace(/http:\/\/127\.0\.0\.1:\d+/g, '{server}');
  const text = `${meta}\n${body}\n`;
  await expect(text).toMatchFileSnapshot(`./__golden__/reader-api/${name}.golden`);
}

describe('读者接口快照', () => {
  for (const [name, path] of Object.entries(READER_CASES)) {
    it(name, () => snapshot(name, path));
  }
});

describe('后台源读接口快照', () => {
  for (const [name, path] of Object.entries(ADMIN_CASES)) {
    it(name, async () => snapshot(name, path, await loginCookie()));
  }

  it('admin-sources-no-session', () => snapshot('admin-sources-no-session', '/api/admin/sources'));
});
