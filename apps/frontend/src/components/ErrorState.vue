<script setup lang="ts">
defineProps<{ statusCode: number; message: string }>();
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[110px] pb-[140px] md:px-8">
    <p class="mb-4 text-[12.5px] tracking-[0.1em] text-ink3">{{ statusCode }}</p>
    <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[38px] mb-[18px]">
      {{ message }}
    </h1>
    <div class="flex flex-wrap gap-3">
      <NuxtLink
        to="/"
        class="border-rule text-ink2 hover:border-ink hover:text-ink rounded-full border px-6 py-[10px] text-[13.5px] transition-colors"
      >
        回到今日简报
      </NuxtLink>
      <NuxtLink
        to="/briefs"
        class="border-rule text-ink2 hover:border-ink hover:text-ink rounded-full border px-6 py-[10px] text-[13.5px] transition-colors"
      >
        去归档找找
      </NuxtLink>
    </div>
  </div>
</template>
