import { Hono } from 'hono';
import { HonoEnv } from '../app';
import { $articles, $sources, and, eq, isNull } from '@meridian/database';
import { getDb } from '../lib/database';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Logger } from '../lib/core/logger';

const logger = new Logger({ router: 'durable-objects' });

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
  // admin endpoints
  .post(
    '/admin/source/:sourceId/init',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {

      const initLogger = logger.child({ operation: 'init-source' });
      const { sourceId } = c.req.valid('param');

      const db = getDb(c.env.HYPERDRIVE);

      // Get the source first
      let source;
      try {
        source = await db.query.$sources.findFirst({
          where: eq($sources.id, Number(sourceId)),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        initLogger.error('Failed to fetch source', { sourceId }, err);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      if (!source) {
        return c.json({ error: 'Source not found' }, 404);
      }
      if (source.paused_at) {
        return c.json({ error: 'Source is paused; resume it instead' }, 409);
      }

      // Initialize the DO
      const doId = c.env.SOURCE_SCRAPER.idFromName(source.url);
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      try {
        await stub.initialize({
          id: source.id,
          url: source.url,
          scrape_frequency: source.scrape_frequency,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        initLogger.error('Failed to initialize source DO', { sourceId, url: source.url }, err);
        return c.json({ error: 'Failed to initialize source DO' }, 500);
      }

      initLogger.info('Successfully initialized source DO', { sourceId, url: source.url });
      return c.json({ success: true });
    }
  )
  .post('/admin/initialize-dos', async c => {

    const initLogger = logger.child({ operation: 'initialize-dos' });
    initLogger.info('Initializing SourceScraperDOs from database');

    const db = getDb(c.env.HYPERDRIVE);

    // Get batch size from query params, default to 100
    const batchSize = Number(c.req.query('batchSize')) || 100;
    initLogger.info('Using batch size', { batchSize });

    let allSources;
    try {
      allSources = await db
        .select({
          id: $sources.id,
          url: $sources.url,
          scrape_frequency: $sources.scrape_frequency,
        })
        .from($sources)
        // 已暂停的源 do_initialized_at 也是空的，不跳过就会被这里重新拉起
        .where(and(isNull($sources.do_initialized_at), isNull($sources.paused_at)));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      initLogger.error('Failed to fetch sources from database', undefined, err);
      return c.json({ error: 'Failed to fetch sources from database' }, 500);
    }

    initLogger.info('Sources fetched from database', { source_count: allSources.length });

    // Process sources in batches
    let processedCount = 0;
    let successCount = 0;

    // Create batches of sources
    const batches = [];
    for (let i = 0; i < allSources.length; i += batchSize) {
      batches.push(allSources.slice(i, i + batchSize));
    }

    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      initLogger.info('Processing batch', { batchIndex: batchIndex + 1, batchSize: batch.length });

      const batchResults = await Promise.all(
        batch.map(async source => {
          const sourceLogger = initLogger.child({ source_id: source.id, url: source.url });
          const doId = c.env.SOURCE_SCRAPER.idFromName(source.url);
          const stub = c.env.SOURCE_SCRAPER.get(doId);

          sourceLogger.debug('Initializing DO');
          try {
            await stub.initialize(source);
            sourceLogger.debug('Successfully initialized DO');
            return true;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            sourceLogger.error('Failed to initialize DO', undefined, err);
            return false;
          }
        })
      );

      processedCount += batch.length;
      successCount += batchResults.filter(success => success).length;

      initLogger.info('Batch completed', {
        batchIndex: batchIndex + 1,
        batchSuccessful: batchResults.filter(success => success).length,
        totalProcessed: processedCount,
        totalSuccessful: successCount,
      });
    }

    initLogger.info('Initialization process complete', { total: allSources.length, successful: successCount });
    return c.json({ initialized: successCount, total: allSources.length });
  })
  .post(
    '/admin/source/:sourceId/pause',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {
      const pauseLogger = logger.child({ operation: 'pause-source' });
      const { sourceId } = c.req.valid('param');

      const db = getDb(c.env.HYPERDRIVE);

      let source;
      try {
        source = await db.query.$sources.findFirst({
          where: eq($sources.id, Number(sourceId)),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        pauseLogger.error('Failed to fetch source', { sourceId }, err);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      if (!source) {
        return c.json({ error: 'Source not found' }, 404);
      }

      // 先落标记再停 DO：停 DO 失败时，DO 下一次 alarm 看到标记也会自己停
      try {
        await db
          .update($sources)
          .set({ paused_at: source.paused_at ?? new Date(), do_initialized_at: null })
          .where(eq($sources.id, source.id));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        pauseLogger.error('Failed to mark source as paused', { sourceId }, err);
        return c.json({ error: 'Failed to mark source as paused' }, 500);
      }

      const stub = c.env.SOURCE_SCRAPER.get(c.env.SOURCE_SCRAPER.idFromName(source.url));
      try {
        await stub.destroy();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        pauseLogger.error('Failed to stop source DO', { sourceId }, err);
        return c.json({ error: 'Failed to stop source DO' }, 500);
      }

      pauseLogger.info('Paused source', { sourceId, url: source.url });
      return c.json({ success: true });
    }
  )
  .post(
    '/admin/source/:sourceId/resume',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {
      const resumeLogger = logger.child({ operation: 'resume-source' });
      const { sourceId } = c.req.valid('param');

      const db = getDb(c.env.HYPERDRIVE);

      let source;
      try {
        source = await db.query.$sources.findFirst({
          where: eq($sources.id, Number(sourceId)),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        resumeLogger.error('Failed to fetch source', { sourceId }, err);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      if (!source) {
        return c.json({ error: 'Source not found' }, 404);
      }

      // 先清标记再 init：反过来的话，DO 的第一次 alarm 可能还看到标记而自停
      try {
        await db.update($sources).set({ paused_at: null }).where(eq($sources.id, source.id));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        resumeLogger.error('Failed to clear paused mark', { sourceId }, err);
        return c.json({ error: 'Failed to clear paused mark' }, 500);
      }

      const stub = c.env.SOURCE_SCRAPER.get(c.env.SOURCE_SCRAPER.idFromName(source.url));
      try {
        await stub.initialize({
          id: source.id,
          url: source.url,
          scrape_frequency: source.scrape_frequency,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        resumeLogger.error('Failed to initialize source DO', { sourceId, url: source.url }, err);
        return c.json({ error: 'Failed to initialize source DO' }, 500);
      }

      resumeLogger.info('Resumed source', { sourceId, url: source.url });
      return c.json({ success: true });
    }
  )
  .delete(
    '/admin/source/:sourceId',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {

      const deleteLogger = logger.child({ operation: 'delete-source' });
      const { sourceId } = c.req.valid('param');

      const db = getDb(c.env.HYPERDRIVE);

      // Get the source first to get its URL
      let source;
      try {
        source = await db.query.$sources.findFirst({
          where: eq($sources.id, Number(sourceId)),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        deleteLogger.error('Failed to fetch source', { sourceId }, err);
        return c.json({ error: 'Failed to fetch source' }, 500);
      }

      if (!source) {
        return c.json({ error: 'Source not found' }, 404);
      }

      const doId = c.env.SOURCE_SCRAPER.idFromName(source.url);
      const stub = c.env.SOURCE_SCRAPER.get(doId);

      try {
        await stub.destroy();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        deleteLogger.error('Failed to destroy DO', { sourceId }, err);
        return c.json({ error: 'Failed to destroy DO' }, 500);
      }

      // Delete articles associated with this source
      try {
        await db.delete($articles).where(eq($articles.sourceId, Number(sourceId)));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        deleteLogger.error('Failed to delete articles', { sourceId }, err);
        return c.json({ error: 'Failed to delete articles' }, 500);
      }

      // Delete the source from the database
      try {
        await db.delete($sources).where(eq($sources.id, Number(sourceId)));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        deleteLogger.error('Failed to delete source from database', { sourceId }, err);
        return c.json({ error: 'Failed to delete source from database' }, 500);
      }

      deleteLogger.info('Successfully deleted source and associated resources', { sourceId });
      return c.json({ success: true });
    }
  );

export default route;
