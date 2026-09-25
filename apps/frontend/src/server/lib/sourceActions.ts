import type { H3Event } from 'h3';
import { $sources, eq } from '@meridian/database';
import { getDB } from '~/server/lib/utils';

/**
 * 后台对单个源的 DO 操作（init / pause / resume）：校验源存在后转给 backend 的 `/do/admin/source/:id/<action>`。
 */
export async function forwardSourceAction(event: H3Event, action: 'init' | 'pause' | 'resume') {
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
    response = await fetch(`${config.public.WORKER_API}/do/admin/source/${sourceId}/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.worker.api_token}`,
      },
    });
  } catch (error) {
    console.error(`Failed to ${action} source DO`, error);
    throw createError({ statusCode: 500, statusMessage: `Failed to ${action} source DO` });
  }
  // backend 回 4xx/5xx 不会抛异常，不看 status 就会对失败回 success
  if (!response.ok) {
    console.error(`Backend failed to ${action} source DO`, { sourceId, status: response.status });
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to ${action} source DO: backend returned ${response.status}`,
    });
  }

  return { success: true };
}
