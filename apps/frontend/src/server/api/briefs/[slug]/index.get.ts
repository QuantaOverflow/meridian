import { briefIdFromSlug } from '~/server/lib/briefSlug';
import { loadBriefDetail } from '~/server/lib/briefDetail';
import type { BriefDetail } from '~/shared/types';

export default defineEventHandler(async (event): Promise<BriefDetail> => {
  return await loadBriefDetail({ kind: 'id', id: briefIdFromSlug(event) }, 'Report not found');
});
