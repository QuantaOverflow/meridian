<script lang="ts" setup>
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import type { OpsSources, OpsSourceKind } from '@meridian/contracts';
import { beijingDateTime } from '~/utils/beijingTime';

definePageMeta({ layout: 'admin' });

const { data, error: sourcesError, refresh: refreshSources } = await useFetch<OpsSources>('/api/admin/ops/sources');
if (sourcesError.value) {
  console.error(sourcesError.value);

  if (sourcesError.value.statusCode === 401) {
    await navigateTo('/admin/login');
  } else {
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch sources' });
  }
}

const sources = computed(() => data.value?.sources ?? []);
const counts = computed(() => data.value?.counts);
const thresholds = computed(() => data.value?.thresholds);

// 状态在表里的名字、色块底色与图形（形状和颜色同时区分，不只靠颜色）
const KINDS: Record<OpsSourceKind, { label: string; plural: string; chip: string; shape: 'square' | 'triangle' | 'circle' | 'pause' | 'none' }> = {
  not_checked: { label: 'Not checked', plural: 'not checked', chip: 'bg-red-50', shape: 'square' },
  dead_feed: { label: 'Dead feed', plural: 'dead feeds', chip: 'bg-red-50', shape: 'square' },
  fetch_failing: { label: 'Fetch failing', plural: 'fetch failing', chip: 'bg-amber-50', shape: 'triangle' },
  bad_body: { label: 'Bad body', plural: 'bad body format', chip: 'bg-amber-50', shape: 'triangle' },
  paused: { label: 'Paused', plural: 'paused', chip: 'bg-gray-100', shape: 'pause' },
  ok: { label: 'OK', plural: 'OK', chip: 'bg-gray-100', shape: 'none' },
};
const SUMMARY_ORDER: OpsSourceKind[] = ['not_checked', 'dead_feed', 'fetch_failing', 'bad_body', 'paused', 'ok'];

const filter = ref<'all' | 'problems' | 'paused'>('all');
const isProblem = (kind: OpsSourceKind) => kind !== 'ok' && kind !== 'paused';
const problemCount = computed(() => sources.value.filter(s => isProblem(s.kind)).length);
const shown = computed(() => {
  if (filter.value === 'problems') return sources.value.filter(s => isProblem(s.kind));
  if (filter.value === 'paused') return sources.value.filter(s => s.kind === 'paused');
  return sources.value;
});

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'never');
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

