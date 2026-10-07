<script setup lang="ts">
import type { EntityIndexResponse } from '~/shared/types';

// 实体列表页（/entities）：全部有实体页的人物、机构、地名，出现得多的在前。门槛在 backend。
// lazy 见 pages/index.vue 的说明
const { data, error, status } = await useFetch<EntityIndexResponse>('/api/entities', { lazy: true });
if (error.value) {
  throw createError({ statusCode: 500, statusMessage: 'Failed to load the page', fatal: true });
}

useSeoMeta({
  title: 'Names in the news | Meridian',
  description: 'People, organizations and places that keep coming up in the daily briefs.',
  ogLocale: 'en_US',
});
</script>

<template>
  <div class="mx-auto max-w-[740px] px-5 pt-[70px] pb-[140px] md:px-8">
    <h1 class="font-serif text-[30px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[38px] mb-3">Names in the news</h1>
    <p class="border-rule-soft border-b pb-7 text-[13px] text-ink3">
      People, organizations and places that keep coming up in the briefs · matched by exact name, so different spellings are listed separately ·
      countries have their own pages on the map
    </p>

    <p v-if="status === 'pending' || !data" class="pt-7 text-[13px] text-ink3" aria-busy="true" aria-live="polite">Loading…</p>
    <p v-else-if="data.items.length === 0" class="pt-[46px] text-[15px] leading-[1.8] text-ink2">No names have come up often enough yet.</p>

    <ul v-else>
      <li v-for="entity in data.items" :key="entity.href" data-test="entity-row" class="border-rule-soft border-b">
        <NuxtLink :to="entity.href" class="group flex items-baseline justify-between gap-4 py-[14px]">
          <span class="font-serif text-[18px] leading-[1.42] font-semibold text-ink group-hover:text-accent md:text-[20px] transition-colors">{{ entity.name }}</span>
          <span class="shrink-0 text-[12.5px] text-ink3">{{ pluralize(entity.blocks, 'story', 'stories') }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
