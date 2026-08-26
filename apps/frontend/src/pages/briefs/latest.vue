<script setup lang="ts">
import type { BriefDetail } from '~/shared/types';

// 兼容旧的 /briefs/latest 链接：拿到最新一期后跳到它的规范地址
const { data: brief, error } = await useFetch<BriefDetail>('/api/briefs/latest');
if (error.value) {
  throw createError({ statusCode: 500, statusMessage: '简报加载失败', fatal: true });
}
if (brief.value !== null) {
  await navigateTo(`/briefs/${brief.value.slug}`, { redirectCode: 301 });
}

useSeoMeta({ title: '最新一期 | Meridian', ogLocale: 'zh_CN' });
</script>

<template>
  <PageNotice text="正在跳转到最新一期…" />
</template>
