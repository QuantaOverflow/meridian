<script setup lang="ts">
import type { BriefDetail } from '~/shared/types';

// 首页就是最新一期。一次请求拿全，不再「先问期号再取正文」。
// lazy: 不阻塞路由切换。默认行为是等数据回来才换页，旧页面原地不动、
// 骨架屏永远等不到显示的时机，点击后 1-2 秒毫无反馈。
const { data: brief, error, status } = await useFetch<BriefDetail>('/api/briefs/latest', { lazy: true });

if (error.value) {
  throw createError({ statusCode: 500, statusMessage: '简报加载失败', fatal: true });
}

useBriefSeo(brief);
</script>

<template>
  <BriefSkeleton v-if="status === 'pending' || brief === null" />
  <BriefArticle v-else :brief="brief" />
</template>
