import { readFromBackend, type AdminSourceDetails } from '~/server/lib/backend';

export default defineEventHandler(async (event): Promise<AdminSourceDetails> => {
  await requireUserSession(event); // require auth

  const sourceId = Number(getRouterParam(event, 'id'));
  if (isNaN(sourceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' });
  }

  // 筛选（status / completeness / quality）、排序（sortBy / sortOrder）、分页（page）的查询串原样转给 backend，
  // 解析在 backend 的 lib/reader/source-stats.ts：只认枚举内的值，其余等于不筛选
  return await readFromBackend<AdminSourceDetails>(
    `/admin/sources/${sourceId}/details${getRequestURL(event).search}`,
    'Source not found'
  );
});
