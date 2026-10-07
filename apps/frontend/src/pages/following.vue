<script setup lang="ts">
import { COUNTRIES, countryName } from '~/lib/briefMap';
import { browserStorage, followKey, isNewSince, readLastVisit, writeLastVisit } from '~/lib/follows';
import { entityHref } from '~/lib/entities';
import type { FollowingResponse } from '~/shared/types';

// Following 页：命中关注项（国家、线索、实体）的简报块，最新的在前；上次打开本页之后新出的标 new。
// 关注项与上次访问的时刻只在浏览器里（localStorage），所以数据在浏览器里取，服务端只渲染外壳。
const PAGE_SIZE = 20;
const { follows, ready, toggle } = useFollows();

const data = ref<FollowingResponse | null>(null);
const failed = ref(false);
/** 进页面那一刻读到的上次访问时刻；本页打开期间不变，new 标记不会因为刷新列表而消失 */
const previousVisit = ref<string | null>(null);

const countries = computed(() => follows.value.flatMap(f => (f.kind === 'country' ? [f.code] : [])));
const threads = computed(() => follows.value.flatMap(f => (f.kind === 'thread' ? [f.id] : [])));
const entities = computed(() => follows.value.flatMap(f => (f.kind === 'entity' ? [f.key] : [])));

const fetchPage = (offset: number) =>
  $fetch<FollowingResponse>('/api/following', {
    // entities 是数组：一个实体一个参数（写法里可以有逗号）
    query: { countries: countries.value.join(','), threads: threads.value.join(','), entities: entities.value, limit: PAGE_SIZE, offset },
  });

/** 最新一次请求的序号：连着取消几个关注项时，只认最后一次的结果 */
let latest = 0;
async function load() {
  const request = ++latest;
  failed.value = false;
  if (follows.value.length === 0) {
    data.value = null;
    return;
  }
  try {
    const page = await fetchPage(0);
    if (request !== latest) return;
    data.value = page;
  } catch (err) {
    if (request !== latest) return;
    console.error('Failed to load the Following page', err);
    failed.value = true;
  }
}

onMounted(() => {
  const storage = browserStorage();
  previousVisit.value = readLastVisit(storage);
  // 打开即算一次访问：下次来，这之后出的期才标 new
  writeLastVisit(storage, new Date().toISOString());
});
// ready 之后才知道关注了什么；之后每次增减关注项都重新取
watch([ready, follows], () => ready.value && load(), { immediate: true });

const loadingMore = ref(false);
const loadFailed = ref(false);

async function showMore() {
  const current = data.value;
  if (!current || loadingMore.value) return;
  loadingMore.value = true;
  loadFailed.value = false;
  try {
    const next = await fetchPage(current.items.length);
    // 两次请求之间出了新的一期时，页与页会错位：按块 id 去重
    const seen = new Set(current.items.map(b => b.id));
    data.value = { ...next, items: [...current.items, ...next.items.filter(b => !seen.has(b.id))] };
  } catch (err) {
    console.error('Failed to load more blocks', err);
    loadFailed.value = true;
  } finally {
    loadingMore.value = false;
  }
}

/** 关注项在页面上的名字与链接；线索的标题以后端带回的最新标题为准，取不到时用关注那一刻记下的 */
const followed = computed(() =>
  follows.value.map(follow => {
    if (follow.kind === 'country') {
      // 国家页只认展示表里有的代码
      return { follow, label: countryName(follow.code), href: follow.code in COUNTRIES ? `/countries/${follow.code}` : null };
    }
    if (follow.kind === 'entity') return { follow, label: follow.name, href: entityHref(follow.key) };
    const title = data.value?.threads.find(t => t.id === follow.id)?.title ?? follow.title;
    return { follow, label: title || `Story thread ${follow.id}`, href: `/stories/${follow.id}` };
  })
);

const isNew = (block: FollowingResponse['items'][number]) => isNewSince(block.briefCreatedAt, previousVisit.value);
const newCount = computed(() => data.value?.items.filter(isNew).length ?? 0);

