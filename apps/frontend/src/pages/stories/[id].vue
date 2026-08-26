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
    statusMessage: error.value.statusCode === 404 ? '这条线索不存在' : '线索加载失败',
    fatal: true,
  });
}

useSeoMeta({
  title: () => (thread.value ? `${thread.value.title} | 事件追踪` : '事件追踪 | Meridian'),
  description: () => (thread.value ? `持续 ${thread.value.durationDays} 天，覆盖 ${thread.value.briefCount} 期简报` : ''),
  ogLocale: 'zh_CN',
});
</script>

<template>
  <StoryThreadSkeleton v-if="status === 'pending' || thread === null" />
  <StoryThreadDetail v-else :thread="thread" />
</template>
