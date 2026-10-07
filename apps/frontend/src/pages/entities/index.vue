<script setup lang="ts">
import type { EntityBlocksResponse } from '~/shared/types';

// 实体页（/entities?name=…）：跨所有已发布的期，列出挂着这个人物、机构或地名的简报块，最新的在前。
// 只有出现在足够多块里的实体才有页（门槛在 backend）；查的写法能归成国家时跳国家页。
// 首屏第一页在服务端取，「Show more」在浏览器里接着取。
const route = useRoute();
const raw = Array.isArray(route.query.name) ? route.query.name[0] : route.query.name;
const query = (raw ?? '').trim();
if (query === '' || query.length > 200) {
  throw createError({ statusCode: 404, statusMessage: 'This page does not exist', fatal: true });
}
const PAGE_SIZE = 20;

const fetchPage = (offset: number) =>
  $fetch<EntityBlocksResponse>('/api/entities/blocks', { query: { name: query, limit: PAGE_SIZE, offset } });

// lazy 见 pages/index.vue 的说明
const { data, error, status } = await useAsyncData(`entity-${query.toLowerCase()}`, () => fetchPage(0), { lazy: true });

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusCode === 404 || error.value.statusCode === 400 ? 'This page does not exist' : 'Failed to load the page',
    fatal: true,
  });
}

// 能归成国家的写法：它的块在国家页。服务端渲染时数据已到，直接重定向；浏览器里换页时数据后到，到了再跳
if (data.value?.kind === 'country') {
  await navigateTo(data.value.href, { replace: true, redirectCode: 302 });
}
watch(data, page => {
  if (page?.kind === 'country') void navigateTo(page.href, { replace: true });
});

const entity = computed(() => (data.value?.kind === 'entity' ? data.value : null));

const loadingMore = ref(false);
const loadFailed = ref(false);

async function showMore() {
  const current = entity.value;
  if (!current || loadingMore.value) return;
  loadingMore.value = true;
  loadFailed.value = false;
  try {
    const next = await fetchPage(current.items.length);
    if (next.kind !== 'entity') return;
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

useSeoMeta({
  title: () => `${entity.value?.name ?? query} | Meridian`,
  description: () => `Every story mentioning ${entity.value?.name ?? query} in the daily briefs, newest first.`,
  ogLocale: 'en_US',
});
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8">
    <p v-if="status === 'pending' || !entity" class="text-[13px] text-ink3" aria-busy="true" aria-live="polite">Loading…</p>

    <template v-else>
      <p class="mb-4 text-[12.5px] tracking-[0.1em] text-ink3">In the news</p>
      <div class="mb-[18px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[42px]">
          {{ entity.name }}
        </h1>
        <FollowButton :follow="{ kind: 'entity', key: entity.key, name: entity.name }" />
      </div>

      <p data-test="summary" class="border-rule-soft border-b pb-7 text-[13px] text-ink3">
        {{ pluralize(entity.total, 'story', 'stories') }} where most of the coverage mentions {{ entity.name }} · matched by exact name, so
        other spellings are listed separately
      </p>

      <article v-for="block in entity.items" :key="block.id" data-test="block" class="border-rule-soft border-b py-7">
        <p class="mb-2 text-[12.5px] text-ink3">
          <time>{{ block.dateLabel }}</time><template v-if="block.placedIn"> · {{ block.placedIn }}</template>
        </p>
        <h3 class="font-serif text-[19px] leading-[1.42] font-semibold text-ink md:text-[22px] mb-[9px]">{{ block.title }}</h3>
        <!-- 正文 markdown 由 server 路由渲染（与阅读页同一来源），工具类挂不到段落上，段距见下方 scoped 样式 -->
        <div class="block-body font-serif text-[16px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[18px]" v-html="block.bodyHtml" />
        <p class="mt-[9px] flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink3">
          <NuxtLink :to="block.href" class="border-rule hover:text-ink border-b transition-colors">Issue {{ block.briefNumber }} →</NuxtLink>
          <EntityLinks :entities="block.entities" />
        </p>
      </article>

      <div v-if="entity.items.length < entity.total" class="pt-6">
        <button
          type="button"
          class="border-rule text-ink2 hover:text-ink cursor-pointer rounded-full border px-4 py-[6px] text-[13px] transition-colors disabled:cursor-default disabled:opacity-60"
          :disabled="loadingMore"
          @click="showMore"
        >
          {{ loadingMore ? 'Loading…' : `Show more (${entity.total - entity.items.length} left)` }}
        </button>
        <span v-if="loadFailed" class="ml-3 text-[12.5px] text-ink3" role="status">Could not load more. Try again.</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.block-body :deep(p + p) { margin-top: 0.8em; }
</style>
