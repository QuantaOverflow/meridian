<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <p class="mx-auto max-w-[740px] px-5 pt-[70px] text-[14px] text-ink3 md:px-8">{{ text }}</p>
</template>
