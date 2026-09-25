import { loadBriefDetail } from '~/server/lib/briefDetail';
import type { BriefDetail } from '~/shared/types';

/**
 * 最新一期的**完整**内容，不只是它的期号。
 *
 * 首页原本要先问这里拿期号、再去 /api/briefs/:id 取正文，两趟串行往返；
 * Neon 在新加坡，一趟就几百毫秒，白白让首页慢一倍。
 */
export default defineEventHandler(async (): Promise<BriefDetail> => {
  return await loadBriefDetail({ kind: 'latest' }, 'No reports found');
});
