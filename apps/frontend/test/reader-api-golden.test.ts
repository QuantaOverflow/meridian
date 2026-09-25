/**
 * 读者与后台读接口（`/api/briefs*`、`/api/stories*`、`/api/admin/sources*` 的 GET）的响应快照。
 * 真实构建并启动 Nuxt 服务（node-server preset），backend 用本文件起的 HTTP 服务假冒：它回放 backend 自己的快照
 * （apps/backend/test/fixtures/reader/__golden__/，由 backend 的 reader.spec.ts 对同一份 fixture 跑真实路由生成），
 * 前端的输出再与 `__golden__/reader-api/` 比对。后者是前端还直连数据库时对同一份 fixture 录下的，
 * 所以两段都绿 = 搬到 backend 前后 `/api/*` 的响应逐字节一致（状态码、cache-control、响应体原文）。
 * 只拦「改动改变了响应」，不判断对错。日期换成相对记号，见 apps/backend/test/fixtures/reader/dates.ts。
 */
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { anchorFromDate, detokenizeDates, tokenizeDates } from '../../backend/test/fixtures/reader/dates';

// 回放用的「今天」取一个固定日期：前端不再依赖当前时间（天数由 backend 算好）。
// 取在年初，让 fixture 的日期跨年，顺带验证短日期「M 月 D 日」的记号换算
const anchor = anchorFromDate('2026-01-10');
const TOKEN = 'test-token';

// ── 假 backend：按请求路径回放 backend 快照 ─────────────────────────────
const BACKEND_GOLDEN = fileURLToPath(new URL('../../backend/test/fixtures/reader/__golden__/', import.meta.url));
const replies = new Map<string, { status: number; body: string }>();
for (const file of readdirSync(BACKEND_GOLDEN)) {
  const text = readFileSync(`${BACKEND_GOLDEN}${file}`, 'utf8');
  const newline = text.indexOf('\n');
  const meta = JSON.parse(text.slice(0, newline)) as { status: number; path: string };
  replies.set(meta.path, { status: meta.status, body: detokenizeDates(text.slice(newline + 1).trimEnd(), anchor) });
}

const unexpected: string[] = [];
const backend = http.createServer((req, res) => {
  const reply = replies.get(req.url ?? '');
  if (req.method !== 'GET' || req.headers.authorization !== `Bearer ${TOKEN}` || reply === undefined) {
    unexpected.push(`${req.method} ${req.url} (${req.headers.authorization})`);
    res.statusCode = 500;
    res.end();
    return;
  }
  res.statusCode = reply.status;
  res.setHeader('content-type', 'application/json');
  res.end(reply.body);
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    // 与生产（Cloudflare，UTC）一致
    TZ: 'UTC',
    NUXT_PUBLIC_WORKER_API: backendUrl,
    NUXT_WORKER_API_TOKEN: TOKEN,
    NUXT_ADMIN_USERNAME: ADMIN.username,
    NUXT_ADMIN_PASSWORD: ADMIN.password,
    NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
  },
});

afterAll(() => {
  backend.close();
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
  // 前端转发的每条请求都必须命中一份 backend 快照（路径、方法、token 都对）
  expect(unexpected).toEqual([]);
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

describe('backend 故障', () => {
  it('backend 回 5xx：前端回 502', async () => {
    replies.set('/reader/stories', { status: 500, body: '{"error":"boom"}' });
    expect((await fetch('/api/stories')).status).toBe(502);
  });
});
