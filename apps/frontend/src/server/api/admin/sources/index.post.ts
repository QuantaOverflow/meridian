import { z } from 'zod';
import { forwardToBackend } from '~/server/lib/sourceActions';

const schema = z.object({
  url: z.string().url(),
});

// 建源转给 backend：默认值（name / category / 抓取档位）与拉起 DO 都在 backend，URL 已存在回 409
export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const bodyResult = schema.safeParse(await readBody(event));
  if (bodyResult.success === false) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request body' });
  }

  return forwardToBackend('/admin/sources', { method: 'POST', body: { url: bodyResult.data.url } }, 'add source');
});
