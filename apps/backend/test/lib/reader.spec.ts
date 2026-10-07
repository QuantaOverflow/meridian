/**
 * 读者视图与后台源读数（src/lib/reader/）的响应快照。走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md），
 * 灌 fixtures/reader/fixture.ts 的固定数据，把 `/reader/*`、`/admin/sources*` 的状态码与响应体原文存成
 * fixtures/reader/__golden__/*.golden。只拦「改动改变了响应」，不判断对错；日期换成相对记号，见 fixtures/reader/dates.ts。
 *
 * 这些 golden 同时是前端 e2e（apps/frontend/test/reader-api-golden.test.ts）里假 backend 回放的响应：
 * 每个文件首行记着请求路径，路径就是前端 server 路由转发时拼出来的那条。两段接起来 = 端到端不变。
 * 行为有意改了才重写：`pnpm -F @meridian/backend test test/lib/reader.spec.ts -u`，再看 git diff。
 */
import type { BlockEntitiesList, BriefBlockEntities, CountryBlocksPage, CountrySection, EntityBlocksPage, EntityIndex, FollowingPage, SearchPage } from '@meridian/contracts';
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
  // 第 8 期有简报块：前端阅读页的测试拿它看块下的实体链接
  'brief-8-with-blocks': '/reader/briefs/8',
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
  // 搜索：gaza 命中线索 1 的两块（折成一组）；holding 靠词形还原命中两组（线索 1 与没过线索门槛的簇 5）
  'search-gaza': '/reader/search?q=gaza&limit=20&offset=0',
  'search-holding': '/reader/search?q=holding&limit=20&offset=0',
  'search-holding-page': '/reader/search?q=holding&limit=1&offset=1',
  'search-miss': '/reader/search?q=zzz-no-match&limit=20&offset=0',
  // Following：关注以色列与线索 2——落点在以色列的三块、涉及以色列的一块（它同时命中线索 2）
  'following-il': '/reader/following?countries=IL&threads=&limit=20&offset=0',
  'following-il-thread-2': '/reader/following?countries=IL&threads=2&limit=20&offset=0',
  'following-il-thread-2-page': '/reader/following?countries=IL&threads=2&limit=2&offset=1',
  'following-thread-1': '/reader/following?countries=&threads=1&limit=20&offset=0',
  'following-miss': '/reader/following?countries=JP&threads=&limit=20&offset=0',
  // 实体页：Benjamin Netanyahu 恰好过门槛（已发布的 5 块）；Hamas 差一块，404；Iran 能归成国家，不开页
  'entity-netanyahu': '/reader/entities/blocks?name=benjamin%20netanyahu&limit=20&offset=0',
  'entity-netanyahu-page': '/reader/entities/blocks?name=benjamin%20netanyahu&limit=2&offset=1',
  'entity-hamas-below-threshold': '/reader/entities/blocks?name=hamas&limit=20&offset=0',
  'entity-iran-country': '/reader/entities/blocks?name=iran&limit=20&offset=0',
  // 实体列表页与阅读页每块下的实体链接
  'entities-list': '/reader/entities',
  'brief-8-block-entities': '/reader/briefs/8/block-entities',
  'following-entity': '/reader/following?countries=&threads=&entities=benjamin%20netanyahu&limit=20&offset=0',
  'following-il-entity': '/reader/following?countries=IL&threads=&entities=benjamin%20netanyahu&limit=20&offset=0',
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

