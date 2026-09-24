import { sql, $articles, and, gte } from '@meridian/database';
import { formatScrapeFrequency, getDB } from '~/server/lib/utils';

export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const db = getDB(event);
  const sources = await db.query.$sources.findMany();
  if (sources.length === 0) {
    return { overview: null, sources: [] };
  }

  // get article stats for last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const articleStats = await db.query.$articles.findMany({
    where: sql`created_at >= ${sevenDaysAgo.toISOString()}`,
    columns: {
      sourceId: true,
      status: true,
      content_quality: true,
    },
  });

  // calculate per-source stats
  const sourceStats = sources.map(source => {
    const sourceArticles = articleStats.filter(a => a.sourceId === source.id);

    // calculate health metrics
    const totalArticles = sourceArticles.length;
    const processedArticles = sourceArticles.filter(a => a.status === 'PROCESSED');
    const failedArticles = sourceArticles.filter(a => a.status?.endsWith('_FAILED'));
    const lowQualityArticles = processedArticles.filter(
      a => a.content_quality === 'LOW_QUALITY' || a.content_quality === 'JUNK'
    );

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      category: source.category,
      paywall: source.paywall,
      frequency: formatScrapeFrequency(source.scrape_frequency),
      lastChecked: source.lastChecked?.toISOString(),

      // article counts
      totalArticles: sourceArticles.length,
      // articleStats 取的是近 7 天（见上），日均 = 7 天总数 / 7。原先是近 24 小时 / 24，实为「每小时」
      avgPerDay: sourceArticles.length / 7,

      // health metrics
      processSuccessRate: totalArticles ? (processedArticles.length / totalArticles) * 100 : null,
      errorRate: totalArticles ? (failedArticles.length / totalArticles) * 100 : null,
      lowQualityRate: processedArticles.length ? (lowQualityArticles.length / processedArticles.length) * 100 : null,
    };
  });

  // get global stats
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [lastSourceCheck, lastArticleProcessed, lastArticleFetched, todayStats, staleSources] = await Promise.all([
    // get latest source check
    db.query.$sources.findFirst({
      orderBy: sql`last_checked DESC NULLS LAST`,
      columns: { lastChecked: true },
    }),
    // get latest processed article
    db.query.$articles.findFirst({
      where: sql`status = 'PROCESSED'`,
      orderBy: sql`processed_at DESC NULLS LAST`,
      columns: { processedAt: true },
    }),
    // get latest fetched article
    db.query.$articles.findFirst({
      orderBy: sql`created_at DESC NULLS LAST`,
      columns: { createdAt: true },
    }),
    // get today's stats
    db.query.$articles.findMany({
      where: and(gte($articles.createdAt, startOfToday)),
      columns: {
        status: true,
        createdAt: true,
        processedAt: true,
      },
    }),
    // get stale sources count
    db.query.$sources.findMany({
      where: sql`(
        (scrape_frequency = 1 AND last_checked < NOW() - INTERVAL '2 hours') OR
        (scrape_frequency = 2 AND last_checked < NOW() - INTERVAL '8 hours') OR
        (scrape_frequency = 3 AND last_checked < NOW() - INTERVAL '12 hours') OR
        (scrape_frequency = 4 AND last_checked < NOW() - INTERVAL '48 hours')
      )`,
      columns: { id: true },
    }),
  ]);

  const overview = {
    lastSourceCheck: lastSourceCheck?.lastChecked?.toISOString() ?? null,
    lastArticleProcessed: lastArticleProcessed?.processedAt?.toISOString() ?? null,
    lastArticleFetched: lastArticleFetched?.createdAt?.toISOString() ?? null,
    articlesProcessedToday: todayStats.filter(a => a.status === 'PROCESSED').length,
    articlesFetchedToday: todayStats.length,
    errorsToday: todayStats.filter(a => a.status?.endsWith('_FAILED')).length,
    staleSourcesCount: staleSources.length,
    totalSourcesCount: sources.length,
  };

  return {
    overview,
    sources: sourceStats,
  };
});
