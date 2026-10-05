import type { OpsCost } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';

// 运维台 cost：backend 算好，这里原样转发（未登录由 server/middleware/admin-auth.ts 挡）
export default defineEventHandler(async (event): Promise<OpsCost> => {
  return await readFromBackend<OpsCost>(`/observability/ops/cost${getRequestURL(event).search}`);
});
