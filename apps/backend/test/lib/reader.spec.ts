/**
 * 读者视图与后台源读数（src/lib/reader/）的响应快照。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * 灌 fixtures/reader/fixture.ts 的固定数据，把 `/reader/*`、`/admin/sources*` 的状态码与响应体原文存成
 * fixtures/reader/__golden__/*.golden。只拦「改动改变了响应」，不判断对错；日期换成相对记号，见 fixtures/reader/dates.ts。
 *
 * 这些 golden 同时是前端 e2e（apps/frontend/test/reader-api-golden.test.ts）里假 backend 回放的响应：
 * 每个文件首行记着请求路径，路径就是前端 server 路由转发时拼出来的那条。两段接起来 = 端到端不变。
 * 行为有意改了才重写：`pnpm -F @meridian/backend test test/lib/reader.spec.ts -u`，再看 git diff。
 */
import type { CountryBlocksPage, CountrySection } from '@meridian/contracts';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../../src/lib/database';
import { anchorFromDate, tokenizeDates } from '../fixtures/reader/dates';
import { dbToday, putBrief8Record, seedReaderFixture } from '../fixtures/reader/fixture';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
let anchor: Date;

beforeAll(async () => {
  anchor = anchorFromDate(await dbToday(db));
  await seedReaderFixture(db, anchor);
  await putBrief8Record(env.ARTICLES_BUCKET);
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
  // 地图首页的数据；边界情况在 reader-map.spec.ts
  'brief-8-map': '/reader/briefs/8/map',
  // 国家页：两节各自分页；JP 是表里有、但没有任何块的国家
  'country-il-placement': '/reader/countries/IL/blocks?section=placement&limit=20&offset=0',
  'country-il-placement-page': '/reader/countries/IL/blocks?section=placement&limit=1&offset=1',
  'country-il-mention': '/reader/countries/IL/blocks?section=mention&limit=20&offset=0',
  'country-jp-empty': '/reader/countries/JP/blocks?section=placement&limit=20&offset=0',
  'country-jp-mention-empty': '/reader/countries/JP/blocks?section=mention&limit=20&offset=0',
  'country-404': '/reader/countries/QQ/blocks?section=placement&limit=20&offset=0',
  'stories-list': '/reader/stories',
  'story-1-streak': '/reader/stories/1',
  'story-2-importance': '/reader/stories/2',
  'story-3-disputed': '/reader/stories/3',
  'story-4-dormant': '/reader/stories/4',
  'story-5-below-threshold': '/reader/stories/5',
  'story-6-representative-title': '/reader/stories/6',
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

  it('未发布的期（手动触发的调试期）：单期页 404，与不存在的期一样', async () => {
    const res = await exports.default.fetch('http://backend/reader/briefs/9', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
    expect(res.status).toBe(404);
  });

  it('线索标题：大线里最新但离群的成员抢不走标题，单词标题跳过，退回最近几条里离质心最近的', async () => {
    const res = await exports.default.fetch('http://backend/reader/stories/6', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toBe('Nepal — survivors found after ten days');
  });

  it('地图：不存在的期与未发布的期 404，回「Report not found」', async () => {
    for (const path of ['/reader/briefs/999/map', '/reader/briefs/9/map']) {
      const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: 'Report not found' });
    }
  });

  it('国家页：未发布的期的块不出现（第 9 期那块落点在以色列）；每块的落点或涉及确实含该国', async () => {
    const get = async (section: CountrySection) => {
      const res = await exports.default.fetch(`http://backend/reader/countries/IL/blocks?section=${section}`, {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as CountryBlocksPage;
    };
    const [placed, mentioned] = [await get('placement'), await get('mention')];

    expect(placed.items.map(b => [b.brief.id, b.storyId])).toEqual([[8, 15], [7, 13], [6, 12]]);
    expect(placed.total).toBe(3);
    expect(placed.items.every(b => b.countries.placement === 'IL')).toBe(true);
    expect(mentioned.items.map(b => [b.brief.id, b.storyId, b.countries])).toEqual([[7, 14, { placement: null, mentions: ['IL', 'IR'] }]]);
    expect(mentioned.total).toBe(1);
  });

  it('国家页：代码不分大小写；缺 section 默认是落点那一节', async () => {
    const res = await exports.default.fetch('http://backend/reader/countries/il/blocks', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
    expect(res.status).toBe(200);
    const page = (await res.json()) as CountryBlocksPage;
    expect([page.country, page.section, page.total]).toEqual(['IL', 'placement', 3]);
  });

  it('不带 token：401', async () => {
    for (const path of ['/reader/briefs', '/reader/stories/1', '/reader/countries/IL/blocks', '/admin/sources/1/details']) {
      expect((await exports.default.fetch(`http://backend${path}`)).status, path).toBe(401);
    }
  });

  it('参数不合法：400', async () => {
    for (const path of [
      '/reader/briefs?limit=0', '/reader/briefs/abc', '/reader/briefs/abc/map', '/reader/stories/1.5', '/admin/sources/abc/details',
      '/reader/countries/ISR/blocks', '/reader/countries/IL/blocks?section=both', '/reader/countries/IL/blocks?limit=51',
    ]) {
      const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status, path).toBe(400);
    }
  });
});
