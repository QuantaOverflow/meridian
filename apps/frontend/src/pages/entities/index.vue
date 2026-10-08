<script setup lang="ts">
// /entities：不带写法是实体列表页，带 ?name=… 是那个实体的页。
// 实体的写法在查询串里（可以带斜杠）：从一个实体页点到另一个时路径不变，按完整地址当 key 才会换页面实例重新取数
definePageMeta({ key: route => route.fullPath });

const route = useRoute();
const raw = Array.isArray(route.query.name) ? route.query.name[0] : route.query.name;
const name = (raw ?? '').trim();
if (name.length > 200) {
  throw createError({ statusCode: 404, statusMessage: 'This page does not exist', fatal: true });
}
</script>

<template>
  <EntityIndex v-if="name === ''" />
  <EntityDetail v-else :name="name" />
</template>
