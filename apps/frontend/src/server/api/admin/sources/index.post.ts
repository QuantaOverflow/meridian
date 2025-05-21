import { getDB } from '~/server/lib/utils';
import { z } from 'zod';
import { $sources } from '@meridian/database';

const schema = z.object({
  url: z.string().url(),
});

export default defineEventHandler(async event => {
  await requireUserSession(event); // require auth

  const bodyResult = schema.safeParse(await readBody(event));
  if (bodyResult.success === false) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request body' });
  }

  try {
    await getDB(event).insert($sources).values({
      url: bodyResult.data.url,
      category: 'unknown',
      name: 'Unknown',
      scrape_frequency: 1,
    });
  } catch (error) {
    console.error('Failed to add source', error);
    throw createError({ statusCode: 500, statusMessage: 'Failed to add source' });
  }

  // const config = useRuntimeConfig();

  // try {
  //   await fetch(`${config.public.WORKER_API}/do/admin/initialize-dos`, {
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${config.worker.api_token}`,
  //     },
  //   });
  // } catch (error) {
  //   throw createError({ statusCode: 500, statusMessage: 'Failed to initialize DOs' });
  // }

  return {
    success: true,
  };
});
