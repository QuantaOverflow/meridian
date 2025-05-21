import { $articles, $sources, eq, and, desc, articleStatusEnum } from '@meridian/database';
import { getDB } from '~/server/lib/utils';

// to access the enums
type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];

export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const sourceId = Number(getRouterParam(event, 'id'));
  if (Number.isNaN(sourceId)) {
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
  const sortBy = (query.sortBy as string) || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  // build where clause
  const conditions = [eq($articles.sourceId, sourceId)];

  // only add conditions if they're valid enum values
  if (articleStatusEnum.enumValues.includes(status as ArticleStatus)) {
    conditions.push(eq($articles.status, status as ArticleStatus));
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
  });

  // get total count with filters
  const totalCount = await db.query.$articles.findMany({
    where: whereClause,
    columns: { id: true },
  });

  return {
    id: source.id,
    name: source.name,
    url: source.url,
    initialized: source.do_initialized_at !== null,
    frequency:
      source.scrape_frequency === 1
        ? 'Hourly'
        : source.scrape_frequency === 2
          ? '4 Hours'
          : source.scrape_frequency === 3
            ? '6 Hours'
            : 'Daily',
    lastFetched: source.lastChecked?.toISOString(),
    articles: articles.map(article => ({
      id: article.id,
      title: article.title,
      url: article.url,
      publishedAt: article.publishDate?.toISOString(),
      status: article.status,
      failReason: article.failReason,
      processedAt: article.processedAt?.toISOString(),
      createdAt: article.createdAt?.toISOString(),
      hasEmbedding: article.embedding !== null,
    })),
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalCount.length / pageSize),
      totalItems: totalCount.length,
    },
  };
});
