import { Hono } from 'hono';
import { HonoEnv } from '../app';
import { $articles, $sources, eq, isNull } from '@meridian/database';
import { hasValidAuthToken, getDb } from '../lib/utils';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Logger } from '../lib/logger';

const logger = new Logger({ router: 'durable-objects' });

const route = new Hono<HonoEnv>()
  // handle DO-specific routes
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
      // auth check
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

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
    // auth check
    if (!hasValidAuthToken(c)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

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
        .where(isNull($sources.do_initialized_at));
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
  .delete(
    '/admin/source/:sourceId',
    zValidator(
      'param',
      z.object({
        sourceId: z.string().min(1, 'Source ID is required'),
      })
    ),
    async c => {
      // auth check
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

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
