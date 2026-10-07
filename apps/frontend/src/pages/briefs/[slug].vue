<script lang="ts" setup>
import type { BriefDetail, BriefEntityLinks } from '~/shared/types';

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

// 块下的实体链接是正文之外的导航，单独取：取不到时正文照常，只是没有链接（失败在 server 路由里记日志）
const { data: entityLinks } = await useFetch<BriefEntityLinks>(() => `/api/briefs/${slug.value}/entities`, { lazy: true });

useBriefSeo(brief);
</script>

<template>
  <BriefSkeleton v-if="status === 'pending' || brief === null" />
  <BriefArticle v-else :brief="brief" :entity-links="entityLinks ?? undefined" />
</template>
