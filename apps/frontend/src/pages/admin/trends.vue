<script lang="ts" setup>
import type { OpsRunRow, OpsTrends, OpsUnavailable } from '@meridian/contracts';
import { beijingDate } from '~/utils/beijingTime';

definePageMeta({ layout: 'admin' });
useSeoMeta({ title: 'Trends · Meridian Ops' });

// 页面只渲染：灯、基线、按北京日的入库都是 backend 算好的（apps/backend/src/lib/ops/trends.ts）
const days = ref(30);
const { data, error } = await useFetch<OpsTrends>('/api/admin/ops/trends', { query: { days } });
if (error.value?.statusCode === 401) {
  await navigateTo('/admin/login');
}

const RANGES = [7, 14, 30, 90];

function reasonOf(value: object | undefined): string {
  return value && 'unavailable' in value ? String((value as OpsUnavailable).unavailable) : '';
}

// ── 格式 ───────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 北京日 `2026-10-04` → `Oct 4`（已经是北京日，不再换时区） */
function dayLabel(day: string) {
  const [, month, date] = day.split('-').map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};
const usd = (n: number) => `$${n.toFixed(3)}`;

// ── 图的模型 ───────────────────────────────────────────────────────────
// 所有图共用一种柱：自下而上的一到多段（单序列图只有一段），柱槽整条可悬停 / 聚焦。
// 配色同 Cost 页：蓝 = 正常，橙 = 失败，黄 = 越过阈值（带三角标记，不只靠颜色）。
const CHART_HEIGHT = 160;
const SEGMENT_GAP = 2;
const BLUE = '#2a78d6';
const ORANGE = '#eb6834';
const GREEN = '#1baf7a';
const PURPLE = '#4a3aa7';
const YELLOW = '#fab219';
const STUB = '#d6d5cf';

interface Segment {
  value: number;
  fill: string;
}
interface BarInput {
  key: string;
  label: string;
  /** 自下而上 */
  segments: Segment[];
  warn?: boolean;
  /** 不画柱，只画一个灰色小桩（没有记录） */
  stub?: boolean;
  tip: string;
}
interface ChartInput {
  id: string;
  bars: BarInput[];
  /** 轴的最大值至少是它（如阈值线要在图内） */
  floor?: number;
  format: (v: number) => string;
  limit?: { value: number; label: string };
}

/** 不小于 x 的整齐数（1 / 2 / 2.5 / 5 × 10ⁿ） */
function niceCeil(x: number) {
  if (x <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].find(m => m * pow >= x)! * pow;
}

function buildChart(input: ChartInput) {
  const totals = input.bars.map(b => b.segments.reduce((a, s) => a + s.value, 0));
  const step = niceCeil(Math.max(...totals, input.floor ?? 0, 0) / 2);
  const max = step * 2;
  const y = (v: number) => Math.round((v / max) * CHART_HEIGHT);
  const bars = input.bars.map((b, i) => {
    const segments = b.stub
      ? [{ height: 3, fill: STUB }]
      : b.segments.filter(s => s.value > 0).map(s => ({ height: Math.max(2, y(s.value)), fill: s.fill }));
    const stackHeight = segments.reduce((a, s) => a + s.height, 0) + Math.max(0, segments.length - 1) * SEGMENT_GAP;
    return { ...b, segments, stackHeight, alignRight: i >= input.bars.length / 2 };
  });
  return {
    id: input.id,
    bars,
    ticks: [0, 1, 2].map(k => ({ y: y(k * step), label: input.format(k * step) })),
    limit: input.limit ? { y: y(input.limit.value), label: input.limit.label } : null,
    first: bars[0]?.label ?? '',
    last: bars.at(-1)?.label ?? '',
  };
}
type Chart = ReturnType<typeof buildChart>;

const runLabel = (r: OpsRunRow) => beijingDate(r.startedAt);

const trends = computed(() => data.value ?? null);

