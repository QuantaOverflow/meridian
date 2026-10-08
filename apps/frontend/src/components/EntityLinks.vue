<script setup lang="ts">
import type { BlockItem } from '~/shared/types';

// 一块下面的实体链接（国家页、搜索页、Following 页、实体页列块时共用）：只有有实体页的实体，由 server 路由算好
defineProps<{ entities: BlockItem['entities'] }>();
</script>

<template>
  <span v-for="entity in entities" :key="entity.href" data-test="entity">
    <NuxtLink :to="entity.href" class="border-rule hover:text-ink border-b transition-colors">{{ entity.name }}</NuxtLink>
  </span>
</template>
