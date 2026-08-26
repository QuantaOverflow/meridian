<script setup lang="ts">
// 标记全在 StoryThreadIndex 里：Tailwind 扫不到 src/pages/，见 assets/css/main.css 顶部说明
useSeoMeta({
  title: '事件追踪 | Meridian',
  description: '跨期存续的事件线索，把散落各期简报的报道合成一条时间线',
  ogLocale: 'zh_CN',
});
</script>

<template>
  <StoryThreadIndex />
</template>
