<script setup lang="ts">
import { MagnifyingGlassIcon } from '@heroicons/vue/24/outline';
import type { BriefListResponse, BriefSummary } from '~/shared/types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const route = useRoute();
const router = useRouter();

const searchInput = ref(String(route.query.q ?? ''));
/** searchInput 的防抖版本，只有它变了才真正发请求 */
const query = ref(searchInput.value);

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, value => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    query.value = value.trim();
    // 检索词进 URL，前进/后退和分享链接都能还原结果
    router.replace({ query: query.value === '' ? {} : { q: query.value } });
  }, SEARCH_DEBOUNCE_MS);
});
onUnmounted(() => clearTimeout(debounceTimer));

const { data, status, error } = await useAsyncData<BriefListResponse>(
  'briefs-archive',
  () =>
    $fetch('/api/briefs', {
      query: { q: query.value === '' ? undefined : query.value, limit: PAGE_SIZE },
    }),
  // lazy 见 pages/index.vue 的说明
  { watch: [query], lazy: true }
);

if (error.value) {
  throw createError({ statusCode: 500, statusMessage: '归档加载失败', fatal: true });
}

// 「加载更多」要在首页结果后面追加，所以列表单独存一份
const items = ref<BriefSummary[]>([]);
watch(data, value => (items.value = value?.items ?? []), { immediate: true });

const loadingMore = ref(false);
const hasMore = computed(() => (data.value === null ? false : items.value.length < data.value.matched));

async function loadMore() {
  if (loadingMore.value) return;
  loadingMore.value = true;
  try {
    const next = await $fetch<BriefListResponse>('/api/briefs', {
      query: { q: query.value === '' ? undefined : query.value, limit: PAGE_SIZE, offset: items.value.length },
    });
    items.value.push(...next.items);
  } finally {
    loadingMore.value = false;
  }
}

const subtitle = computed(() => {
  if (data.value === null) return '';
  const coverage = data.value.earliestDateCN === null ? '' : ` · 覆盖 ${data.value.earliestDateCN}至今`;
  return `${data.value.total} 期${coverage}`;
});
</script>

<template>
  <div class="mx-auto max-w-[740px] px-5 pt-[70px] pb-[140px] md:px-8">
    <h1 class="font-serif text-[30px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[38px] mb-2">
      归档
    </h1>
    <p class="mb-[34px] text-[14px] text-ink3">{{ subtitle }}</p>

    <div class="border-rule flex items-center gap-[9px] rounded-full border px-[17px] py-[10px]">
      <MagnifyingGlassIcon class="h-[15px] w-[15px] shrink-0 text-ink3" :stroke-width="1.6" />
      <input
        v-model="searchInput"
        type="search"
        placeholder="搜索事件、人物、地区…"
        aria-label="搜索简报"
        class="text-ink placeholder:text-ink3 w-full bg-transparent text-[13.5px] focus:outline-none"
      />
    </div>

    <div class="border-rule-soft mt-[6px] border-b" :class="query === '' ? '' : 'py-[14px]'">
      <p v-if="query !== '' && data" class="text-[13px] text-ink3">
        {{ data.matched }} 期匹配「{{ query }}」
      </p>
    </div>

    <div v-if="status === 'pending' && items.length === 0" class="pt-7">
      <div v-for="n in 4" :key="n" class="border-rule-soft border-b py-7">
        <div class="bg-rule-soft mb-[9px] h-[12px] w-[180px] animate-pulse" />
        <div class="bg-rule-soft mb-[9px] h-[22px] w-3/4 animate-pulse" />
        <div class="bg-rule-soft h-[15px] w-full animate-pulse" />
      </div>
    </div>

    <p v-else-if="items.length === 0" class="pt-[46px] text-[15px] leading-[1.8] text-ink2">
      没有匹配「{{ query }}」的简报。换个说法，或者
      <button type="button" class="border-rule border-b cursor-pointer text-ink" @click="searchInput = ''">
        清空检索
      </button>
      看看全部。
    </p>

    <ul v-else>
      <li v-for="brief in items" :key="brief.id" class="border-rule-soft border-b">
        <NuxtLink :to="`/briefs/${brief.slug}`" class="group block py-7">
          <p class="mb-[9px] text-[12.5px] text-ink3">
            {{ brief.dateShortCN }} · 第 {{ brief.id }} 期 · {{ brief.storyCount }} 条 ·
            {{ brief.readingMinutes }} 分钟
          </p>

          <h3
            class="font-serif text-[20px] leading-[1.42] font-semibold text-ink group-hover:text-accent md:text-[23px] mb-[9px] transition-colors"
          >
            {{ brief.title }}
          </h3>

          <p v-if="brief.excerpt" class="mb-[14px] text-[15px] leading-[1.75] text-ink2">{{ brief.excerpt }}</p>

          <div class="flex flex-wrap gap-2">
            <span
              v-for="topic in brief.topics"
              :key="topic"
              class="border-rule rounded-full border px-3 py-1 text-[12.5px] text-ink2"
            >
              {{ topic }}
            </span>
          </div>
        </NuxtLink>
      </li>
    </ul>

    <div v-if="hasMore" class="pt-9">
      <button
        type="button"
        class="border-rule text-ink2 hover:border-ink hover:text-ink cursor-pointer rounded-full border px-6 py-[10px] text-[13.5px] transition-colors"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </div>
</template>
