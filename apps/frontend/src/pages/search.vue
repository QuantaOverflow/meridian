<script setup lang="ts">
import type { SearchResponse } from '~/shared/types';

// 搜索页：搜已发布各期的简报块（标题与正文，英文全文检索）。结果按线索折叠——同一线索的块归成一组，
// 最新那块直接露出，其余各期的收在「展开」里。查询串在地址栏的 ?q= 里，首屏在服务端取，「Show more」在浏览器里接着取。
const route = useRoute();
const PAGE_SIZE = 20;
const MAX_QUERY = 200;

const query = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''));
const tooLong = computed(() => query.value.length > MAX_QUERY);
const input = ref(query.value);
watch(query, q => (input.value = q));

const fetchPage = (offset: number) => $fetch<SearchResponse>('/api/search', { query: { q: query.value, limit: PAGE_SIZE, offset } });

// 空查询与超长查询不去问 backend：前者只出搜索框，后者写明上限。lazy 见 pages/index.vue 的说明
const { data, error, status } = await useAsyncData(
  'search',
  async () => (query.value === '' || tooLong.value ? null : await fetchPage(0)),
  { lazy: true, watch: [query] }
);

function submit() {
  const q = input.value.trim();
  if (q !== query.value) navigateTo({ path: '/search', query: q === '' ? {} : { q } });
}

const groupKey = (g: SearchResponse['items'][number]) => (g.thread ? `t${g.thread.id}` : `b${g.blocks[0]?.id}`);

const loadingMore = ref(false);
const loadFailed = ref(false);

async function showMore() {
  const current = data.value;
  if (!current || loadingMore.value) return;
  loadingMore.value = true;
  loadFailed.value = false;
  try {
    const next = await fetchPage(current.items.length);
    // 两次请求之间出了新的一期时，页与页会错位：按组去重
    const seen = new Set(current.items.map(groupKey));
    data.value = { ...next, items: [...current.items, ...next.items.filter(g => !seen.has(groupKey(g)))] };
  } catch (err) {
    console.error('Failed to load more search results', err);
    loadFailed.value = true;
  } finally {
    loadingMore.value = false;
  }
}