async function addSource() {
  const url = prompt('Enter the URL of the source you want to add');
  if (!url) return;

  const urlSchema = z.string().url();
  const result = urlSchema.safeParse(url);
  if (!result.success) {
    alert('Invalid URL');
    return;
  }

  try {
    await $fetch('/api/admin/sources', {
      method: 'POST',
      body: { url },
    });
    alert('Source added successfully');
    await refreshSources();
  } catch (error) {
    // 在点击回调里 throw 只会变成没人接的 rejection，用户什么也看不到；直接告诉用户失败原因
    console.error('Failed to add source', error);
    const reason = (error as { statusMessage?: string })?.statusMessage ?? (error instanceof Error ? error.message : String(error));
    alert(`Failed to add source: ${reason}`);
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap justify-between items-end gap-3 mb-6">
      <div>
        <h1 class="text-xl font-medium text-gray-900">Sources</h1>
        <p class="text-sm text-gray-600 mt-1">
          {{ sources.length }} sources · status uses the last 7 days · pause and resume stay on the source page
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div role="group" aria-label="Filter" class="inline-flex bg-white border rounded-lg p-0.5 gap-0.5 text-sm">
          <button
            v-for="f in [
              { key: 'all', label: `All ${sources.length}` },
              { key: 'problems', label: `Problems ${problemCount}` },
              { key: 'paused', label: `Paused ${counts?.paused ?? 0}` },
            ] as const"
            :key="f.key"
            type="button"
            :aria-pressed="filter === f.key"
            class="px-3 py-1.5 rounded-md hover:cursor-pointer"
            :class="filter === f.key ? 'bg-gray-900 text-white' : 'text-gray-900 hover:bg-gray-100'"
            @click="filter = f.key"
          >
            {{ f.label }}
          </button>
        </div>
        <!-- button to add a new source -->
        <button @click="addSource" class="border bg-white px-4 py-2 rounded hover:cursor-pointer hover:bg-gray-100">
          Add Source
        </button>
      </div>
    </div>

    <!-- count per kind -->
    <section aria-label="Summary" class="flex flex-wrap gap-2.5 mb-6">
      <span
        v-for="kind in SUMMARY_ORDER"
        :key="kind"
        :data-kind="kind"
        class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm"
        :class="(counts?.[kind] ?? 0) > 0 && kind !== 'ok' && kind !== 'paused' ? KINDS[kind].chip : 'bg-gray-100'"
      >
        <svg v-if="KINDS[kind].shape !== 'none'" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect v-if="KINDS[kind].shape === 'square'" x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="#d03b3b" />
          <path v-else-if="KINDS[kind].shape === 'triangle'" d="M6 1 L11.2 10.5 H0.8 Z" fill="#fab219" stroke="#9a6b00" stroke-linejoin="round" />
          <g v-else fill="#898781">
            <rect x="2.5" y="2" width="2.5" height="8" rx="1" />
            <rect x="7" y="2" width="2.5" height="8" rx="1" />
          </g>
        </svg>
        <strong class="font-semibold">{{ counts?.[kind] ?? 0 }}</strong> {{ KINDS[kind].plural }}
      </span>
    </section>

    <div class="bg-white text-gray-800 rounded border px-5 py-2 overflow-x-auto">
      <table class="w-full min-w-[1080px] text-[13.5px]">
        <thead>
          <tr class="text-left text-gray-600 text-xs">
            <th class="font-medium py-2.5 pr-2.5 border-b">Status</th>
            <th class="font-medium p-2.5 border-b">Source</th>
            <th class="font-medium p-2.5 border-b">Last checked</th>
            <th class="font-medium p-2.5 border-b">Last new article</th>
            <th class="font-medium p-2.5 border-b text-right">7 days</th>
            <th class="font-medium p-2.5 border-b text-right">48 h</th>
            <th class="font-medium p-2.5 border-b text-right">Fetch failed</th>
            <th class="font-medium p-2.5 border-b text-right">Junk page</th>
            <th class="font-medium p-2.5 border-b text-right">Single-line</th>
            <th class="font-medium p-2.5 border-b text-right">Via browser</th>
            <th class="font-medium py-2.5 pl-2.5 border-b">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in shown" :key="source.id" :data-kind="source.kind" :class="source.kind === 'paused' ? 'text-gray-500' : ''">
            <td class="py-2.5 pr-2.5 border-b border-gray-100 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5 font-medium">
                <svg v-if="KINDS[source.kind].shape !== 'none'" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <rect v-if="KINDS[source.kind].shape === 'square'" x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="#d03b3b" />
                  <path v-else-if="KINDS[source.kind].shape === 'triangle'" d="M6 1 L11.2 10.5 H0.8 Z" fill="#fab219" stroke="#9a6b00" stroke-linejoin="round" />
                  <g v-else fill="#898781">
                    <rect x="2.5" y="2" width="2.5" height="8" rx="1" />
                    <rect x="7" y="2" width="2.5" height="8" rx="1" />
                  </g>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="5" fill="#0ca30c" />
                </svg>
                {{ source.kind === 'not_checked' && source.lastError ? 'Check failing' : KINDS[source.kind].label }}
              </span>
            </td>
            <td class="p-2.5 border-b border-gray-100">
              <NuxtLink :to="source.url" target="_blank" class="font-medium text-blue-700 hover:underline">{{ source.name }}</NuxtLink>
              <span class="text-gray-500"> · {{ source.category }}</span>
            </td>
            <td class="p-2.5 border-b border-gray-100 whitespace-nowrap">
              {{ beijingDateTime(source.lastChecked) }}<span class="text-gray-500"> · {{ ago(source.lastChecked) }}</span>
              <!-- 最近一轮去了但失败：把什么时候试的、为什么失败写在下面，不用翻日志 -->
              <div v-if="source.lastError" class="mt-0.5 max-w-[340px] whitespace-normal text-xs text-red-800" data-test="last-error">
                Last attempt {{ beijingDateTime(source.lastAttemptAt) }} failed: {{ source.lastError }}
              </div>
            </td>
            <td class="p-2.5 border-b border-gray-100 whitespace-nowrap">{{ beijingDateTime(source.lastArticleAt) }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums">{{ source.articles7d }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums">{{ source.articles48h }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums" :class="{ 'font-semibold': (source.fetchFailedPct ?? 0) > (thresholds?.fetchFailingPct ?? 100) }">{{ pct(source.fetchFailedPct) }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums" :class="{ 'font-semibold': (source.junkPct ?? 0) > (thresholds?.badBodyPct ?? 100) }">{{ pct(source.junkPct) }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums" :class="{ 'font-semibold': (source.singleLinePct ?? 0) > (thresholds?.badBodyPct ?? 100) }">{{ pct(source.singleLinePct) }}</td>
            <td class="p-2.5 border-b border-gray-100 text-right tabular-nums">{{ pct(source.viaBrowserPct) }}</td>
            <td class="py-2.5 pl-2.5 border-b border-gray-100">
              <NuxtLink :to="`/admin/feed/${source.id}`" class="text-blue-600 hover:underline"> View Feed </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- legend of rules -->
    <section class="bg-white rounded border p-5 mt-6">
      <h2 class="text-[15px] font-semibold mb-2.5">What counts as a problem</h2>
      <div class="grid gap-x-7 gap-y-3 text-sm text-gray-600" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))">
        <div><strong class="font-semibold text-gray-900">Not checked</strong> · red<br />No successful check for two scrape intervals (2 h for hourly sources). When checks ran but failed, the reason is shown under Last checked.</div>
        <div>
          <strong class="font-semibold text-gray-900">Dead feed</strong> · red<br />At least {{ thresholds?.deadFeedMinArticles7d ?? 7 }} new articles in 7 days, none in the last
          {{ thresholds?.deadFeedQuietHours ?? 48 }} h.
        </div>
        <div>
          <strong class="font-semibold text-gray-900">Fetch failing</strong> · yellow<br />More than {{ thresholds?.fetchFailingPct ?? 30 }}% of new articles failed to fetch in 7 days.
        </div>
        <div>
          <strong class="font-semibold text-gray-900">Bad body format</strong> · yellow<br />More than {{ thresholds?.badBodyPct ?? 20 }}% junk pages or single-line bodies in 7 days.
        </div>
      </div>
      <p class="mt-3 text-xs text-gray-500">Paused sources are grey and never count as a problem.</p>
    </section>
  </div>
</template>
