import type { OpsRunDetail } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';

// 运维台一次运行的详情：backend 算好，这里原样转发
export default defineEventHandler(async (event): Promise<OpsRunDetail> => {
  const workflowId = encodeURIComponent(getRouterParam(event, 'workflowId') ?? '');
  return await readFromBackend<OpsRunDetail>(`/observability/ops/runs/${workflowId}`, 'Run not found');
});
