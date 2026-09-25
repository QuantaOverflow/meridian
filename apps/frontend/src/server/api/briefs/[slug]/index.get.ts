import { loadBriefDetail } from '~/server/lib/briefDetail';
import type { BriefDetail } from '~/shared/types';

export default defineEventHandler(async (event): Promise<BriefDetail> => {
  const slug = getRouterParam(event, 'slug');
  if (slug === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' });
  }

  // slug 只认期号（如 `72`）：库里同一天常有多期，按日期定位会歧义。
  if (!/^\d+$/.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid slug' });
  }

  const brief = await loadBriefDetail(event, { kind: 'id', id: Number(slug) });
  if (brief === null) {
    throw createError({ statusCode: 404, statusMessage: 'Report not found' });
  }

  return brief;
});