useSeoMeta({
  title: 'Following | Meridian',
  description: 'New stories about the countries, story threads, people and organizations you follow.',
  ogLocale: 'en_US',
  robots: 'noindex',
});
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8">
    <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[42px] mb-[18px]">Following</h1>

    <p v-if="!ready" class="text-[13px] text-ink3" aria-busy="true" aria-live="polite">Loading…</p>

    <div v-else-if="follows.length === 0" data-test="empty">
      <p class="font-serif text-[18px] leading-[1.9] text-ink2 mb-4">You are not following anything yet.</p>
      <p class="text-[13px] leading-[1.7] text-ink3">
        Follow a country from its page (pick one on
        <NuxtLink to="/" class="border-rule hover:text-ink border-b transition-colors">today’s map</NuxtLink>) or a
        <NuxtLink to="/stories" class="border-rule hover:text-ink border-b transition-colors">story thread</NuxtLink>, or a person or
        organization from the links under a story, and new stories about it will be listed here. What you follow is saved in this browser only.
      </p>
    </div>

    <template v-else>
      <ul class="mb-4 flex flex-wrap gap-2" aria-label="What you follow">
        <li
          v-for="item in followed"
          :key="followKey(item.follow)"
          data-test="follow"
          class="border-rule flex items-center gap-1 rounded-full border py-[3px] pr-1 pl-3 text-[13px] text-ink2"
        >
          <NuxtLink v-if="item.href" :to="item.href" class="hover:text-ink transition-colors">{{ item.label }}</NuxtLink>
          <span v-else>{{ item.label }}</span>
          <button
            type="button"
            class="text-ink3 hover:text-ink h-[22px] w-[22px] cursor-pointer rounded-full leading-none transition-colors"
            :aria-label="`Stop following ${item.label}`"
            @click="toggle(item.follow)"
          >
            ×
          </button>
        </li>
      </ul>

      <p v-if="failed" class="text-[13px] text-ink3" role="status">Could not load your stories right now. Try again in a moment.</p>
      <p v-else-if="!data" class="text-[13px] text-ink3" aria-busy="true" aria-live="polite">Loading…</p>

      <template v-else>
        <p v-if="data.total === 0" data-test="no-blocks" class="font-serif text-[18px] leading-[1.9] text-ink2">
          No stories yet about what you follow.
        </p>
        <p v-else data-test="summary" class="border-rule-soft border-b pb-7 text-[13px] text-ink3">
          {{ pluralize(data.total, 'story', 'stories') }}<template v-if="newCount > 0"> · {{ newCount }} new since your last visit</template>
        </p>

        <article v-for="block in data.items" :key="block.id" data-test="block" class="border-rule-soft border-b py-7">
          <p class="mb-2 text-[12.5px] text-ink3">
            <span
              v-if="isNew(block)"
              data-test="new"
              class="bg-accent text-paper mr-2 rounded-full px-2 py-[1px] text-[11px] font-medium tracking-[0.06em] uppercase"
              >New</span
            ><time>{{ block.dateLabel }}</time>
          </p>
          <h3 class="font-serif text-[19px] leading-[1.42] font-semibold text-ink md:text-[22px] mb-[9px]">{{ block.title }}</h3>
          <!-- 正文 markdown 由 server 路由渲染（与阅读页同一来源），工具类挂不到段落上，段距见下方 scoped 样式 -->
          <div class="block-body font-serif text-[16px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[18px]" v-html="block.bodyHtml" />
          <p class="mt-[9px] flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink3">
            <NuxtLink :to="block.href" class="border-rule hover:text-ink border-b transition-colors">Issue {{ block.briefNumber }} →</NuxtLink>
            <span v-for="match in block.matches" :key="`${match.kind}:${match.label}`" data-test="match">
              <template v-if="match.involved">Involves </template>
              <NuxtLink v-if="match.href" :to="match.href" class="border-rule hover:text-ink border-b transition-colors">{{ match.label }}</NuxtLink>
              <template v-else>{{ match.label }}</template>
            </span>
            <EntityLinks :entities="block.entities.filter(e => !block.matches.some(m => m.kind === 'entity' && m.href === e.href))" />
          </p>
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
    </template>
  </div>
</template>

<style scoped>
.block-body :deep(p + p) { margin-top: 0.8em; }
</style>
