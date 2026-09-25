import { getStoryThread } from '~/server/lib/storyThreads';
import type { StoryThreadDetail } from '~/shared/types';

export default defineEventHandler(async (event): Promise<StoryThreadDetail> => {
  const id = Number(getRouterParam(event, 'id'));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid story id' });
  }

  return await getStoryThread(id);
});
