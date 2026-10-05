<script lang="ts" setup>
import type { OpsRunDetail, OpsRunFlag } from '@meridian/contracts';
import type { OpsRunCall } from '~/server/api/admin/ops/runs/[workflowId]/calls.get';
import { beijingDate, beijingTime } from '~/utils/beijingTime';
import { blockIndexOfCall } from '~/utils/runCalls';

definePageMeta({ layout: 'admin' });
useSeoMeta({ title: 'Run detail · Meridian Ops' });

const workflowId = String(useRoute().params.workflowId);
const { data: detail, error: loadError } = await useFetch<OpsRunDetail>(`/api/admin/ops/runs/${encodeURIComponent(workflowId)}`);
if (loadError.value?.statusCode === 401) await navigateTo('/admin/login');

const run = computed(() => detail.value?.run);
const summary = computed(() => detail.value?.summary ?? null);
const blocks = computed(() => (detail.value && Array.isArray(detail.value.blocks) ? detail.value.blocks : null));
const blocksUnavailable = computed(() => {
  const b = detail.value?.blocks;
  return b && !Array.isArray(b) ? b.unavailable : null;
});

const NOT_RECORDED = 'not recorded';
const LEVEL_STYLE = { ok: 'bg-green-100 text-green-800', yellow: 'bg-yellow-100 text-yellow-800', red: 'bg-red-100 text-red-800' };
const FLAG_LABEL: Record<OpsRunFlag, string> = {
  slow: 'slow',
  costly: 'costly',
  degraded: 'degraded',
  failed: 'failed',
  no_stories: 'no stories',
  late: 'late',
};

function duration(ms: number | null): string {
  if (ms === null) return '-';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
const usd = (v: number | null, digits = 3) => (v === null ? NOT_RECORDED : `$${v.toFixed(digits)}`);
const num = (v: number | null) => (v === null ? NOT_RECORDED : v.toLocaleString('en-US'));

const tiles = computed(() => {
  const r = run.value;
  if (!r) return [];
  return [
    { label: 'Duration', value: duration(r.durationMs) },
    { label: 'Articles', value: num(r.articles) },
    { label: 'Stories', value: num(r.stories) },
    { label: 'Blocks', value: num(r.blocks) },
    { label: 'Model calls', value: num(r.calls) },
    { label: 'Cost', value: usd(r.usd), note: r.neurons === null ? '' : `${r.neurons.toLocaleString('en-US')} neurons` },
  ];
});

// 步骤放在同一条时间轴上：起点取最早开始，终点取最晚结束
const timeline = computed(() => {
  const steps = summary.value?.steps;
  if (!steps || steps.length === 0) return null;
  const starts = steps.map(s => new Date(s.startedAt).getTime());
  const t0 = Math.min(...starts);
  const t1 = Math.max(...steps.map((s, i) => starts[i] + s.ms));
  const span = Math.max(1, t1 - t0);
  return {
    from: new Date(t0).toISOString(),
    to: new Date(t1).toISOString(),
    rows: steps.map((s, i) => ({
      ...s,
      left: ((starts[i] - t0) / span) * 100,
      width: Math.max(0.6, (s.ms / span) * 100),
    })),
  };
});
const STEP_FILL = { completed: 'bg-blue-500', degraded: 'bg-yellow-500', failed: 'bg-red-500' };

// ── 模型调用：打开一块时才取调用列表，一次运行只取一次 ──
const calls = ref<OpsRunCall[] | null>(null);
const callsError = ref<string | null>(null);
const callsLoading = ref(false);
const openBlock = ref<number | null>(null);

async function loadCalls() {
  if (calls.value || callsLoading.value) return;
  callsLoading.value = true;
  callsError.value = null;
  try {
    const res = await $fetch<{ calls: OpsRunCall[] }>(`/api/admin/ops/runs/${encodeURIComponent(workflowId)}/calls`);
    calls.value = res.calls;
  } catch (error) {
    console.error(error);
    callsError.value = 'Could not load the call list.';
  } finally {
    callsLoading.value = false;
  }
}

async function toggleBlock(index: number) {
  openBlock.value = openBlock.value === index ? null : index;
  openCall.value = null;
  callRecord.value = null;
  if (openBlock.value !== null) await loadCalls();
}

const openBlockInfo = computed(() => blocks.value?.find(b => b.index === openBlock.value) ?? null);
const blockCalls = computed(() =>
  (calls.value ?? [])
    .filter(c => blockIndexOfCall(c.phase, c.call_index) === openBlock.value)
    .sort((a, b) => a.uploaded.localeCompare(b.uploaded) || (a.call_index ?? 0) - (b.call_index ?? 0))
);

interface CallRecord {
  request?: { model?: string; messages?: Array<{ role?: string; content?: unknown }> };
  response?: { content?: unknown; finish_reason?: string } | null;
  error?: string | null;
}
const openCall = ref<string | null>(null);
const callRecord = ref<CallRecord | null>(null);
const recordError = ref<string | null>(null);

async function showCall(call: OpsRunCall) {
  openCall.value = call.key;
  callRecord.value = null;
  recordError.value = null;
  try {
    const rec = await $fetch<CallRecord>(`/api/admin/ops/calls/${call.key}`);
    if (openCall.value === call.key) callRecord.value = rec;
  } catch (error) {
    console.error(error);
    if (openCall.value === call.key) recordError.value = 'Could not load this call.';
  }
}

// 请求与回复一律当纯文本：字符串原样，其它结构转成缩进 JSON
const asText = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v, null, 2));
const tokensOf = (c: OpsRunCall) =>
  c.tokens ? `${c.tokens.prompt_tokens ?? '?'} in → ${c.tokens.completion_tokens ?? '?'} out` : '-';
