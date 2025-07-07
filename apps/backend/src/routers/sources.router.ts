import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../app';
import { $sources, eq } from '@meridian/database';
import { zValidator } from '@hono/zod-validator';
import { hasValidAuthToken } from '../lib/core/utils';
import { getDb } from '../lib/database';
import { Logger } from '../lib/core/logger';

const logger = new Logger({ router: 'sources' });

// 仅保留特定于sources的高级操作，基础CRUD移到admin路由
const route = new Hono<HonoEnv>()
  .delete(
    '/:id',
    zValidator(
      'param',
      z.object({
        id: z.coerce.number(),
      })
    ),
    async c => {
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const routeLogger = logger.child({
        operation: 'delete-source-with-do',
        source_id: c.req.valid('param').id,
      });
      routeLogger.info('Attempting to delete source with Durable Object cleanup');

      const db = getDb(c.env.HYPERDRIVE);

      let source;
      try {
        source = await db.query.$sources.findFirst({
          where: eq($sources.id, c.req.valid('param').id),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to fetch source', { error_message: err.message }, err);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      if (source === undefined) {
        routeLogger.warn('Source not found');
        return c.json({ error: "Source doesn't exist" }, 404);
      }

      routeLogger.debug('Source found, proceeding with deletion and DO cleanup', { source_url: source.url });
      const doId = c.env.SOURCE_SCRAPER.idFromName(source.url);
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      try {
        // 同时删除数据库记录和清理Durable Object
        await Promise.all([
          db.delete($sources).where(eq($sources.id, c.req.valid('param').id)), 
          stub.destroy()
        ]);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to delete source', undefined, err);
        return c.json({ error: 'Failed to delete source' }, 500);
      }

      routeLogger.info('Source deleted successfully with DO cleanup');
      return c.json({ success: true });
    }
  );

export default route;
