import { readFromBackend } from '~/server/lib/backend';

// 单条模型调用的完整记录（请求与回复原文）。key 必须在 llm-calls/ 下，由 backend 校验
export default defineEventHandler(async (event): Promise<unknown> => {
  const key = (getRouterParam(event, 'key') ?? '').split('/').map(encodeURIComponent).join('/');
  return await readFromBackend<unknown>(`/observability/llm-calls/${key}`, 'Call not found');
});
