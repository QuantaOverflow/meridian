import {
  $articles,
  $sources,
  and,
  articleCompletenessEnum,
  articleContentQualityEnum,
  articleStatusEnum,
  desc,
  eq,
  gte,
  sql,
} from '@meridian/database';
import type { Db } from './db';

/**
 * 后台「源」页面的读数（原在前端 server/api/admin/sources/*.get 直连库）：总览与单个源的文章列表。
 * 源的写操作在 ../sources.ts。
 */

function formatScrapeFrequency(scrapeFrequency: number): string {
  switch (scrapeFrequency) {
    case 1:
      return 'Hourly';
    case 2:
      return '4 Hours';
    case 3:
      return '6 Hours';
    default:
      return 'Daily';
  }
}

export async function getSourcesOverview(db: Db) {
  const sources = await db.query.$sources.findMany();
  if (sources.length === 0) {
    return { overview: null, sources: [] };
  }

  // get article stats for last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const articleStats = await db.query.$articles.findMany({
    where: gte($articles.createdAt, sevenDaysAgo),
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
      orderBy: sql`${$sources.lastChecked} DESC NULLS LAST`,
      columns: { lastChecked: true },
    }),
    // get latest processed article
    db.query.$articles.findFirst({
      where: eq($articles.status, 'PROCESSED'),
      orderBy: sql`${$articles.processedAt} DESC NULLS LAST`,
      columns: { processedAt: true },
    }),
    // get latest fetched article
    db.query.$articles.findFirst({
      orderBy: sql`${$articles.createdAt} DESC NULLS LAST`,
      columns: { createdAt: true },
    }),
    // get today's stats
    db.query.$articles.findMany({
      where: and(gte($articles.createdAt, startOfToday)),
      columns: {
        status: true,
      },
    }),
    // get stale sources count
    db.query.$sources.findMany({
      where: sql`(
        (${$sources.scrape_frequency} = 1 AND ${$sources.lastChecked} < NOW() - INTERVAL '2 hours') OR
        (${$sources.scrape_frequency} = 2 AND ${$sources.lastChecked} < NOW() - INTERVAL '8 hours') OR
        (${$sources.scrape_frequency} = 3 AND ${$sources.lastChecked} < NOW() - INTERVAL '12 hours') OR
        (${$sources.scrape_frequency} = 4 AND ${$sources.lastChecked} < NOW() - INTERVAL '48 hours')
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
}

// to access the enums
type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
type ArticleCompleteness = (typeof articleCompletenessEnum.enumValues)[number];
type ArticleQuality = (typeof articleContentQualityEnum.enumValues)[number];

/** 单个源的文章列表（筛选、排序、分页）。query 参数的解析与原前端 details.get 一致：不认识的值等于不筛选。源不存在回 null */
export async function getSourceDetails(db: Db, sourceId: number, query: Record<string, string | undefined>) {
  // get source details
  const source = await db.query.$sources.findFirst({ where: eq($sources.id, sourceId) });
  if (source === undefined) return null;

  // get query params for filtering and sorting
  const page = Number(query.page) || 1;
  const pageSize = 50;
  const status = query.status as string;
  const completeness = query.completeness as string;
  const quality = query.quality as string;
  const sortBy = query.sortBy || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  // build where clause
  const conditions = [eq($articles.sourceId, sourceId)];

  // only add conditions if they're valid enum values
  if (articleStatusEnum.enumValues.includes(status as ArticleStatus)) {
    conditions.push(eq($articles.status, status as ArticleStatus));
  }
  if (articleCompletenessEnum.enumValues.includes(completeness as ArticleCompleteness)) {
    conditions.push(eq($articles.completeness, completeness as ArticleCompleteness));
  }
  if (articleContentQualityEnum.enumValues.includes(quality as ArticleQuality)) {
    conditions.push(eq($articles.content_quality, quality as ArticleQuality));
  }

  const whereClause = and(...conditions);

  // determine sort field
  const sortField =
    sortBy === 'publishedAt'
      ? $articles.publishDate
      : sortBy === 'processedAt'
        ? $articles.processedAt
        : $articles.createdAt;

  // get articles with filters and sorting
  const articles = await db.query.$articles.findMany({
    where: whereClause,
    orderBy: sortOrder === 'asc' ? sortField : desc(sortField),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    // 只取页面用到的列（不带 content 全文；embedding 只为判 hasEmbedding）
    columns: {
      id: true,
      title: true,
      url: true,
      publishDate: true,
      status: true,
      completeness: true,
      content_quality: true,
      failReason: true,
      language: true,
      primary_location: true,
      processedAt: true,
      embedding: true,
    },
  });

  // get total count with filters
  const totalCount = await db.query.$articles.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return {
    name: source.name,
    url: source.url,
    initialized: source.do_initialized_at !== null,
    pausedAt: source.paused_at?.toISOString() ?? null,
    frequency: formatScrapeFrequency(source.scrape_frequency),
    lastFetched: source.lastChecked?.toISOString(),
    articles: articles.map(article => ({
      id: article.id,
      title: article.title,
      url: article.url,
      publishedAt: article.publishDate?.toISOString(),
      status: article.status,
      completeness: article.completeness,
      content_quality: article.content_quality,
      failReason: article.failReason,
      language: article.language,
      primary_location: article.primary_location,
      processedAt: article.processedAt?.toISOString(),
      hasEmbedding: article.embedding !== null,
    })),
    pagination: {
      totalPages: Math.ceil(totalCount.length / pageSize),
      totalItems: totalCount.length,
    },
  };
}