const neuronsOf = (c: OpsRunCall) => (c.tokens?.neurons === undefined ? '-' : `${c.tokens.neurons.toFixed(1)} neurons`);
const latencyOf = (c: OpsRunCall) => (c.latency_ms === undefined ? '-' : `${(c.latency_ms / 1000).toFixed(1)} s`);
</script>

<template>
  <div class="space-y-4">
    <nav class="text-sm text-gray-600" aria-label="Breadcrumb">
      <NuxtLink to="/admin" class="text-blue-700 hover:underline">Health</NuxtLink> › Runs ›
      <span class="font-mono">{{ workflowId }}</span>
    </nav>

    <section v-if="loadError" class="rounded border bg-white p-4 text-sm text-gray-700" data-test="load-error">
      {{ loadError.statusCode === 404 ? 'Run not found.' : 'Could not load this run.' }}
    </section>

    <template v-else-if="run">
      <section class="space-y-4 rounded border bg-white p-4" data-test="header">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 class="text-xl font-medium text-gray-900">{{ beijingDate(run.startedAt) }} · {{ beijingTime(run.startedAt) }} run</h2>
          <span class="rounded-full px-3 py-0.5 text-sm font-medium" :class="LEVEL_STYLE[run.level]">{{ run.status }}</span>
          <span v-for="f in run.flags" :key="f" class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{{ FLAG_LABEL[f] }}</span>
          <span class="font-mono text-sm text-gray-500">{{ run.workflowId }}</span>
        </div>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div v-for="t in tiles" :key="t.label" data-test="tile">
            <div class="text-xs text-gray-600">{{ t.label }}</div>
            <div class="mt-0.5 text-lg font-semibold" :class="t.value === NOT_RECORDED ? 'text-gray-400 text-sm' : ''">{{ t.value }}</div>
            <div v-if="t.note" class="text-xs text-gray-500">{{ t.note }}</div>
          </div>
        </div>
      </section>

      <section v-if="detail?.error" class="rounded border border-red-200 bg-red-50 p-4" data-test="run-error">
        <h3 class="text-sm font-semibold text-red-800">Run error</h3>
        <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-red-900">{{ detail.error }}</pre>
      </section>

      <section v-if="summary && summary.degradedReasons.length > 0" class="rounded border border-yellow-200 bg-yellow-50 p-4" data-test="degraded">
        <h3 class="text-sm font-semibold text-yellow-900">Degraded because</h3>
        <ul class="mt-1 list-disc pl-5 text-sm text-yellow-900">
          <li v-for="reason in summary.degradedReasons" :key="reason">{{ reason }}</li>
        </ul>
      </section>

      <section class="rounded border bg-white p-4" data-test="steps">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-base font-semibold">Steps</h3>
          <span v-if="timeline" class="text-sm text-gray-600">
            {{ beijingTime(timeline.from, true) }} → {{ beijingTime(timeline.to, true) }} · bars share one time axis
          </span>
        </div>
        <p v-if="!timeline" class="text-sm text-gray-500">Steps: {{ NOT_RECORDED }}</p>
        <div v-else class="space-y-1">
          <div v-for="s in timeline.rows" :key="s.name + s.startedAt" class="grid grid-cols-[minmax(120px,240px)_1fr_64px] items-center gap-3 border-t py-2 text-sm">
            <span class="font-medium">{{ s.name }}</span>
            <div class="relative h-3.5 rounded bg-gray-50">
              <div
                class="absolute top-0 h-3.5 min-w-[4px] rounded"
                :class="STEP_FILL[s.status]"
                :style="{ left: `${s.left}%`, width: `${s.width}%` }"
                :title="s.status"
              ></div>
            </div>
            <span class="text-right tabular-nums">{{ duration(s.ms) }}</span>
          </div>
        </div>
      </section>

      <section class="rounded border bg-white p-4" data-test="blocks">
        <h3 class="mb-2 text-base font-semibold">Blocks</h3>
        <p v-if="blocksUnavailable" class="text-sm text-gray-500" data-test="blocks-unavailable">Blocks unavailable: {{ blocksUnavailable }}</p>
        <p v-else-if="blocks && blocks.length === 0" class="text-sm text-gray-500">No blocks were written.</p>
        <div v-else-if="blocks" class="overflow-x-auto">
          <table class="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr class="text-left text-xs text-gray-600">
                <th class="border-b py-2 pr-2 font-medium">#</th>
                <th class="border-b p-2 font-medium">Tier</th>
                <th class="border-b p-2 font-medium">Block</th>
                <th class="border-b p-2 text-right font-medium">Articles</th>
                <th class="border-b p-2 font-medium">Check</th>
                <th class="border-b p-2 text-right font-medium">Revisions</th>
                <th class="border-b p-2 text-right font-medium">Unchecked</th>
                <th class="border-b p-2 text-right font-medium">Refusals</th>
                <th class="border-b p-2 text-right font-medium">Calls</th>
                <th class="border-b py-2 pl-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in blocks" :key="b.index" :class="openBlock === b.index ? 'bg-blue-50' : ''" data-test="block-row">
                <td class="border-b py-2 pr-2 tabular-nums text-gray-600">{{ b.index }}</td>
                <td class="border-b p-2 text-gray-600">{{ b.tier }}</td>
                <td class="border-b p-2 font-medium">{{ b.title }}</td>
                <td class="border-b p-2 text-right tabular-nums">{{ b.articles }}</td>
                <td class="border-b p-2">{{ b.check?.outcome ?? '-' }}</td>
                <td class="border-b p-2 text-right tabular-nums">{{ b.check?.revisions ?? '-' }}</td>
                <td class="border-b p-2 text-right tabular-nums" :class="b.check && b.check.unchecked > 0 ? 'font-semibold text-yellow-700' : ''">
                  {{ b.check?.unchecked ?? '-' }}
                </td>
                <td class="border-b p-2 text-right tabular-nums">{{ b.refusals }}</td>
                <td class="border-b p-2 text-right tabular-nums">
                  <button v-if="b.calls > 0" type="button" class="font-medium text-blue-700 hover:underline" data-test="open-calls" @click="toggleBlock(b.index)">
                    {{ b.calls }} {{ openBlock === b.index ? '↑' : '↓' }}
                  </button>
                  <span v-else>{{ b.calls }}</span>
                </td>
                <td class="border-b py-2 pl-2 text-right tabular-nums">${{ b.usd.toFixed(4) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="openBlockInfo" class="space-y-3 rounded border bg-white p-4" data-test="calls">
        <h3 class="text-base font-semibold">Block {{ openBlockInfo.index }} · {{ openBlockInfo.title }} · model calls</h3>
        <p v-if="callsLoading" class="text-sm text-gray-500">Loading calls…</p>
        <p v-else-if="callsError" class="text-sm text-red-700">{{ callsError }}</p>
        <p v-else-if="blockCalls.length === 0" class="text-sm text-gray-500">No call records found for this block.</p>
        <div v-else class="overflow-hidden rounded border">
          <button
            v-for="c in blockCalls"
            :key="c.key"
            type="button"
            class="flex w-full flex-wrap items-center gap-x-5 gap-y-1 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50"
            :class="openCall === c.key ? 'bg-blue-50' : ''"
            data-test="call-row"
            @click="showCall(c)"
          >
            <span class="min-w-[44px] font-mono text-xs text-gray-600">#{{ c.call_index }}</span>
            <span class="min-w-[150px] font-medium">{{ c.phase }}</span>
            <span class="min-w-[150px] font-mono text-xs">{{ c.model ?? '-' }}</span>
            <span class="min-w-[70px] text-gray-600">{{ beijingTime(c.uploaded, true) }}</span>
            <span class="min-w-[140px] tabular-nums text-gray-600">{{ tokensOf(c) }}</span>
            <span class="min-w-[90px] tabular-nums">{{ neuronsOf(c) }}</span>
            <span class="tabular-nums text-gray-600">{{ latencyOf(c) }}</span>
            <span v-if="c.error" class="text-red-700">error: {{ c.error }}</span>
          </button>
        </div>

        <div v-if="openCall" class="space-y-2" data-test="call-detail">
          <p v-if="recordError" class="text-sm text-red-700">{{ recordError }}</p>
          <p v-else-if="!callRecord" class="text-sm text-gray-500">Loading call…</p>
          <template v-else>
            <div v-for="(m, i) in callRecord.request?.messages ?? []" :key="i">
              <div class="mb-1 text-xs font-semibold uppercase text-gray-600">Request · {{ m.role ?? 'message' }}</div>
              <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border bg-gray-50 p-3 font-mono text-xs" data-test="call-request">{{ asText(m.content) }}</pre>
            </div>
            <div>
              <div class="mb-1 text-xs font-semibold uppercase text-gray-600">
                Response<span v-if="callRecord.response?.finish_reason"> · finish_reason: {{ callRecord.response.finish_reason }}</span>
              </div>
              <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border bg-gray-50 p-3 font-mono text-xs" data-test="call-response">{{ callRecord.error ? `error: ${callRecord.error}` : asText(callRecord.response?.content) }}</pre>
            </div>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
