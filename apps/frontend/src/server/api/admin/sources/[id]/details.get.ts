import {
  $articles,
  $sources,
  eq,
  and,
  desc,
  articleCompletenessEnum,
  articleStatusEnum,
  articleContentQualityEnum,
} from '@meridian/database';
import { formatScrapeFrequency, getDB } from '~/server/lib/utils';

// to access the enums
type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
type ArticleCompleteness = (typeof articleCompletenessEnum.enumValues)[number];
type ArticleQuality = (typeof articleContentQualityEnum.enumValues)[number];

export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const sourceId = Number(getRouterParam(event, 'id'));
  if (isNaN(sourceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' });
  }

  // get source details
  const db = getDB(event);
  const source = await db.query.$sources.findFirst({ where: eq($sources.id, sourceId) });
  if (source === undefined) {
    throw createError({ statusCode: 404, statusMessage: 'Source not found' });
  }

  // get query params for filtering and sorting
  const query = getQuery(event);
  const page = Number(query.page) || 1;
  const pageSize = 50;
  const status = query.status as string;
  const completeness = query.completeness as string;
  const quality = query.quality as string;
  const sortBy = (query.sortBy as string) || 'createdAt';
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
      currentPage: page,
      totalPages: Math.ceil(totalCount.length / pageSize),
      totalItems: totalCount.length,
    },
  };
});