useSeoMeta({
  title: () => (query.value ? `${query.value} · Search | Meridian` : 'Search | Meridian'),
  description: 'Search the stories in every published daily brief.',
  ogLocale: 'en_US',
  robots: 'noindex',
});
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8">
    <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[42px] mb-[18px]">Search</h1>
    <p class="mb-[18px] text-[12.5px] text-ink3"><NuxtLink to="/entities" class="border-rule hover:text-ink border-b transition-colors">Browse names in the news →</NuxtLink></p>

    <form role="search" action="/search" method="get" class="mb-4 flex gap-2" @submit.prevent="submit">
      <input
        v-model="input"
        type="search"
        name="q"
        :maxlength="MAX_QUERY"
        placeholder="e.g. ceasefire, “interest rates”, tariffs -china"
        aria-label="Search stories"
        class="border-rule text-ink placeholder:text-ink3 min-w-0 flex-1 rounded-full border bg-transparent px-4 py-[7px] text-[15px] outline-none focus:border-ink3"
      />
      <button type="submit" class="border-rule text-ink2 hover:text-ink cursor-pointer rounded-full border px-4 py-[7px] text-[13px] transition-colors">
        Search
      </button>
    </form>

    <p v-if="query === ''" class="text-[13px] leading-[1.7] text-ink3">
      Search the stories in every published brief. Words are matched in English by their root (“holding” finds “holds”); put a phrase in quotes
      to match it exactly.
    </p>
    <p v-else-if="tooLong" class="text-[13px] text-ink3" role="status">Search queries can be at most {{ MAX_QUERY }} characters.</p>
    <p v-else-if="error" class="text-[13px] text-ink3" role="status">Search is unavailable right now. Try again in a moment.</p>
    <p v-else-if="status === 'pending' || !data" class="text-[13px] text-ink3" aria-busy="true" aria-live="polite">Searching…</p>

    <template v-else>
      <p v-if="data.total === 0" class="font-serif text-[18px] leading-[1.9] text-ink2">No stories match “{{ data.query }}”.</p>
      <p v-else class="border-rule-soft border-b pb-7 text-[13px] text-ink3">
        {{ pluralize(data.totalBlocks, 'matching story', 'matching stories') }}<template v-if="data.total < data.totalBlocks">
          in {{ pluralize(data.total, 'group') }} (stories from the same thread are grouped)</template>
      </p>

      <article v-for="group in data.items" :key="groupKey(group)" data-search-group class="border-rule-soft border-b py-7">
        <template v-for="(block, i) in group.blocks.slice(0, 1)" :key="block.id">
          <p class="mb-2 text-[12.5px] text-ink3"><time>{{ block.dateLabel }}</time></p>
          <h3 class="font-serif text-[19px] leading-[1.42] font-semibold text-ink md:text-[22px] mb-[9px]">{{ block.title }}</h3>
          <!-- 正文 markdown 由 server 路由渲染（与阅读页同一来源），工具类挂不到段落上，段距见下方 scoped 样式 -->
          <div class="block-body font-serif text-[16px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[18px]" v-html="block.bodyHtml" />
          <p class="mt-[9px] flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink3">
            <NuxtLink :to="block.href" class="border-rule hover:text-ink border-b transition-colors">Brief {{ block.briefNumber }} →</NuxtLink>
            <NuxtLink v-if="group.thread && i === 0" :to="group.thread.href" class="border-rule hover:text-ink border-b transition-colors">
              {{ group.thread.title }} · {{ pluralize(group.thread.briefCount, 'brief') }}
            </NuxtLink>
            <EntityLinks :entities="block.entities" />
          </p>
        </template>

        <details v-if="group.blocks.length > 1" class="mt-4">
          <summary class="text-ink2 hover:text-ink cursor-pointer text-[13px] transition-colors">
            {{ group.blockCount - 1 }} more from this {{ group.thread ? 'thread' : 'story' }}
          </summary>
          <div v-for="block in group.blocks.slice(1)" :key="block.id" class="border-rule-soft mt-4 border-l pl-4">
            <p class="mb-1 text-[12.5px] text-ink3"><time>{{ block.dateLabel }}</time></p>
            <h4 class="font-serif text-[17px] leading-[1.42] font-semibold text-ink mb-[6px]">{{ block.title }}</h4>
            <div class="block-body font-serif text-[15px] leading-[1.8] text-ink2 md:text-[16px]" v-html="block.bodyHtml" />
            <p class="mt-[6px] flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink3">
              <NuxtLink :to="block.href" class="border-rule hover:text-ink border-b transition-colors">Brief {{ block.briefNumber }} →</NuxtLink>
              <EntityLinks :entities="block.entities" />
            </p>
          </div>
          <p v-if="group.blockCount > group.blocks.length" class="mt-4 text-[12.5px] text-ink3">
            Showing the latest {{ group.blocks.length }} of {{ group.blockCount }}.
          </p>
        </details>
      </article>

      <div v-if="data.items.length < data.total" class="pt-6">
        <button
          type="button"
          class="border-rule text-ink2 hover:text-ink cursor-pointer rounded-full border px-4 py-[6px] text-[13px] transition-colors disabled:cursor-default disabled:opacity-60"
          :disabled="loadingMore"
          @click="showMore"
        >
          {{ loadingMore ? 'Loading…' : `Show more (${data.total - data.items.length} left)` }}
        </button>
        <span v-if="loadFailed" class="ml-3 text-[12.5px] text-ink3" role="status">Could not load more. Try again.</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.block-body :deep(p + p) { margin-top: 0.8em; }
</style>
