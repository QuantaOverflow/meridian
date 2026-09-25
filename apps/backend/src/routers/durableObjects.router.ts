import { Hono, type Context } from 'hono';
import { HonoEnv } from '../app';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Logger } from '../lib/core/logger';
import {
  deleteSource,
  initAllSources,
  initSource,
  pauseSource,
  resumeSource,
  type SourceResult,
} from '../lib/sources';

const logger = new Logger({ router: 'durable-objects' });

const sourceIdParam = z.object({ sourceId: z.coerce.number().int() });

function toResponse(c: Context<HonoEnv>, result: SourceResult<void>) {
  return result.ok ? c.json({ success: true }) : c.json({ error: result.error }, result.status);
}

const route = new Hono<HonoEnv>()
  // handle DO-specific routes for GET requests
  .get(
    '/source/:sourceId/*',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {
      const { sourceId } = c.req.valid('param');
      const doId = c.env.SOURCE_SCRAPER.idFromName(decodeURIComponent(sourceId));
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      // reconstruct path for the DO
      const url = new URL(c.req.url);
      const pathParts = url.pathname.split('/');
      const doPath = '/' + pathParts.slice(4).join('/');
      const doUrl = new URL(doPath + url.search, 'http://do');

      const doRequest = new Request(doUrl.toString(), c.req.raw);
      return stub.fetch(doRequest);
    }
  )
  // handle DO-specific routes for POST requests
  .post(
    '/source/:sourceId/*',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {
      const { sourceId } = c.req.valid('param');
      const doId = c.env.SOURCE_SCRAPER.idFromName(decodeURIComponent(sourceId));
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      // reconstruct path for the DO
      const url = new URL(c.req.url);
      const pathParts = url.pathname.split('/');
      const doPath = '/' + pathParts.slice(4).join('/');
      const doUrl = new URL(doPath + url.search, 'http://do');

      const doRequest = new Request(doUrl.toString(), c.req.raw);
      return stub.fetch(doRequest);
    }
  )
  // admin endpoints：源的启停与删除都经 lib/sources.ts
  .post('/admin/source/:sourceId/init', zValidator('param', sourceIdParam), async c =>
    toResponse(c, await initSource(c.env, c.req.valid('param').sourceId))
  )
  .post('/admin/initialize-dos', async c => {
    // Get batch size from query params, default to 100
    const batchSize = Number(c.req.query('batchSize')) || 100;
    try {
      return c.json(await initAllSources(c.env, batchSize));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to fetch sources from database', { operation: 'initialize-dos' }, err);
      return c.json({ error: 'Failed to fetch sources from database' }, 500);
    }
  })
  .post('/admin/source/:sourceId/pause', zValidator('param', sourceIdParam), async c =>
    toResponse(c, await pauseSource(c.env, c.req.valid('param').sourceId))
  )
  .post('/admin/source/:sourceId/resume', zValidator('param', sourceIdParam), async c =>
    toResponse(c, await resumeSource(c.env, c.req.valid('param').sourceId))
  )
  .delete('/admin/source/:sourceId', zValidator('param', sourceIdParam), async c =>
    toResponse(c, await deleteSource(c.env, c.req.valid('param').sourceId))
  );

export default route;
