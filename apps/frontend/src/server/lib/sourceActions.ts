import type { H3Event } from 'h3';

/**
 * 后台对源的写操作一律转给 backend（写表与 DO 启停都在 backend 的 lib/sources.ts），这里不碰库。
 * backend 4xx 原样透传状态码与 error 文本（404 源不存在、409 URL 已存在 / 删源被简报引用），5xx 与连不上回 502。
 */
export async function forwardToBackend(path: string, init: { method: string; body?: unknown }, what: string) {
  const config = useRuntimeConfig();

  let response: Response;
  try {
    response = await fetch(`${config.public.WORKER_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.worker.api_token}`,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    console.error(`Failed to ${what}`, error);
    throw createError({ statusCode: 502, statusMessage: `Failed to ${what}: backend unreachable` });
  }
  // backend 回 4xx/5xx 不会抛异常，不看 status 就会对失败回 success
  if (!response.ok) {
    const reason = await response
      .json()
      .then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : undefined))
      .catch(() => undefined);
    console.error(`Backend failed to ${what}`, { path, status: response.status, reason });
    if (response.status >= 400 && response.status < 500) {
      const message = reason ?? `backend returned ${response.status}`;
      throw createError({ statusCode: response.status, statusMessage: message, message });
    }
    throw createError({ statusCode: 502, statusMessage: `Failed to ${what}: backend returned ${response.status}` });
  }

  return { success: true };
}

function sourceIdOf(event: H3Event) {
  const sourceId = Number(getRouterParam(event, 'id'));
  if (isNaN(sourceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid source ID' });
  }
  return sourceId;
}

/** 后台对单个源的 DO 操作（init / pause / resume）：转给 backend 的 `/do/admin/source/:id/<action>` */
export async function forwardSourceAction(event: H3Event, action: 'init' | 'pause' | 'resume') {
  await requireUserSession(event); // require auth
  const sourceId = sourceIdOf(event);
  return forwardToBackend(`/do/admin/source/${sourceId}/${action}`, { method: 'POST' }, `${action} source DO`);
}

/** 删除源（连同文章与 DO）：转给 backend 的 `DELETE /do/admin/source/:id` */
export async function forwardSourceDelete(event: H3Event) {
  await requireUserSession(event); // require auth
  const sourceId = sourceIdOf(event);
  return forwardToBackend(`/do/admin/source/${sourceId}`, { method: 'DELETE' }, 'delete source');
}
