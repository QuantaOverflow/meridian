<script setup lang="ts">
// 标记全在 BriefArchive 里：Tailwind 扫不到 src/pages/，页面文件写 class 不会生成样式。
// 见 assets/css/main.css 顶部说明。
useSeoMeta({
  title: '归档 | Meridian',
  description: '检索历史每日情报简报',
  ogLocale: 'zh_CN',
});
</script>

<template>
  <BriefArchive />
</template>
