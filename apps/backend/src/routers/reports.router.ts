import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../app';
import { $reports, desc } from '@meridian/database';
import { hasValidAuthToken, getDb } from '../lib/utils';
import { zValidator } from '@hono/zod-validator';

const route = new Hono<HonoEnv>()
  .get('/last-report', async c => {
    // check auth token
    const hasValidToken = hasValidAuthToken(c);
    if (!hasValidToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    let report;
    try {
      report = await getDb(c.env.HYPERDRIVE).query.$reports.findFirst({
        orderBy: desc($reports.createdAt),
      });
    } catch (error) {
      return c.json({ error: 'Failed to fetch last report' }, 500);
    }

    if (report === undefined) {
      return c.json({ error: 'No report found' }, 404);
    }

    return c.json(report);
  })
  .post(
    '/report',
    zValidator(
      'json',
      z.object({
        title: z.string(),
        content: z.string(),
        totalArticles: z.number(),
        totalSources: z.number(),
        usedArticles: z.number(),
        usedSources: z.number(),
        tldr: z.string(),
        createdAt: z.coerce.date(),
        model_author: z.string(),
        clustering_params: z.object({
          umap: z.object({
            n_neighbors: z.number(),
          }),
          hdbscan: z.object({
            min_cluster_size: z.number(),
            min_samples: z.number(),
            epsilon: z.number(),
          }),
        }),
      })
    ),
    async c => {
      if (!hasValidAuthToken(c)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const db = getDb(c.env.HYPERDRIVE);
      const body = c.req.valid('json');

      try {
        await db.insert($reports).values(body);
      } catch (error) {
        return c.json({ error: 'Failed to insert report' }, 500);
      }

      return c.json({ success: true });
    }
  );

export default route;
