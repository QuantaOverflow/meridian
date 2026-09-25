import { readFromBackend, type AdminSourcesResponse } from '~/server/lib/backend';

// 源总览（每个源近 7 天的健康度、全局今日计数与过期源数）由 backend 的 GET /admin/sources 算好，这里原样返回
export default defineEventHandler(async (event): Promise<AdminSourcesResponse> => {
  await requireUserSession(event); // require auth

  return await readFromBackend<AdminSourcesResponse>('/admin/sources');
});
