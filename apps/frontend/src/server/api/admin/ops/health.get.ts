import type { OpsHealth } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';

// 运维台 health：backend 算好，这里原样转发（未登录由 server/middleware/admin-auth.ts 挡）
export default defineEventHandler(async (event): Promise<OpsHealth> => {
  return await readFromBackend<OpsHealth>(`/observability/ops/health`);
});
