<script setup lang="ts">
import type { StoryThreadDetail } from '~/shared/types';

const route = useRoute();
// lazy 见 pages/index.vue 的说明
const { data: thread, error, status } = await useFetch<StoryThreadDetail>(
  () => `/api/stories/${route.params.id}`,
  { lazy: true }
);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusCode === 404 ? 'This story thread does not exist' : 'Failed to load story thread',
    fatal: true,
  });
}

useSeoMeta({
  title: () => (thread.value ? `${thread.value.title} | Story threads` : 'Story threads | Meridian'),
  description: () =>
    thread.value
      ? `Running ${pluralize(thread.value.durationDays, 'day')}, across ${pluralize(thread.value.briefCount, 'issue')}`
      : '',
  ogLocale: 'en_US',
});
</script>

<template>
  <StoryThreadSkeleton v-if="status === 'pending' || thread === null" />
  <StoryThreadDetail v-else :thread="thread" />
</template>
