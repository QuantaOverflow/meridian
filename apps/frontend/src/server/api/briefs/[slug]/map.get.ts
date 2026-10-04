import type { BriefMap } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';
import { briefIdFromSlug } from '~/server/lib/briefSlug';

/** 地图首页的数据，原样转发 backend。落点阈值、国家名与主题名这些展示规则在页面里，不在这里 */
export default defineEventHandler(async (event): Promise<BriefMap> => {
  return await readFromBackend<BriefMap>(`/reader/briefs/${briefIdFromSlug(event)}/map`, 'Report not found');
});
