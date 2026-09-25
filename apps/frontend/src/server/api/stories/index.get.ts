import { listStoryThreads } from '~/server/lib/storyThreads';
import type { StoryThreadListResponse } from '~/shared/types';

export default defineEventHandler(async (): Promise<StoryThreadListResponse> => {
  return await listStoryThreads();
});
