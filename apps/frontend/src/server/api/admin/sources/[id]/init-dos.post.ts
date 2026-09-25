import { getDB } from '~/server/lib/utils';
import { $sources, eq } from '@meridian/database';

export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const sourceId = Number(getRouterParam(event, 'id'));
  if (isNaN(sourceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' });
  }

  const db = getDB(event);
  const config = useRuntimeConfig();

  const source = await db.query.$sources.findFirst({ where: eq($sources.id, sourceId) });
  if (source === undefined) {
    throw createError({ statusCode: 404, statusMessage: 'Source not found' });
  }

  let response: Response;
  try {
    response = await fetch(`${config.public.WORKER_API}/do/admin/source/${sourceId}/init`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.worker.api_token}`,
      },
    });
  } catch (error) {
    console.error('Failed to initialize DO', error);
    throw createError({ statusCode: 500, statusMessage: 'Failed to initialize DO' });
  }
  // backend 回 4xx/5xx 不会抛异常，不看 status 就会对失败回 success（删源的 index.delete.ts 一直是这么检查的）
  if (!response.ok) {
    console.error('Backend failed to initialize DO', { sourceId, status: response.status });
    throw createError({ statusCode: 502, statusMessage: `Failed to initialize DO: backend returned ${response.status}` });
  }

  return { success: true };
});
