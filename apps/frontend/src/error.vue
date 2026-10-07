<script setup lang="ts">
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();

const message = computed(() => {
  if (props.error.statusCode === 404) return "This page doesn't exist";
  return props.error.statusMessage || 'Something went wrong';
});

useSeoMeta({ title: () => `${props.error.statusCode} | Meridian`, ogLocale: 'en_US' });
</script>

<template>
  <EnvBanner />
  <NuxtLayout>
    <ErrorState :status-code="error.statusCode" :message="message" />
  </NuxtLayout>
</template>