const charts = computed<Record<string, Chart> | null>(() => {
  const t = trends.value;
  if (!t) return null;

  const slowAbove = t.medianDurationMs === null ? null : t.medianDurationMs * 1.5;
  const duration_ = buildChart({
    id: 'duration',
    format: v => String(Math.round(v / 60_000)),
    floor: slowAbove ?? 0,
    limit: slowAbove === null ? undefined : { value: slowAbove, label: `slow above ${(slowAbove / 60_000).toFixed(1)} (1.5× median)` },
    bars: t.runs.map(r => ({
      key: r.workflowId,
      label: runLabel(r),
      segments: [{ value: r.durationMs ?? 0, fill: r.flags.includes('slow') ? YELLOW : BLUE }],
      warn: r.flags.includes('slow'),
      stub: r.durationMs === null,
      tip:
        r.durationMs === null
          ? `${runLabel(r)} · still running`
          : `${runLabel(r)} · ${duration(r.durationMs)}${r.flags.includes('slow') && t.medianDurationMs ? ` · ${(r.durationMs / t.medianDurationMs).toFixed(1)}× median` : ''}`,
    })),
  });

  const costly = t.medianUsd === null ? null : t.medianUsd * 1.5;
  const cost = buildChart({
    id: 'cost',
    format: v => `$${v.toFixed(2)}`,
    floor: costly ?? 0,
    limit: costly === null ? undefined : { value: costly, label: `costly above ${usd(costly)} (1.5× median)` },
    bars: t.runs.map(r => ({
      key: r.workflowId,
      label: runLabel(r),
      segments: [{ value: r.usd ?? 0, fill: r.flags.includes('costly') ? YELLOW : BLUE }],
      warn: r.flags.includes('costly'),
      stub: r.usd === null,
      tip: r.usd === null ? `${runLabel(r)} · no cost recorded` : `${runLabel(r)} · ${usd(r.usd)}`,
    })),
  });

  const ingest = buildChart({
    id: 'ingest',
    format: v => int(v),
    bars: t.ingest.map(d => ({
      key: d.day,
      label: dayLabel(d.day),
      segments: [
        { value: d.processed, fill: BLUE },
        { value: d.fetchFailed + d.junk, fill: ORANGE },
      ],
      tip: `${dayLabel(d.day)} · ${int(d.processed)} processed · ${int(d.fetchFailed)} fetch failed · ${int(d.junk)} junk`,
    })),
  });

  const failure = buildChart({
    id: 'failure',
    format: v => `${+v.toFixed(1)}%`,
    bars: t.ingest.map(d => {
      const total = d.processed + d.fetchFailed + d.junk;
      const rate = total === 0 ? 0 : (d.fetchFailed / total) * 100;
      return {
        key: d.day,
        label: dayLabel(d.day),
        segments: [{ value: rate, fill: BLUE }],
        tip: total === 0 ? `${dayLabel(d.day)} · no articles` : `${dayLabel(d.day)} · ${rate.toFixed(1)}% fetch failed (${d.fetchFailed} of ${total})`,
      };
    }),
  });

  const singleLine = buildChart({
    id: 'single-line',
    format: v => `${Math.round(v)}%`,
    floor: 100,
    limit: { value: 20, label: 'limit 20%' },
    bars: t.ingest.map(d => {
      if (d.singleLine === null) {
        return { key: d.day, label: dayLabel(d.day), segments: [], stub: true, tip: `${dayLabel(d.day)} · not recorded` };
      }
      const pct = (d.singleLine / d.bodies) * 100;
      return {
        key: d.day,
        label: dayLabel(d.day),
        segments: [{ value: pct, fill: pct > 20 ? YELLOW : BLUE }],
        warn: pct > 20,
        tip: `${dayLabel(d.day)} · ${pct.toFixed(1)}% single-line (${d.singleLine} of ${d.bodies})`,
      };
    }),
  });

  const checks = buildChart({
    id: 'checks',
    format: v => int(v),
    bars: t.checks.map(c => ({
      key: c.workflowId,
      label: dayLabel(c.day),
      segments: [
        { value: c.clean, fill: BLUE },
        { value: c.fixed, fill: GREEN },
        { value: c.unchecked, fill: ORANGE },
        { value: c.notWritten, fill: PURPLE },
      ],
      tip: `${dayLabel(c.day)} · ${c.clean} passed · ${c.fixed} fixed · ${c.unchecked} unchecked · ${c.notWritten} not written`,
    })),
  });

  return { duration: duration_, cost, ingest, failure, singleLine, checks };
});

