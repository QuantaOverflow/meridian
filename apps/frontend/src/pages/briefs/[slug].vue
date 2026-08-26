<script lang="ts" setup>
import type { BriefDetail } from '~/shared/types';

const route = useRoute();
const slug = computed(() => String(route.params.slug ?? '').replaceAll('_', '/'));

// lazy 见 pages/index.vue 的说明
const { data: brief, error, status } = await useFetch<BriefDetail>(() => `/api/briefs/${slug.value}`, {
  lazy: true,
});

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusCode === 404 ? '这一期简报不存在' : '简报加载失败',
    fatal: true,
  });
}

useBriefSeo(brief);
</script>

<template>
  <BriefSkeleton v-if="status === 'pending' || brief === null" />
  <BriefArticle v-else :brief="brief" />
</template>
