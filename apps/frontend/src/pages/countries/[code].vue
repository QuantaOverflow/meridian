<script setup lang="ts">
import type { CountrySection } from '@meridian/contracts';
import { COUNTRIES } from '~/lib/briefMap';
import type { CountryBlocksResponse } from '~/shared/types';

// 国家页：跨所有已发布的期，分两节列简报块——落点在该国的，与涉及该国（落点在别处）的。
// 每节各自分页；首屏两节的第一页在服务端取齐，「Show more」在浏览器里接着取。
const route = useRoute();
const code = String(route.params.code).toUpperCase();
if (!(code in COUNTRIES)) {
  throw createError({ statusCode: 404, statusMessage: 'This country page does not exist', fatal: true });
}
const name = COUNTRIES[code].name;
const PAGE_SIZE = 20;

const fetchSection = (section: CountrySection, offset: number) =>
  $fetch<CountryBlocksResponse>(`/api/countries/${code}/blocks`, { query: { section, limit: PAGE_SIZE, offset } });

// lazy 见 pages/index.vue 的说明
const { data, error, status } = await useAsyncData(
  `country-${code}`,
  async () => {
    const [placement, mention] = await Promise.all([fetchSection('placement', 0), fetchSection('mention', 0)]);
    return { placement, mention };
  },
  { lazy: true }
);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusCode === 404 ? 'This country page does not exist' : 'Failed to load the country page',
    fatal: true,
  });
}

const loadingMore = ref<CountrySection | null>(null);
const loadFailed = ref<CountrySection | null>(null);

async function showMore(section: CountrySection) {
  const current = data.value?.[section];
  if (!current || loadingMore.value) return;
  loadingMore.value = section;
  loadFailed.value = null;
  try {
    const next = await fetchSection(section, current.items.length);
    // 两次请求之间出了新的一期时，页与页会错位：按块 id 去重
    const seen = new Set(current.items.map(b => b.id));
    data.value = {
      ...data.value!,
      [section]: { ...next, items: [...current.items, ...next.items.filter(b => !seen.has(b.id))] },
    };
  } catch (err) {
    console.error('Failed to load more blocks', err);
    loadFailed.value = section;
  } finally {
    loadingMore.value = null;
  }
}

const sections = computed(() => {
  if (!data.value) return [];
  return [
    { key: 'placement' as const, heading: `Stories in ${name}`, note: null, page: data.value.placement },
    {
      key: 'mention' as const,
      heading: `Also involving ${name}`,
      note: `Stories that mainly happened elsewhere, where most of the coverage mentions ${name}.`,
      page: data.value.mention,
    },
  ].filter(s => s.page.total > 0);
});

const summary = computed(() => {
  if (!data.value) return '';
  const { placement, mention } = data.value;
  return `${pluralize(placement.total, 'story', 'stories')} in ${name} · ${mention.total} more involving it`;
});

useSeoMeta({
  title: `${name} | Meridian`,
  description: `Every story about ${name} in the daily briefs, newest first.`,
  ogLocale: 'en_US',
});
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8">
    <NuxtLink :to="`/?country=${code}`" class="text-ink3 hover:text-ink mb-[22px] inline-block text-[13px] transition-colors">
      ← {{ name }} on today’s map
    </NuxtLink>

    <p class="mb-4 text-[12.5px] tracking-[0.1em] text-ink3">Country</p>
    <div class="mb-[18px] flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[42px]">
        {{ name }}
      </h1>
      <FollowButton :follow="{ kind: 'country', code }" />
    </div>

    <p v-if="status === 'pending' || !data" class="text-[13px] text-ink3" aria-busy="true" aria-live="polite">Loading…</p>

    <template v-else>
      <p class="border-rule-soft mb-11 border-b pb-7 text-[13px] text-ink3">{{ summary }}</p>

      <p v-if="sections.length === 0" class="font-serif text-[18px] leading-[1.9] text-ink2">
        No stories about {{ name }} in the briefs yet.
      </p>

      <section v-for="s in sections" :key="s.key" :data-section="s.key" class="mb-14">
        <h2 class="mb-1 text-[13px] font-medium tracking-[0.14em] text-ink2 uppercase">{{ s.heading }} · {{ s.page.total }}</h2>
        <p v-if="s.note" class="mb-2 text-[12.5px] leading-[1.6] text-ink3">{{ s.note }}</p>

        <article v-for="block in s.page.items" :key="block.id" class="border-rule-soft border-b py-7">
          <p class="mb-2 text-[12.5px] text-ink3">
            <time>{{ block.dateLabel }}</time>
            <template v-if="s.key === 'mention'"> · {{ block.placedIn ? `Mainly in ${block.placedIn}` : 'Across several countries' }}</template>
          </p>
          <h3 class="font-serif text-[19px] leading-[1.42] font-semibold text-ink md:text-[22px] mb-[9px]">{{ block.title }}</h3>
          <!-- 正文 markdown 由 server 路由渲染（与阅读页同一来源），工具类挂不到段落上，段距见下方 scoped 样式 -->
          <div class="block-body font-serif text-[16px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[18px]" v-html="block.bodyHtml" />
          <p class="mt-[9px] flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink3">
            <NuxtLink :to="block.href" class="border-rule hover:text-ink border-b transition-colors">Issue {{ block.briefNumber }} →</NuxtLink>
            <span v-if="block.alsoInvolves.length">Also involves {{ block.alsoInvolves.join(', ') }}</span>
            <EntityLinks :entities="block.entities" />
          </p>
        </article>

        <div v-if="s.page.items.length < s.page.total" class="pt-6">
          <button
            type="button"
            class="border-rule text-ink2 hover:text-ink cursor-pointer rounded-full border px-4 py-[6px] text-[13px] transition-colors disabled:cursor-default disabled:opacity-60"
            :disabled="loadingMore === s.key"
            @click="showMore(s.key)"
          >
            {{ loadingMore === s.key ? 'Loading…' : `Show more (${s.page.total - s.page.items.length} left)` }}
          </button>
          <span v-if="loadFailed === s.key" class="ml-3 text-[12.5px] text-ink3" role="status">Could not load more. Try again.</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.block-body :deep(p + p) { margin-top: 0.8em; }
</style>
