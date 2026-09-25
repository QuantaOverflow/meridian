import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../lib/database';
import { listBriefs, loadBrief } from '../lib/reader/briefs';
import { getStoryThread, listStoryThreads } from '../lib/reader/story-threads';
import type { Env } from '../index';

/**
 * 读者端（前端 /api/briefs*、/api/stories*）的数据。只出领域数据，展示（markdown 渲染、中文日期、
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

app.get('/stories', async c => {
  return c.json(await listStoryThreads(getDb(c.env.HYPERDRIVE)));
});

app.get('/stories/:id', zValidator('param', idParamSchema), async c => {
  const thread = await getStoryThread(getDb(c.env.HYPERDRIVE), c.req.valid('param').id);
  if (thread === null) return c.json({ error: 'Story thread not found' }, 404);
  return c.json(thread);
});

export default app;
