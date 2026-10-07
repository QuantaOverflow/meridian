import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../lib/database';
import { listBriefs, loadBrief } from '../lib/reader/briefs';
import { loadBriefMap } from '../lib/reader/brief-map';
import { countryCode, listCountryBlocks } from '../lib/reader/country-blocks';
import { searchBlocks } from '../lib/reader/search-blocks';
import { getStoryThread, listStoryThreads } from '../lib/reader/story-threads';
import type { Env } from '../index';

/**
 * 读者端（前端 /api/briefs*、/api/countries*、/api/search、/api/stories*）的数据。只出领域数据，展示（markdown 渲染、中文日期、
 * 「N 天前更新」文案）在前端 server 路由里做。鉴权在 app.ts 的挂载处。
 */
const app = new Hono<{ Bindings: Env }>();

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
// 0 与负数不拒绝，查不到就是 404（与前端原先直连库时一致：/api/briefs/0 是「Report not found」）
const idParamSchema = z.object({ id: z.coerce.number().int() });

app.get('/briefs', zValidator('query', listQuerySchema), async c => {
  return c.json(await listBriefs(getDb(c.env.HYPERDRIVE), c.req.valid('query')));
});

// 要在 /briefs/:id 之前注册，否则 latest 会被当成 id
app.get('/briefs/latest', async c => {
  const brief = await loadBrief(getDb(c.env.HYPERDRIVE), { kind: 'latest' });
  if (brief === null) return c.json({ error: 'No reports found' }, 404);
  return c.json(brief);
});

app.get('/briefs/:id', zValidator('param', idParamSchema), async c => {
  const brief = await loadBrief(getDb(c.env.HYPERDRIVE), { kind: 'id', id: c.req.valid('param').id });
  if (brief === null) return c.json({ error: 'Report not found' }, 404);
  return c.json(brief);
});

// 地图首页的数据（形状见 @meridian/contracts 的 BriefMap）。只有 :id 一种形式：首页先取 latest 再按期号取地图，两者不会指向不同的期
app.get('/briefs/:id/map', zValidator('param', idParamSchema), async c => {
  const map = await loadBriefMap(getDb(c.env.HYPERDRIVE), c.env.ARTICLES_BUCKET, c.req.valid('param').id);
  if (map === null) return c.json({ error: 'Report not found' }, 404);
  return c.json(map);
});

const countryParamSchema = z.object({ code: z.string().regex(/^[A-Za-z]{2}$/) });
const countryBlocksQuerySchema = z.object({
  section: z.enum(['placement', 'mention']).default('placement'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// 国家页的一节（形状见 @meridian/contracts 的 CountryBlocksPage）：落点在该国的块或涉及该国的块，跨所有已发布的期。
// 代码不在地点归一表里回 404；表里有、只是没有块的国家回空列表
app.get(
  '/countries/:code/blocks',
  zValidator('param', countryParamSchema),
  zValidator('query', countryBlocksQuerySchema),
  async c => {
    const country = countryCode(c.req.valid('param').code);
    if (country === null) return c.json({ error: 'Country not found' }, 404);
    return c.json(await listCountryBlocks(getDb(c.env.HYPERDRIVE), { country, ...c.req.valid('query') }));
  }
);

const searchQuerySchema = z.object({
  // 空查询与超过 200 字的查询回 400：前端在转发之前就拦下，到这里的只会是调用方写错了。
  // NUL 字符也拦：Postgres 的 text 存不了它，放过去是 500
  q: z.string().trim().min(1).max(200).refine(q => !q.includes('\0')),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // 上界：没有上界时，超出 bigint 的 offset 到了 Postgres 是 500
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// 搜索简报块（形状见 @meridian/contracts 的 SearchPage）：英文全文检索，只搜已发布各期的块，按线索折成组，分页按组数
app.get('/search', zValidator('query', searchQuerySchema), async c => {
  return c.json(await searchBlocks(getDb(c.env.HYPERDRIVE), c.req.valid('query')));
});

app.get('/stories', async c => {
  return c.json(await listStoryThreads(getDb(c.env.HYPERDRIVE)));
});

app.get('/stories/:id', zValidator('param', idParamSchema), async c => {
  const thread = await getStoryThread(getDb(c.env.HYPERDRIVE), c.req.valid('param').id);
  if (thread === null) return c.json({ error: 'Story thread not found' }, 404);
  return c.json(thread);
});

export default app;
