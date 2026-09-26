/**
 * 读者视图与后台源读数（src/lib/reader/）的响应快照。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * 灌 fixtures/reader/fixture.ts 的固定数据，把 `/reader/*`、`/admin/sources*` 的状态码与响应体原文存成
 * fixtures/reader/__golden__/*.golden。只拦「改动改变了响应」，不判断对错；日期换成相对记号，见 fixtures/reader/dates.ts。
 *
 * 这些 golden 同时是前端 e2e（apps/frontend/test/reader-api-golden.test.ts）里假 backend 回放的响应：
 * 每个文件首行记着请求路径，路径就是前端 server 路由转发时拼出来的那条。两段接起来 = 端到端不变。
 * 行为有意改了才重写：`pnpm -F @meridian/backend test test/lib/reader.spec.ts -u`，再看 git diff。
 */
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../../src/lib/database';
import { anchorFromDate, tokenizeDates } from '../fixtures/reader/dates';
import { dbToday, seedReaderFixture } from '../fixtures/reader/fixture';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
let anchor: Date;

beforeAll(async () => {
  anchor = anchorFromDate(await dbToday(db));
  await seedReaderFixture(db, anchor);
});

/** golden 名 → 请求路径（= 前端转发时拼出的路径，改了前端的拼法这里要跟着改） */
const CASES: Record<string, string> = {
  'briefs-list': '/reader/briefs?limit=20&offset=0',
  'briefs-list-page': '/reader/briefs?limit=3&offset=2',
  'briefs-search-hit': '/reader/briefs?q=ukraine&limit=20&offset=0',
  'briefs-search-percent': '/reader/briefs?q=100%25&limit=20&offset=0',
  'briefs-search-miss': '/reader/briefs?q=zzz-no-match&limit=20&offset=0',
  'briefs-latest': '/reader/briefs/latest',
  'brief-3-top-stories': '/reader/briefs/3',
  'brief-1-legacy': '/reader/briefs/1',
  'brief-2-artifacts': '/reader/briefs/2',
  'brief-404': '/reader/briefs/999',
  'stories-list': '/reader/stories',
  'story-1-streak': '/reader/stories/1',
  'story-2-importance': '/reader/stories/2',
  'story-3-disputed': '/reader/stories/3',
  'story-4-dormant': '/reader/stories/4',
  'story-5-below-threshold': '/reader/stories/5',
  'admin-sources': '/admin/sources',
  'admin-source-1-details': '/admin/sources/1/details',
  'admin-source-1-page-2': '/admin/sources/1/details?page=2',
  'admin-source-1-processed-asc': '/admin/sources/1/details?status=PROCESSED&sortBy=processedAt&sortOrder=asc',
  'admin-source-1-junk': '/admin/sources/1/details?quality=JUNK',
  'admin-source-1-partial-by-published': '/admin/sources/1/details?completeness=PARTIAL_USEFUL&sortBy=publishedAt',
  'admin-source-1-invalid-filters': '/admin/sources/1/details?status=NOPE&sortOrder=weird&page=x',
  'admin-source-2-details': '/admin/sources/2/details',
  'admin-source-3-paused-empty': '/admin/sources/3/details',
  'admin-source-404': '/admin/sources/999/details',
};

describe('读者视图与后台源读数快照', () => {
  for (const [name, path] of Object.entries(CASES)) {
    it(name, async () => {
      const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      const meta = JSON.stringify({ status: res.status, path });
      await expect(`${meta}\n${tokenizeDates(await res.text(), anchor)}\n`).toMatchFileSnapshot(
        `../fixtures/reader/__golden__/${name}.golden`
      );
    });
  }
});

describe('边界', () => {
  it('期号 0：404 而不是 400（前端的 slug 校验放行 0，原先直连库时回「Report not found」）', async () => {
    const res = await exports.default.fetch('http://backend/reader/briefs/0', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
    expect(res.status).toBe(404);
  });

  it('不带 token：401', async () => {
    for (const path of ['/reader/briefs', '/reader/stories/1', '/admin/sources', '/admin/sources/1/details']) {
      expect((await exports.default.fetch(`http://backend${path}`)).status, path).toBe(401);
    }
  });

  it('参数不合法：400', async () => {
    for (const path of ['/reader/briefs?limit=0', '/reader/briefs/abc', '/reader/stories/1.5', '/admin/sources/abc/details']) {
      const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status, path).toBe(400);
    }
  });
});