const hovered = ref<string | null>(null);

// ── 基线说明 ───────────────────────────────────────────────────────────
// 判慢 / 贵的基线要满 5 次已完成的运行；中位数是 null 时告诉读者现在有几次。
// 起算日与 backend 的 BASELINE_START（run-rows.ts）一致，页面只用它数个数。
const BASELINE_MIN_RUNS = 5;
const BASELINE_START = '2026-10-05T00:00:00Z';
const baselineRuns = computed(
  () =>
    (trends.value?.runs ?? []).filter(r => r.finishedAt !== null && (r.status === 'COMPLETED' || r.status === 'DEGRADED') && r.startedAt >= BASELINE_START)
      .length
);
const baselineNote = computed(() => `baseline: ${Math.min(baselineRuns.value, BASELINE_MIN_RUNS - 1)} of ${BASELINE_MIN_RUNS} runs`);

const lastRun = computed(() => trends.value?.runs.at(-1) ?? null);

// ── Worker 报错 ────────────────────────────────────────────────────────
const errorTotals = computed(() => {
  const w = trends.value?.workerErrors;
  if (!w || !Array.isArray(w)) return null;
  const sum = (f: 'backend' | 'aiWorker' | 'mlService') => w.reduce((a, d) => a + d[f], 0);
  const totals = { backend: sum('backend'), aiWorker: sum('aiWorker'), mlService: sum('mlService') };
  return { ...totals, all: totals.backend + totals.aiWorker + totals.mlService };
});

const singleLineMeasuredFrom = computed(() => {
  const ingest = trends.value?.ingest ?? [];
  const first = ingest.find(d => d.singleLine !== null);
  if (!first) return null;
  const recorded = ingest.filter(d => d.singleLine !== null);
  return { day: dayLabel(first.day), single: recorded.reduce((a, d) => a + d.singleLine!, 0), bodies: recorded.reduce((a, d) => a + d.bodies, 0) };
});

const CHECK_LEGEND = [
  { label: 'Passed', color: BLUE },
  { label: 'Fixed by revision', color: GREEN },
  { label: 'Shipped with unchecked sentences', color: ORANGE },
  { label: 'Not written', color: PURPLE },
];
</script>

