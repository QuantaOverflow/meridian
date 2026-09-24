<script setup lang="ts">
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();

const message = computed(() => {
  if (props.error.statusCode === 404) return '这个页面不存在';
  return props.error.statusMessage || '出了点问题';
});

useSeoMeta({ title: () => `${props.error.statusCode} | Meridian`, ogLocale: 'zh_CN' });
</script>

<template>
  <NuxtLayout>
    <ErrorState :status-code="error.statusCode" :message="message" />
  </NuxtLayout>
</template>
