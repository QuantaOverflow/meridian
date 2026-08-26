import { listStoryThreads } from '~/server/lib/storyThreads';
import type { StoryThreadListResponse } from '~/shared/types';

export default defineEventHandler(async (event): Promise<StoryThreadListResponse> => {
  return await listStoryThreads(event);
});
