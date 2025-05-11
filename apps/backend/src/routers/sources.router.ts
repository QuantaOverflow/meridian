import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../app';
import { $sources, eq } from '@meridian/database';
import { zValidator } from '@hono/zod-validator';
import { tryCatchAsync } from '../lib/tryCatchAsync';
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

      const sourceResult = await tryCatchAsync(
        db.query.$sources.findFirst({
          where: eq($sources.id, c.req.valid('param').id),
        })
      );
      if (sourceResult.isErr()) {
        const error = sourceResult.error instanceof Error ? sourceResult.error : new Error(String(sourceResult.error));
        routeLogger.error('Failed to fetch source', { error_message: error.message }, error);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      const source = sourceResult.value;
      if (source === undefined) {
        routeLogger.warn('Source not found');
        return c.json({ error: "Source doesn't exist" }, 404);
      }

      routeLogger.debug('Source found, proceeding with deletion', { source_url: source.url });
      const doId = c.env.SOURCE_SCRAPER.idFromName(source.url); // Use URL for ID stability
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      const deleteResult = await tryCatchAsync(
        Promise.all([db.delete($sources).where(eq($sources.id, c.req.valid('param').id)), stub.destroy()])
      );
      if (deleteResult.isErr()) {
        const error = deleteResult.error instanceof Error ? deleteResult.error : new Error(String(deleteResult.error));
        routeLogger.error('Failed to delete source', undefined, error);
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
      const sourceResult = await tryCatchAsync(
        db.query.$sources.findFirst({
          where: eq($sources.id, c.req.valid('param').id),
        })
      );

      if (sourceResult.isErr()) {
        const error = sourceResult.error instanceof Error 
          ? sourceResult.error 
          : new Error(String(sourceResult.error));
        routeLogger.error('Failed to fetch source', { error_message: error.message }, error);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      const source = sourceResult.value;
      if (source === undefined) {
        routeLogger.warn('Source not found');
        return c.json({ error: "Source doesn't exist" }, 404);
      }

      // 更新源
      const updateResult = await tryCatchAsync(
        db
          .update($sources)
          .set(updateData)
          .where(eq($sources.id, c.req.valid('param').id))
      );

      if (updateResult.isErr()) {
        const error = updateResult.error instanceof Error 
          ? updateResult.error 
          : new Error(String(updateResult.error));
        routeLogger.error('Failed to update source', { error_message: error.message }, error);
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
      const existingSource = await tryCatchAsync(
        db.query.$sources.findFirst({
          where: eq($sources.url, sourceData.url),
        })
      );

      if (existingSource.isErr()) {
        const error = existingSource.error instanceof Error 
          ? existingSource.error 
          : new Error(String(existingSource.error));
        routeLogger.error('Failed to check for existing source', { error_message: error.message }, error);
        return c.json({ error: 'Failed to check for existing source' }, 500);
      }

      if (existingSource.value !== undefined) {
        routeLogger.warn('Source with this URL already exists', { existing_id: existingSource.value.id });
        return c.json({ 
          error: 'Source with this URL already exists', 
          existing_id: existingSource.value.id 
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
      const insertResult = await tryCatchAsync(
        db.insert($sources)
          .values(newSource)
          .returning({ id: $sources.id, url: $sources.url })
      );

      if (insertResult.isErr()) {
        const error = insertResult.error instanceof Error 
          ? insertResult.error 
          : new Error(String(insertResult.error));
        routeLogger.error('Failed to create source', { error_message: error.message }, error);
        return c.json({ error: 'Failed to create source' }, 500);
      }

      const createdSource = insertResult.value[0];
      routeLogger.info('Source created successfully', { id: createdSource.id, url: createdSource.url });

      try {
        // 初始化 Durable Object
        const doId = c.env.SOURCE_SCRAPER.idFromName(createdSource.url);
        const stub = c.env.SOURCE_SCRAPER.get(doId);
        const initResponse = await stub.fetch(new Request('http://internal/init'));
        
        if (!initResponse.ok) {
          const errorText = await initResponse.text();
          routeLogger.warn('Failed to initialize source DO, but source was created', { error: errorText });
          return c.json({ 
            id: createdSource.id,
            success: true,
            warning: 'Source created but not initialized. Use the init endpoint to initialize.' 
          }, 201);
        }
        
        // 更新 doInitialized 状态
        await db.update($sources)
          .set({ do_initialized_at: new Date() })
          .where(eq($sources.id, createdSource.id));
          
      } catch (error) {
        // DO初始化失败，但源已创建
        routeLogger.warn('Failed to initialize source DO, but source was created', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return c.json({ 
          id: createdSource.id,
          success: true,
          warning: 'Source created but not initialized. Use the init endpoint to initialize.' 
        }, 201);
      }

      // 全部成功
      return c.json({ 
        id: createdSource.id,
        success: true,
        message: 'Source created and initialized successfully' 
      }, 201);
    }
  );

export default route;
