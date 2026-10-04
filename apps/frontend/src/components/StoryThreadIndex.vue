<script setup lang="ts">
import type { StoryThreadListResponse, StoryThreadStatus } from '~/shared/types';

type Filter = StoryThreadStatus | 'all';

// lazy 见 pages/index.vue 的说明
const { data, error, status } = await useFetch<StoryThreadListResponse>('/api/stories', { lazy: true });
if (error.value) {
  throw createError({ statusCode: 500, statusMessage: 'Failed to load story threads', fatal: true });
}

const filter = ref<Filter>('active');

// ⚠️「Dormant」不是「已平息」：系统只知道最近没有新报道并入这条线索，
// 不知道现实中的冲突是否平息。用「resolved」这类说法是替世界下判断，会误导读者。别改回去。
const tabs = computed(() => [
  { key: 'active' as const, label: 'Active', count: data.value?.counts.active ?? 0 },
  { key: 'dormant' as const, label: 'Dormant', count: data.value?.counts.dormant ?? 0 },
  { key: 'all' as const, label: 'All', count: data.value?.counts.all ?? 0 },
]);

const threads = computed(() => {
  const all = data.value?.threads ?? [];
  return filter.value === 'all' ? all : all.filter(t => t.status === filter.value);
});
</script>

<template>
  <div class="mx-auto max-w-[740px] px-5 pt-[70px] pb-[140px] md:px-8">
    <h1 class="font-serif text-[30px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[38px] mb-3">
      Story threads
    </h1>

    <p class="font-serif text-[17px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[19px] mb-9">
      The same story often spans many issues. This combines scattered coverage into one thread, so you don't have to start from zero every day.
    </p>

    <div class="border-rule-soft flex gap-6 border-b text-[14px]">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :aria-pressed="filter === tab.key"
        :class="filter === tab.key ? 'text-ink shadow-[inset_0_-1px_0_var(--text)]' : 'text-ink3 hover:text-ink'"
        class="cursor-pointer py-[14px] transition-colors"
        @click="filter = tab.key"
      >
        {{ tab.label }} {{ tab.count }}
      </button>
    </div>

    <!-- 两个阈值都要对读者可见：数字来自接口，改配置时这行会跟着变 -->
    <p class="mt-3 text-[12px] text-ink3">
      A thread needs to appear in at least {{ pluralize(data?.minBriefs ?? 2, 'issue') }} · active means new progress
      within {{ pluralize(data?.activeWindowDays ?? 7, 'day') }}
    </p>

    <div v-if="status === 'pending' && threads.length === 0" class="pt-7" aria-busy="true">
      <div v-for="n in 4" :key="n" class="border-rule-soft border-b py-[26px]">
        <div class="bg-rule-soft mb-[9px] h-[24px] w-2/3 animate-pulse" />
        <div class="bg-rule-soft mb-3 h-[16px] w-full animate-pulse" />
        <div class="bg-rule-soft h-[12px] w-[200px] animate-pulse" />
      </div>
    </div>

    <p v-else-if="threads.length === 0" class="pt-[46px] text-[15px] leading-[1.8] text-ink2">
      <template v-if="filter === 'active'">
        No active story threads right now — none have had new progress in the last
        {{ pluralize(data?.activeWindowDays ?? 7, 'day') }}.
      </template>
      <template v-else>No story threads yet.</template>
    </p>

    <ul v-else>
      <li v-for="thread in threads" :key="thread.id" class="border-rule-soft border-b">
        <NuxtLink :to="`/stories/${thread.id}`" class="group block py-[26px]">
          <div class="mb-[9px] flex items-baseline gap-[10px]">
            <h3 class="font-serif text-[21px] leading-[1.42] font-semibold text-ink group-hover:text-accent md:text-[24px] transition-colors">
              {{ thread.title }}
            </h3>
            <!-- 不满足升级判据时什么都不显示，不要「平稳」这类填充词 -->
            <span v-if="thread.escalating" class="text-accent shrink-0 text-[12.5px]">Escalating</span>
          </div>

          <p v-if="thread.summary" class="mb-3 text-[15.5px] leading-[1.78] text-ink2">{{ thread.summary }}</p>

          <p class="text-[12.5px] text-ink3">
            {{ pluralize(thread.durationDays, 'day') }} running · {{ pluralize(thread.briefCount, 'issue') }} ·
            {{ thread.updateLabel }}
          </p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
