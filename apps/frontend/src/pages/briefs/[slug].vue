<script lang="ts" setup>
import type { BriefDetail } from '~/shared/types';

const route = useRoute();
const slug = computed(() => String(route.params.slug ?? ''));

// lazy 见 pages/index.vue 的说明
const { data: brief, error, status } = await useFetch<BriefDetail>(() => `/api/briefs/${slug.value}`, {
  lazy: true,
});

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusCode === 404 ? 'This issue does not exist' : 'Failed to load brief',
    fatal: true,
  });
}

useBriefSeo(brief);
</script>

<template>
  <BriefSkeleton v-if="status === 'pending' || brief === null" />
  <BriefArticle v-else :brief="brief" />
</template>