<template>
  <main class="trends mx-auto flex max-w-[1320px] flex-col gap-5 pb-14 text-sm text-[#0b0b0b]">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Trends</h1>
        <p class="mt-1 text-[#52514e]">Production runs and ingest over time · hover a bar for its value</p>
      </div>
      <div role="group" aria-label="Time range" class="inline-flex gap-0.5 rounded-lg border border-black/10 bg-[#fcfcfb] p-[3px]">
        <button
          v-for="r in RANGES"
          :key="r"
          type="button"
          :aria-pressed="days === r"
          class="min-h-9 cursor-pointer rounded-md px-3.5 py-1.5 text-[13px]"
          :class="days === r ? 'bg-[#0b0b0b] font-medium text-white' : 'text-[#0b0b0b] hover:bg-black/5'"
          @click="days = r"
        >
          {{ r }} days
        </button>
      </div>
    </div>

    <p v-if="error && !data" class="panel text-[#52514e]">
      Not available — the trends could not be loaded ({{ error.statusMessage || error.message }}).
    </p>

    <section v-if="trends && charts" class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))] gap-4">
      <!-- 运行时长、单次成本、每日入库、抓取失败率、单行占比：同一种柱 -->
      <article v-for="spec in [
        { id: 'duration', title: 'Run duration', sub: `minutes · ${trends.medianDurationMs === null ? 'no median yet' : `median ${duration(trends.medianDurationMs)}`}`, empty: 'No production runs in this range.' },
        { id: 'cost', title: 'Cost per production run', sub: 'US$ · sum of every model call in the run', empty: 'No production runs in this range.' },
        { id: 'ingest', title: 'Articles ingested per day', sub: 'Beijing days', empty: '' },
        { id: 'failure', title: 'Fetch failure rate', sub: '% of new articles per day', empty: '' },
        { id: 'singleLine', title: 'Single-line article bodies', sub: '% of new bodies · limit 20%', empty: '' },
      ]" :key="spec.id" :data-chart="spec.id" class="panel min-w-0">
        <div class="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
          <h2 class="text-[15px] font-semibold">{{ spec.title }}</h2>
          <div v-if="spec.id === 'ingest'" class="flex gap-3.5 text-[12.5px] text-[#52514e]">
            <span class="inline-flex items-center gap-1.5"><span class="swatch" style="background: #2a78d6"></span>Processed</span>
            <span class="inline-flex items-center gap-1.5"><span class="swatch" style="background: #eb6834"></span>Failed (fetch + junk)</span>
          </div>
          <span v-else class="text-[12.5px] text-[#52514e]">{{ spec.sub }}</span>
        </div>

        <p v-if="charts[spec.id].bars.length === 0" class="text-[#52514e]">{{ spec.empty }}</p>
        <div v-else class="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2">
          <div class="relative" :style="{ height: `${CHART_HEIGHT}px` }" aria-hidden="true">
            <div
              v-for="t in charts[spec.id].ticks"
              :key="t.y"
              class="absolute right-0 translate-y-1/2 text-[11.5px] text-[#6b6a66] tabular-nums"
              :style="{ bottom: `${t.y}px` }"
            >
              {{ t.label }}
            </div>
          </div>
          <div class="relative border-b border-[#c3c2b7]" :style="{ height: `${CHART_HEIGHT}px` }">
            <div v-for="t in charts[spec.id].ticks" :key="t.y" class="absolute inset-x-0 h-px bg-[#e1e0d9]" :style="{ bottom: `${t.y}px` }"></div>
            <template v-if="charts[spec.id].limit">
              <div class="absolute inset-x-0 border-t-[1.5px] border-[#c58a00]" :style="{ bottom: `${charts[spec.id].limit!.y}px` }"></div>
              <div
                class="absolute right-0 bg-[#fcfcfb] px-1 text-[11.5px] text-[#52514e]"
                :style="{ bottom: `${charts[spec.id].limit!.y + 4}px` }"
              >
                {{ charts[spec.id].limit!.label }}
              </div>
            </template>
            <div class="bars absolute inset-0 flex items-end px-1">
              <div
                v-for="b in charts[spec.id].bars"
                :key="b.key"
                :data-bar="b.key"
                :data-stub="b.stub ? '' : undefined"
                tabindex="0"
                :aria-label="b.tip"
                class="relative flex h-full max-w-[34px] flex-[1_1_0] flex-col items-center justify-end outline-none focus-visible:bg-black/5"
                @mouseenter="hovered = `${spec.id}:${b.key}`"
                @mouseleave="hovered = null"
                @focus="hovered = `${spec.id}:${b.key}`"
                @blur="hovered = null"
              >
                <svg v-if="b.warn" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" class="mb-[3px]">
                  <path d="M6 1 L11.2 10.5 H0.8 Z" fill="#fab219" stroke="#9a6b00" stroke-width="1" stroke-linejoin="round" />
                </svg>
                <div class="flex w-full max-w-[22px] flex-col-reverse" :style="{ gap: `${SEGMENT_GAP}px` }">
                  <div
                    v-for="(s, j) in b.segments"
                    :key="j"
                    :style="{ height: `${s.height}px`, background: s.fill, borderRadius: j === b.segments.length - 1 ? '4px 4px 0 0' : '0' }"
                  ></div>
                </div>
                <div
                  v-if="hovered === `${spec.id}:${b.key}`"
                  role="tooltip"
                  class="absolute z-10 rounded-md bg-[#0b0b0b] px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
                  :class="b.alignRight ? 'right-0' : 'left-0'"
                  :style="{ bottom: `${Math.min(b.stackHeight + (b.warn ? 22 : 8), CHART_HEIGHT - 30)}px` }"
                >
                  {{ b.tip }}
                </div>
              </div>
            </div>
          </div>
          <div></div>
          <div class="flex justify-between px-1 pt-1.5 text-[11.5px] text-[#6b6a66]">
            <span>{{ charts[spec.id].first }}</span>
            <span>{{ charts[spec.id].last }}</span>
          </div>
        </div>

        <p v-if="spec.id === 'duration' && trends.medianDurationMs === null" class="mt-3 text-[12.5px] text-[#52514e]">
          {{ baselineNote }} · slow and costly runs are flagged once the baseline has {{ BASELINE_MIN_RUNS }} runs.
        </p>
        <p v-else-if="spec.id === 'duration'" class="mt-3 text-[12.5px] text-[#52514e]">Yellow above 1.5× the median run time.</p>
        <p v-if="spec.id === 'cost' && trends.medianUsd === null" class="mt-3 text-[12.5px] text-[#52514e]">
          {{ baselineNote }}<template v-if="lastRun?.usd != null"> · last run: {{ usd(lastRun.usd) }}</template>
        </p>
        <p v-else-if="spec.id === 'cost'" class="mt-3 text-[12.5px] text-[#52514e]">
          Yellow above 1.5× the median run cost<template v-if="lastRun?.usd != null"> · last run: {{ usd(lastRun.usd) }}</template>.
        </p>
        <p v-if="spec.id === 'ingest'" class="mt-3 text-[12.5px] text-[#52514e]">Days are Beijing days (UTC+8); the last day is today, so far.</p>
        <p v-if="spec.id === 'failure'" class="mt-3 text-[12.5px] text-[#52514e]">Per-source limit is 30% over 7 days — see Sources.</p>
        <p v-if="spec.id === 'singleLine'" class="mt-3 text-[12.5px] text-[#52514e]">
          Grey stubs: not recorded.
          <template v-if="singleLineMeasuredFrom">
            Measured from {{ singleLineMeasuredFrom.day }} ({{ int(singleLineMeasuredFrom.single) }} of {{ int(singleLineMeasuredFrom.bodies) }} bodies single-line).
          </template>
          <template v-else>No day in this range has recorded bodies yet.</template>
        </p>
      </article>

      <article class="panel flex min-w-0 flex-col gap-4" data-chart="errors-and-checks">
        <section data-panel="worker-errors">
          <h2 class="mb-2 text-[15px] font-semibold">Worker errors · production versions</h2>
          <template v-if="errorTotals">
            <div class="flex flex-wrap items-baseline gap-x-3">
              <span class="text-[40px] leading-[1.1] font-semibold tracking-tight">{{ int(errorTotals.all) }}</span>
              <span class="text-[#52514e]">errors in {{ trends.days }} days across backend, ai-worker, ml-service</span>
            </div>
            <p v-if="errorTotals.all > 0" class="mt-1.5 text-[13px] text-[#52514e] tabular-nums">
              backend {{ int(errorTotals.backend) }} · ai-worker {{ int(errorTotals.aiWorker) }} · ml-service {{ int(errorTotals.mlService) }}
            </p>
            <p class="mt-1.5 text-[12.5px] text-[#6b6a66]">Client disconnects are not counted. Local dev sessions are excluded. Days are UTC.</p>
          </template>
          <p v-else class="font-medium">Not available — {{ reasonOf(trends.workerErrors) }}</p>
        </section>

        <section data-panel="checks" class="border-t border-black/10 pt-3.5">
          <h2 class="mb-2 text-[15px] font-semibold">Check outcomes per run</h2>
          <div v-if="charts.checks.bars.length === 0" class="rounded-lg border border-dashed border-black/20 p-[18px] text-[#52514e]">
            No run in this range has a check record. The first writer–checker run was Oct 5, 21:00.
          </div>
          <template v-else>
            <div class="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px] text-[#52514e]">
              <span v-for="l in CHECK_LEGEND" :key="l.label" class="inline-flex items-center gap-1.5">
                <span class="swatch" :style="{ background: l.color }"></span>{{ l.label }}
              </span>
            </div>
            <div class="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2">
              <div class="relative" :style="{ height: `${CHART_HEIGHT}px` }" aria-hidden="true">
                <div
                  v-for="t in charts.checks.ticks"
                  :key="t.y"
                  class="absolute right-0 translate-y-1/2 text-[11.5px] text-[#6b6a66] tabular-nums"
                  :style="{ bottom: `${t.y}px` }"
                >
                  {{ t.label }}
                </div>
              </div>
              <div class="relative border-b border-[#c3c2b7]" :style="{ height: `${CHART_HEIGHT}px` }">
                <div v-for="t in charts.checks.ticks" :key="t.y" class="absolute inset-x-0 h-px bg-[#e1e0d9]" :style="{ bottom: `${t.y}px` }"></div>
                <div class="bars absolute inset-0 flex items-end px-1">
                  <div
                    v-for="b in charts.checks.bars"
                    :key="b.key"
                    :data-bar="b.key"
                    tabindex="0"
                    :aria-label="b.tip"
                    class="relative flex h-full max-w-[34px] flex-[1_1_0] flex-col items-center justify-end outline-none focus-visible:bg-black/5"
                    @mouseenter="hovered = `checks:${b.key}`"
                    @mouseleave="hovered = null"
                    @focus="hovered = `checks:${b.key}`"
                    @blur="hovered = null"
                  >
                    <div class="flex w-full max-w-[22px] flex-col-reverse" :style="{ gap: `${SEGMENT_GAP}px` }">
                      <div
                        v-for="(s, j) in b.segments"
                        :key="j"
                        :style="{ height: `${s.height}px`, background: s.fill, borderRadius: j === b.segments.length - 1 ? '4px 4px 0 0' : '0' }"
                      ></div>
                    </div>
                    <div
                      v-if="hovered === `checks:${b.key}`"
                      role="tooltip"
                      class="absolute z-10 rounded-md bg-[#0b0b0b] px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
                      :class="b.alignRight ? 'right-0' : 'left-0'"
                      :style="{ bottom: `${Math.min(b.stackHeight + 8, CHART_HEIGHT - 30)}px` }"
                    >
                      {{ b.tip }}
                    </div>
                  </div>
                </div>
              </div>
              <div></div>
              <div class="flex justify-between px-1 pt-1.5 text-[11.5px] text-[#6b6a66]">
                <span>{{ charts.checks.first }}</span>
                <span>{{ charts.checks.last }}</span>
              </div>
            </div>
            <p class="mt-2 text-[12.5px] text-[#52514e]">Only runs with a check record are listed.</p>
          </template>
        </section>
      </article>
    </section>
  </main>
</template>

<style scoped>
.panel {
  border: 1px solid rgb(11 11 11 / 0.1);
  border-radius: 10px;
  background: #fcfcfb;
  padding: 18px 20px;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
/* 90 根柱在手机宽度下也要排得下：间距随视口收窄 */
.bars {
  gap: clamp(1px, 0.5vw, 6px);
}
</style>
