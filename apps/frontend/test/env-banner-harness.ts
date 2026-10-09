/**
 * STAGING 横幅与不收录声明的端到端测试共用的启动件：真实构建并启动 Nuxt 服务（node-server preset），
 * backend 用受控 HTTP 服务假冒——读者首页回放 backend 的快照，后台 Health 回 500（页面照样渲染布局，横幅只看布局）。
 * `setup()` 必须在测试文件顶层调用，所以这里只导出一个函数，由两个测试文件各调一次（环境变量不同）。
 */
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { builtSite } from './built-site';
import { anchorFromDate, detokenizeDates } from '../../backend/test/fixtures/reader/dates';

const BACKEND_GOLDEN = fileURLToPath(new URL('../../backend/test/fixtures/reader/__golden__/', import.meta.url));
const TOKEN = 'test-token';
const ADMIN = { username: 'test-admin', password: 'test-pass' };

export async function startSite(environment: string | undefined) {
  const anchor = anchorFromDate('2026-01-10');
  const replies = new Map<string, { status: number; body: string }>();
  for (const file of readdirSync(BACKEND_GOLDEN)) {
    const text = readFileSync(`${BACKEND_GOLDEN}${file}`, 'utf8');
    const newline = text.indexOf('\n');
    const meta = JSON.parse(text.slice(0, newline)) as { status: number; path: string };
    replies.set(meta.path, { status: meta.status, body: detokenizeDates(text.slice(newline + 1).trimEnd(), anchor) });
  }
  const backend = http.createServer((req, res) => {
    const reply = replies.get(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (reply === undefined) {
      res.statusCode = req.url?.startsWith('/observability/') ? 500 : 404;
      res.end('{}');
      return;
    }
    res.statusCode = reply.status;
    res.end(reply.body);
  });
  await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
  const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

  await setup({
    ...builtSite,
    env: {
      TZ: 'UTC',
      NUXT_PUBLIC_WORKER_API: backendUrl,
      NUXT_WORKER_API_TOKEN: TOKEN,
      NUXT_ADMIN_USERNAME: ADMIN.username,
      NUXT_ADMIN_PASSWORD: ADMIN.password,
      NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
      // 缺省场景整个键不传
      ...(environment === undefined ? {} : { NUXT_PUBLIC_ENVIRONMENT: environment }),
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

  /** 读者首页、归档页、运维台 Health 与登录页的服务端渲染结果 */
  async function pages(): Promise<Record<string, string>> {
    const cookie = await loginCookie();
    const html = async (path: string, withCookie = false) => {
      const res = await fetch(path, { headers: withCookie ? { cookie } : {} });
      expect(res.status).toBe(200);
      return res.text();
    };
    return {
      '/': await html('/'),
      '/briefs': await html('/briefs'),
      '/admin': await html('/admin', true),
      '/admin/login': await html('/admin/login'),
    };
  }
  return { pages };
}
