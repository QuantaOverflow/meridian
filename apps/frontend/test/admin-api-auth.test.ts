/**
 * 后台接口的登录门：src/server/api/admin/ 下每个路由文件，没带会话一律 401（登录接口除外）。
 * 路由表从文件树读出来，新增一个后台接口不用改这个测试就被覆盖；门本身在 src/server/middleware/admin-auth.ts。
 * 真实构建并启动 Nuxt 服务；backend 指向一个不存在的地址——请求要是过了门，会因连不上 backend 回 502 而不是 401。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetch, setup } from '@nuxt/test-utils/e2e';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = path.join(ROOT, 'src/server/api/admin');
const ADMIN = { username: 'test-admin', password: 'test-pass' };

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** `sources/[id]/pause.post.ts` → { method: 'POST', path: '/api/admin/sources/1/pause' } */
function toRoute(file: string): { method: string; path: string } {
  const rel = path.relative(API_DIR, file).replace(/\.ts$/, '');
  const methodMatch = rel.match(/\.(get|post|put|patch|delete)$/);
  const method = (methodMatch?.[1] ?? 'get').toUpperCase();
  const segments = rel
    .replace(/\.(get|post|put|patch|delete)$/, '')
    .split(path.sep)
    .filter(s => s !== 'index')
    .map(s => (s.startsWith('[...') ? 'llm-calls/x/y.json' : s.startsWith('[') ? '1' : s));
  return { method, path: ['/api/admin', ...segments].join('/') };
}

const routes = routeFiles(API_DIR).map(toRoute);
const guarded = routes.filter(r => r.path !== '/api/admin/login');

await setup({
  rootDir: ROOT,
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    NUXT_PUBLIC_WORKER_API: 'http://127.0.0.1:9',
    NUXT_WORKER_API_TOKEN: 'test-token',
    NUXT_ADMIN_USERNAME: ADMIN.username,
    NUXT_ADMIN_PASSWORD: ADMIN.password,
    NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
  },
});

describe('后台接口的登录门', () => {
  it('文件树里读得到后台接口（读不到说明目录搬了，这个测试等于没验）', () => {
    expect(guarded.length).toBeGreaterThan(5);
    expect(routes.map(r => r.path)).toContain('/api/admin/login');
  });

  for (const route of guarded) {
    it(`${route.method} ${route.path}：没登录回 401`, async () => {
      const res = await fetch(route.path, { method: route.method });
      expect(res.status).toBe(401);
    });
  }

  it('反向对照：登录后同一个接口过得了门（连不上 backend，回 502 而不是 401）', async () => {
    const login = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const res = await fetch('/api/admin/ops/health', { headers: { cookie } });
    expect(res.status).toBe(502);
  });
});
