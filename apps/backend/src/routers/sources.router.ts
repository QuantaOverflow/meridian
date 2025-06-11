import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../app';
import { $sources, eq } from '@meridian/database';
import { zValidator } from '@hono/zod-validator';
import { hasValidAuthToken, getDb } from '../lib/utils';
import { Logger } from '../lib/logger';

const logger = new Logger({ router: 'sources' });

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
        operation: 'delete-source',
        source_id: c.req.valid('param').id,
      });
      routeLogger.info('Attempting to delete source');

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

      routeLogger.debug('Source found, proceeding with deletion', { source_url: source.url });
      const doId = c.env.SOURCE_SCRAPER.idFromName(source.url); // Use URL for ID stability
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      try {
        await Promise.all([db.delete($sources).where(eq($sources.id, c.req.valid('param').id)), stub.destroy()]);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to delete source', undefined, err);
        return c.json({ error: 'Failed to delete source' }, 500);
      }

      routeLogger.info('Source deleted successfully');
      return c.json({ success: true });
    }
  )
  .patch(
    '/:id',
    zValidator(
      'param',
      z.object({
        id: z.coerce.number(),
      })
    ),
    zValidator(
      'json',
      z.object({
        scrape_frequency: z.number().optional(),
        name: z.string().optional(),
        category: z.string().optional(),
        // 其他可更新的字段...
      })
    ),
    async c => {
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const routeLogger = logger.child({
        operation: 'update-source',
        source_id: c.req.valid('param').id,
      });
      routeLogger.info('Attempting to update source');

      const db = getDb(c.env.HYPERDRIVE);
      const updateData = c.req.valid('json');

      // 获取源信息
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

      // 更新源
      try {
        await db
          .update($sources)
          .set(updateData)
          .where(eq($sources.id, c.req.valid('param').id));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to update source', { error_message: err.message }, err);
        return c.json({ error: 'Failed to update source' }, 500);
      }

      routeLogger.info('Source updated successfully');
      return c.json({ success: true });
    }
  )
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        url: z.string().url('必须是有效的URL'),
        name: z.string().optional(),
        category: z.string().optional(),
        scrape_frequency: z.number().int().min(1).max(4).default(2),
        paywall: z.boolean().optional().default(false),
      })
    ),
    async c => {
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const routeLogger = logger.child({ operation: 'create-source' });
      const sourceData = c.req.valid('json');
      routeLogger.info('Attempting to create new source', { url: sourceData.url });

      const db = getDb(c.env.HYPERDRIVE);

      // 检查URL是否已存在
      let existingSource;
      try {
        existingSource = await db.query.$sources.findFirst({
          where: eq($sources.url, sourceData.url),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to check for existing source', { error_message: err.message }, err);
        return c.json({ error: 'Failed to check for existing source' }, 500);
      }

      if (existingSource !== undefined) {
        routeLogger.warn('Source with this URL already exists', { existing_id: existingSource.id });
        return c.json({ 
          error: 'Source with this URL already exists', 
          existing_id: existingSource.id 
        }, 409); // 409 Conflict
      }

      // 准备源数据用于插入
      const now = new Date();
      const newSource = {
        url: sourceData.url,
        name: sourceData.name || 'Unknown', // 默认名称
        category: sourceData.category || 'unknown', // 默认分类
        scrape_frequency: sourceData.scrape_frequency,
        paywall: sourceData.paywall,
        createdAt: now,
        lastChecked: null, // 尚未检查
        do_initialized_at: null // DO 尚未初始化
      };

      // 插入新源
      let createdSource;
      try {
        const result = await db.insert($sources).values(newSource).returning();
        createdSource = result[0];
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        routeLogger.error('Failed to create source', { error_message: err.message }, err);
        return c.json({ error: 'Failed to create source' }, 500);
      }

      routeLogger.info('Source created successfully', { source_id: createdSource.id });
      return c.json({ 
        success: true, 
        source: createdSource 
      }, 201);
    }
  );

export default route;