// 块下的实体链接：前端列块的每个接口（国家页、搜索、Following、实体页）拿到块之后都按块号问一次，
// 上面每个列块的 case 对应的那批块号（升序）各录一份，前端 e2e 回放时才对得上
for (const ids of ['1,4', '4,5', '5', '1,2,4', '2', '3', '1,2,3,4', '2,3', '1,2,3,4,5', '2,5']) {
  CASES[`block-entities-${ids.replaceAll(',', '-')}`] = `/reader/block-entities?ids=${ids}`;
}

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

  describe('搜索', () => {
    const search = async (q: string, extra = '') => {
      const res = await exports.default.fetch(`http://backend/reader/search?q=${encodeURIComponent(q)}${extra}`, {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(res.status, q).toBe(200);
      return (await res.json()) as SearchPage;
    };
    /** 每组：线索号（没有为 null）与组内各块的 [期号, 故事号] */
    const shape = (page: SearchPage) => page.items.map(g => [g.thread?.id ?? null, g.blocks.map(b => [b.brief.id, b.storyId])]);

    it('同一线索的块折成一组，组内最新的在前；带线索的标题与期数', async () => {
      const page = await search('gaza');
      expect(shape(page)).toEqual([[1, [[8, 15], [6, 12]]]]);
      expect(page.items[0].thread).toEqual({ id: 1, title: 'Gaza — ceasefire holds', briefCount: 3 });
      expect([page.query, page.total, page.totalBlocks, page.items[0].blockCount]).toEqual(['gaza', 1, 2, 2]);
    });

    it('词形还原：搜 holding 命中写着 holds 的块，搜 sanction 命中 sanctions；正文与标题都搜', async () => {
      // 簇 5 只出现在一期，不到线索门槛：照常成组，但不带线索
      expect(shape(await search('holding'))).toEqual([[1, [[8, 15]]], [null, [[8, 16]]]]);
      expect(shape(await search('sanction'))).toEqual([[2, [[7, 14]]]]);
      // deliveries 只在正文里
      expect(shape(await search('delivery'))).toEqual([[1, [[8, 15]]]]);
    });

    it('多个词是「都要有」；引号是短语；首尾空白与大小写不计', async () => {
      expect(shape(await search('  Gaza Cairo '))).toEqual([[1, [[6, 12]]]]);
      expect((await search('gaza cairo')).query).toBe('gaza cairo');
      expect(shape(await search('"held rates"'))).toEqual([[null, [[8, 16]]]]);
      expect(shape(await search('"rates held"'))).toEqual([]);
    });

    it('未发布的期的块不出现（第 9 期那块写着 debug）', async () => {
      const page = await search('debug');
      expect([page.total, page.totalBlocks, page.items]).toEqual([0, 0, []]);
    });

    it('分页按组数；翻过头是空页，总数不变', async () => {
      const second = await search('holding', '&limit=1&offset=1');
      expect(shape(second)).toEqual([[null, [[8, 16]]]]);
      expect([second.total, second.totalBlocks]).toEqual([2, 2]);
      for (const offset of [5, 100000]) {
        const beyond = await search('holding', `&offset=${offset}`);
        expect([beyond.total, beyond.totalBlocks, beyond.items], String(offset)).toEqual([2, 2, []]);
      }
    });

    it('查询串里的检索语法符号与只有停用词的查询：200，不报错', async () => {
      for (const q of ["gaza & | ! ( ' :*", 'the', '100%', '"']) await search(q);
      expect((await search('the')).total).toBe(0);
    });

    it('空查询、只有空白、超过 200 字、带 NUL 字符（Postgres 的 text 存不了）：400', async () => {
      for (const path of [
        '/reader/search', '/reader/search?q=', '/reader/search?q=%20%20', `/reader/search?q=${'a'.repeat(201)}`,
        '/reader/search?q=a%00b', '/reader/search?q=%00',
      ]) {
        const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
        expect(res.status, path).toBe(400);
      }
      expect((await search('a'.repeat(200))).total).toBe(0);
    });
  });

  describe('Following', () => {
    const following = async (query: string) => {
      const res = await exports.default.fetch(`http://backend/reader/following?${query}`, {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(res.status, query).toBe(200);
      return (await res.json()) as FollowingPage;
    };
    /** 每块：[期号, 故事号] */
    const blocks = (page: FollowingPage) => page.items.map(b => [b.brief.id, b.storyId]);

    it('关注一个国家 = 落点在该国的块 + 涉及该国的块，后者标 mention；最新的在前，同一期内按正文顺序', async () => {
      const page = await following('countries=IL');
      expect(page.items.map(b => [b.brief.id, b.storyId, b.matches])).toEqual([
        [8, 15, [{ kind: 'country', code: 'IL', via: 'placement' }]],
        [7, 13, [{ kind: 'country', code: 'IL', via: 'placement' }]],
        [7, 14, [{ kind: 'country', code: 'IL', via: 'mention' }]],
        [6, 12, [{ kind: 'country', code: 'IL', via: 'placement' }]],
      ]);
      expect(page.total).toBe(4);
      expect(page.items[2].countries).toEqual({ placement: null, mentions: ['IL', 'IR'] });
    });

    it('关注一条线索：它在各期的块；带回线索现在的标题与期数', async () => {
      const page = await following('threads=1');
      expect(page.items.map(b => [b.brief.id, b.storyId, b.matches])).toEqual([
        [8, 15, [{ kind: 'thread', id: 1 }]],
        [7, 13, [{ kind: 'thread', id: 1 }]],
        [6, 12, [{ kind: 'thread', id: 1 }]],
      ]);
      expect(page.threads).toEqual([{ id: 1, title: 'Gaza — ceasefire holds', briefCount: 3 }]);
    });

    it('几个关注项取并集，一块只出现一次，命中的关注项都列出（国家在前）', async () => {
      const page = await following('countries=ir,IL&threads=2,1');
      expect(blocks(page)).toEqual([[8, 15], [7, 13], [7, 14], [6, 12]]);
      expect(page.items[0].matches).toEqual([{ kind: 'country', code: 'IL', via: 'placement' }, { kind: 'thread', id: 1 }]);
      expect(page.items[2].matches).toEqual([
        { kind: 'country', code: 'IL', via: 'mention' },
        { kind: 'country', code: 'IR', via: 'mention' },
        { kind: 'thread', id: 2 },
      ]);
      expect(page.threads.map(t => t.id)).toEqual([1, 2]);
    });

    it('未发布的期的块不出现（第 9 期那块落点在以色列、属于线索 1）', async () => {
      const page = await following('countries=IL&threads=1');
      expect(page.items.some(b => b.brief.id === 9)).toBe(false);
      expect(page.total).toBe(4);
    });

    it('没过线索门槛的簇（簇 5 只出现在一期）：块照常命中，但不在 threads 里；不存在的线索号什么都不命中', async () => {
      const page = await following('threads=5,999');
      expect(blocks(page)).toEqual([[8, 16]]);
      expect(page.threads).toEqual([]);
    });

    it('没带关注项、关注项都不认得（地点归一表里没有的代码）：200，空页', async () => {
      for (const query of ['', 'countries=&threads=', 'countries=QQ']) {
        expect(await following(query), query).toEqual({ total: 0, items: [], threads: [] });
      }
      // 不认得的代码不影响其余关注项
      expect(blocks(await following('countries=QQ,IR'))).toEqual([[7, 14]]);
    });

    it('分页按块数；翻过头是空页，总数不变', async () => {
      const second = await following('countries=IL&limit=2&offset=1');
      expect(blocks(second)).toEqual([[7, 13], [7, 14]]);
      expect(second.total).toBe(4);
      const beyond = await following('countries=IL&offset=50');
      expect([beyond.total, beyond.items]).toEqual([4, []]);
    });

    it('关注一个实体：挂着它的块，不论它有没有实体页（Hamas 没过门槛，块照常命中）；写法只归一大小写与首尾空白', async () => {
      const page = await following('entities=%20HAMAS');
      expect(page.items.map(b => [b.brief.id, b.storyId, b.matches])).toEqual([
        [8, 15, [{ kind: 'entity', key: 'hamas', name: 'Hamas' }]],
        [7, 13, [{ kind: 'entity', key: 'hamas', name: 'Hamas' }]],
        [7, 14, [{ kind: 'entity', key: 'hamas', name: 'Hamas' }]],
        [6, 12, [{ kind: 'entity', key: 'hamas', name: 'Hamas' }]],
      ]);
      expect(page.total).toBe(4);
    });

    it('实体与国家、线索取并集；几个实体用重复的参数带；命中的关注项里实体排在最后', async () => {
      const page = await following('countries=IR&threads=5&entities=hamas&entities=federal%20reserve');
      expect(blocks(page)).toEqual([[8, 15], [8, 16], [7, 13], [7, 14], [6, 12]]);
      expect(page.items[1].matches).toEqual([{ kind: 'thread', id: 5 }, { kind: 'entity', key: 'federal reserve', name: 'Federal Reserve' }]);
      expect(page.items[3].matches).toEqual([
        { kind: 'country', code: 'IR', via: 'mention' },
        { kind: 'entity', key: 'hamas', name: 'Hamas' },
      ]);
    });

    it('实体写法是空的、超过 200 字、带 NUL、超过 100 个：400', async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => `entities=e${i}`).join('&');
      for (const query of ['entities=', 'entities=%20', `entities=${'a'.repeat(201)}`, 'entities=a%00b', many(101)]) {
        const res = await exports.default.fetch(`http://backend/reader/following?${query}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
        expect(res.status, query.slice(0, 40)).toBe(400);
      }
      expect((await following(many(100))).total).toBe(0);
    });

    it('关注项写法不对、每类超过 100 个：400', async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');
      for (const path of [
        '/reader/following?countries=ISR', '/reader/following?countries=IL;IR', '/reader/following?threads=abc',
        '/reader/following?threads=1.5', '/reader/following?threads=-1', '/reader/following?threads=99999999999999999999',
        `/reader/following?threads=${many(101)}`, `/reader/following?countries=${Array.from({ length: 101 }, () => 'IL').join(',')}`,
        '/reader/following?countries=IL&limit=51', '/reader/following?countries=IL&offset=100001',
      ]) {
        const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
        expect(res.status, path).toBe(400);
      }
      // 恰好 100 个照常：线索 1、2 与簇 5 在已发布各期共 5 块
      expect((await following(`threads=${many(100)}`)).total).toBe(5);
    });
  });

  describe('实体页', () => {
    const get = (query: string) =>
      exports.default.fetch(`http://backend/reader/entities/blocks?${query}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
    const page = async (query: string) => {
      const res = await get(query);
      expect(res.status, query).toBe(200);
      return (await res.json()) as EntityBlocksPage;
    };

    it('过门槛的实体：它在已发布各期的块，最新的在前；显示写法取最常见的那种', async () => {
      const result = await page('name=benjamin%20netanyahu');
      if (result.kind !== 'entity') throw new Error('应是实体页');
      expect(result.entity).toEqual({ key: 'benjamin netanyahu', name: 'Benjamin Netanyahu' });
      expect(result.items.map(b => [b.brief.id, b.storyId])).toEqual([[8, 15], [8, 16], [7, 13], [7, 14], [6, 12]]);
      expect(result.total).toBe(5);
    });

    it('查的写法只归一大小写与首尾空白', async () => {
      const result = await page(`name=${encodeURIComponent('  BENJAMIN Netanyahu ')}`);
      expect(result.kind === 'entity' && result.total).toBe(5);
      // 别名不合并：少一个词就是另一个实体
      expect((await get('name=netanyahu')).status).toBe(404);
    });

    it('门槛只数已发布的期：Hamas 把未发布的第 9 期那块算上才够，没有页；只出现一块的、媒体名、没人提过的也没有', async () => {
      for (const name of ['hamas', 'federal reserve', 'reuters', 'nobody']) {
        const res = await get(`name=${encodeURIComponent(name)}`);
        expect(res.status, name).toBe(404);
        expect(await res.json(), name).toEqual({ error: 'Entity not found' });
      }
    });

    it('能归成国家的写法不开页，告诉页面去哪个国家页', async () => {
      expect(await page('name=Iran')).toEqual({ kind: 'country', country: 'IR' });
      expect(await page('name=united%20states')).toEqual({ kind: 'country', country: 'US' });
    });

    it('分页按块数；翻过头是空页，总数不变', async () => {
      const second = await page('name=benjamin%20netanyahu&limit=2&offset=1');
      if (second.kind !== 'entity') throw new Error('应是实体页');
      expect(second.items.map(b => [b.brief.id, b.storyId])).toEqual([[8, 16], [7, 13]]);
      expect(second.total).toBe(5);
      const beyond = await page('name=benjamin%20netanyahu&offset=50');
      expect(beyond.kind === 'entity' && [beyond.total, beyond.items]).toEqual([5, []]);
    });

    it('缺写法、空写法、超过 200 字、带 NUL 字符：400', async () => {
      for (const query of ['', 'name=', 'name=%20', `name=${'a'.repeat(201)}`, 'name=a%00b', 'name=x&limit=51', 'name=x&offset=100001']) {
        expect((await get(query)).status, query).toBe(400);
      }
    });

    describe('块下的实体链接', () => {
      const entitiesOf = async (ids: string) => {
        const res = await exports.default.fetch(`http://backend/reader/block-entities?ids=${ids}`, {
          headers: { Authorization: `Bearer ${env.API_TOKEN}` },
        });
        expect(res.status, ids).toBe(200);
        return (await res.json()) as BlockEntitiesList;
      };

      it('只列有实体页的实体（Hamas、Federal Reserve 没过门槛，不列）；按请求里的顺序；显示写法各块一致（块 5 自己存的是小写）', async () => {
        expect(await entitiesOf('5,3')).toEqual({
          items: [
            { blockId: 5, entities: [{ key: 'benjamin netanyahu', name: 'Benjamin Netanyahu' }] },
            { blockId: 3, entities: [{ key: 'benjamin netanyahu', name: 'Benjamin Netanyahu' }] },
          ],
        });
      });

      it('未发布的期的块（块 6）、不存在的块不在结果里', async () => {
        expect((await entitiesOf('6,999')).items).toEqual([]);
      });

      it('没带块号、写法不对、超过 500 个：400', async () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');
        for (const query of ['', '?ids=', '?ids=abc', '?ids=1;2', '?ids=99999999999999999999', `?ids=${many(501)}`]) {
          const res = await exports.default.fetch(`http://backend/reader/block-entities${query}`, {
            headers: { Authorization: `Bearer ${env.API_TOKEN}` },
          });
          expect(res.status, query).toBe(400);
        }
        expect((await entitiesOf(many(500))).items.length).toBe(5);
      });
    });
  });

  describe('实体列表', () => {
    it('只列有实体页的实体，带块数（只数已发布的期）：没过门槛的 Hamas、媒体名、国家都不在', async () => {
      const res = await exports.default.fetch('http://backend/reader/entities', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status).toBe(200);
      expect((await res.json()) as EntityIndex).toEqual({ items: [{ key: 'benjamin netanyahu', name: 'Benjamin Netanyahu', blocks: 5 }] });
    });
  });

  describe('一期里各块的实体', () => {
    const entitiesOf = async (id: string) => {
      const res = await exports.default.fetch(`http://backend/reader/briefs/${id}/block-entities`, {
        headers: { Authorization: `Bearer ${env.API_TOKEN}` },
      });
      expect(res.status, id).toBe(200);
      return (await res.json()) as BriefBlockEntities;
    };

    it('按块在正文里的顺序；只列有实体页的实体', async () => {
      const netanyahu = [{ key: 'benjamin netanyahu', name: 'Benjamin Netanyahu' }];
      expect(await entitiesOf('8')).toEqual({ items: [{ position: 0, entities: netanyahu }, { position: 1, entities: netanyahu }] });
      expect(await entitiesOf('6')).toEqual({ items: [{ position: 0, entities: netanyahu }] });
    });

    it('未发布的期（第 9 期）、没有块的期、不存在的期：空', async () => {
      for (const id of ['9', '1', '999', '0']) expect(await entitiesOf(id), id).toEqual({ items: [] });
    });

    it('期号不是整数：400', async () => {
      const res = await exports.default.fetch('http://backend/reader/briefs/abc/block-entities', { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status).toBe(400);
    });
  });

  it('不带 token：401', async () => {
    for (const path of ['/reader/briefs', '/reader/stories/1', '/reader/countries/IL/blocks', '/reader/search?q=gaza', '/reader/following?countries=IL', '/reader/entities/blocks?name=hamas', '/reader/block-entities?ids=1', '/reader/entities', '/reader/briefs/8/block-entities', '/admin/sources/1/details']) {
      expect((await exports.default.fetch(`http://backend${path}`)).status, path).toBe(401);
    }
  });

  it('参数不合法：400', async () => {
    for (const path of [
      '/reader/briefs?limit=0', '/reader/briefs/abc', '/reader/briefs/abc/map', '/reader/stories/1.5', '/admin/sources/abc/details',
      '/reader/countries/ISR/blocks', '/reader/countries/IL/blocks?section=both', '/reader/countries/IL/blocks?limit=51',
      '/reader/search?q=gaza&limit=51', '/reader/search?q=gaza&offset=-1',
      '/reader/search?q=gaza&offset=100001', '/reader/search?q=gaza&offset=99999999999999999999',
    ]) {
      const res = await exports.default.fetch(`http://backend${path}`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
      expect(res.status, path).toBe(400);
    }
  });
});
