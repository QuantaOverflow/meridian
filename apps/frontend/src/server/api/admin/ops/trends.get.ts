import type { OpsTrends } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';

// 运维台 trends：backend 算好，这里原样转发（未登录由 server/middleware/admin-auth.ts 挡）
export default defineEventHandler(async (event): Promise<OpsTrends> => {
  return await readFromBackend<OpsTrends>(`/observability/ops/trends${getRequestURL(event).search}`);
});
