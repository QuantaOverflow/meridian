import type { BriefMap } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';

/** 地图首页的数据，原样转发 backend。落点阈值、国家名与主题名这些展示规则在页面里，不在这里 */
export default defineEventHandler(async (event): Promise<BriefMap> => {
  const slug = getRouterParam(event, 'slug');
  if (slug === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' });
  }

  // 与 [slug]/index.get.ts 同口径：slug 只认期号
  if (!/^\d+$/.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid slug' });
  }

  return await readFromBackend<BriefMap>(`/reader/briefs/${slug}/map`, 'Report not found');
});
