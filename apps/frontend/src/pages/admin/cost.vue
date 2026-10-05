<script lang="ts" setup>
import { USD_PER_1K_NEURONS, type OpsCost, type OpsUnavailable } from '@meridian/contracts';

definePageMeta({ layout: 'admin' });
useSeoMeta({ title: 'Cost · Meridian Ops' });

// 页面只渲染：周期、免费池、账单都是 backend 算好的（apps/backend/src/lib/ops/cost.ts）
const cycle = ref<'current' | 'previous'>('current');
const { data, error } = await useFetch<OpsCost>('/api/admin/ops/cost', { query: { cycle } });
if (error.value?.statusCode === 401) {
  await navigateTo('/admin/login');
}

const CYCLE_BUTTONS = [
  { value: 'current', label: 'Current cycle' },
  { value: 'previous', label: 'Previous cycle' },
] as const;

/** 读不到的块是 `{ unavailable }`：`ok` 取数据（读不到给 null），`reasonOf` 取原因 */
function ok<T extends object>(value: T | OpsUnavailable | undefined): T | null {
  return value && !('unavailable' in value) ? value : null;
}
function reasonOf(value: object | undefined): string {
  return value && 'unavailable' in value ? String(value.unavailable) : '';
}

const account = computed(() => ok(data.value?.account));
const production = computed(() => ok(data.value?.production));
const daily = computed(() => ok(data.value?.daily));
const byModel = computed(() => ok(data.value?.byModel));

// ── 格式 ───────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 账单按 UTC 日：`2026-10-04` → `Oct 4`，不换时区 */
function utcDayLabel(day: string) {
  const [, month, date] = day.split('-').map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
/** 轴刻度用的短写：1.2M / 400k */
function short(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

const cycleRange = computed(() => (data.value ? `${utcDayLabel(data.value.cycle.start)} – ${utcDayLabel(data.value.cycle.end)}` : ''));
const cycleNote = computed(() => {
  const c = data.value?.cycle;
  if (!c) return '';
  return c.complete ? 'closed · compare with the invoice' : `day ${c.day} of ${c.days} · estimate from usage so far`;
});

// ── 模型的颜色与说明 ───────────────────────────────────────────────────
// 颜色跟着模型走、顺序固定（dataviz 的分类色板前五格，浅底上已用校验脚本验过相邻对）；
// 不在流水线里的模型都归到最后一格 Other，不再给新颜色。
const PIPELINE_MODELS = [
  { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', name: 'deepseek-v4-pro', role: 'brief writer', color: '#2a78d6' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'qwen3.8-27b', role: 'sentence checker', color: '#eb6834' },
  { id: '@cf/zai-org/glm-4.7-flash', name: 'glm-4.7-flash', role: 'key points, judging, ranking, titles', color: '#1baf7a' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'qwen3-30b', role: 'article analysis at ingest', color: '#eda100' },
];
const OTHER_SERIES = { id: 'other', name: 'Other models', role: 'not in the pipeline: trials and local development', color: '#e87ba4' };
const SERIES = [...PIPELINE_MODELS, OTHER_SERIES];
const seriesOf = (modelId: string) => PIPELINE_MODELS.find(m => m.id === modelId) ?? OTHER_SERIES;
const modelName = (modelId: string) => PIPELINE_MODELS.find(m => m.id === modelId)?.name ?? modelId.split('/').pop() ?? modelId;

// ── 按日的堆叠柱 ───────────────────────────────────────────────────────
const CHART_HEIGHT = 220;
const SEGMENT_GAP = 2;

/** 不小于 x 的整齐数（1 / 2 / 2.5 / 5 × 10ⁿ） */
function niceCeil(x: number) {
  if (x <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].find(m => m * pow >= x)! * pow;
}

const chart = computed(() => {
  const days = daily.value;
  if (!days) return null;
  const totals = days.map(d => Object.values(d.byModel).reduce((a, b) => a + b, 0));
  // 三格刻度，最高的一天不顶出图外
  const step = niceCeil(Math.max(...totals, 0) / 3);
  const max = step * 3;
  const bars = days.map((d, i) => {
    const values = new Map<string, number>();
    for (const [modelId, neurons] of Object.entries(d.byModel)) {
      const key = seriesOf(modelId).id;
      values.set(key, (values.get(key) ?? 0) + neurons);
    }
    // 自下而上按 SERIES 的固定顺序；有用量的段至少 1px，不让小数被画没
    const segments = SERIES.filter(s => (values.get(s.id) ?? 0) > 0).map(s => ({
      ...s,
      neurons: values.get(s.id)!,
      height: Math.max(1, Math.round((values.get(s.id)! / max) * CHART_HEIGHT)),
    }));
    const stackHeight = segments.reduce((a, s) => a + s.height, 0) + Math.max(0, segments.length - 1) * SEGMENT_GAP;
    return { day: d.day, label: utcDayLabel(d.day), total: totals[i], segments, stackHeight, alignRight: i >= days.length / 2 };
  });
  return {
    bars,
    ticks: [0, 1, 2, 3].map(k => ({ y: Math.round(((k * step) / max) * CHART_HEIGHT), label: short(k * step) })),
    first: bars[0]?.label ?? '',
    last: bars.at(-1)?.label ?? '',
    used: SERIES.filter(s => bars.some(b => b.segments.some(seg => seg.id === s.id))),
  };
});

const hoveredDay = ref<string | null>(null);

// ── 生产与其它 ─────────────────────────────────────────────────────────
const productionSplit = computed(() => {
  const p = production.value;
  const a = account.value;
  if (!p || !a) return null;
  return { ...p, otherNeurons: Math.max(0, a.neurons - p.neurons), otherShare: Math.max(0, 1 - p.share) };
});

const stepTotals = computed(() => {
  const steps = data.value?.lastRunByStep?.steps ?? [];
  return {
    calls: steps.reduce((a, s) => a + s.calls, 0),
    neurons: steps.reduce((a, s) => a + s.neurons, 0),
    usd: steps.reduce((a, s) => a + s.usd, 0),
  };
});

const amount = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 1 : 0 });
</script>

<template>
  <main class="cost mx-auto flex max-w-[1320px] flex-col gap-5 pb-14 text-sm text-[#0b0b0b]">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Cost</h1>
        <p class="mt-1 text-[#52514e]">
          Workers AI model spend per Cloudflare billing cycle · $0.011 per 1,000 neurons after the free pool
        </p>
      </div>
      <div role="group" aria-label="Billing cycle" class="inline-flex gap-0.5 rounded-lg border border-black/10 bg-[#fcfcfb] p-[3px]">
        <button
          v-for="b in CYCLE_BUTTONS"
          :key="b.value"
          type="button"
          :aria-pressed="cycle === b.value"
          class="min-h-9 cursor-pointer rounded-md px-3.5 py-1.5 text-[13px]"
          :class="cycle === b.value ? 'bg-[#0b0b0b] font-medium text-white' : 'text-[#0b0b0b] hover:bg-black/5'"
          @click="cycle = b.value"
        >
          {{ b.label }}
        </button>
      </div>
    </div>

    <p v-if="error && !data" class="panel text-[#52514e]">
      Not available — the cost data could not be loaded ({{ error.statusMessage || error.message }}).
    </p>

    <template v-if="data">
      <section class="flex flex-wrap gap-4">
        <div class="panel min-w-0 flex-[2_1_380px]">
          <h2 class="text-[13px] font-normal text-[#52514e]">Estimated model bill</h2>
          <div v-if="account" class="mt-1 text-5xl leading-tight font-semibold tracking-tight">{{ usd(account.usd) }}</div>
          <p v-else class="mt-2 text-base font-medium">Not available — {{ reasonOf(data.account) }}</p>
          <div class="mt-1 text-[#52514e]">{{ cycleRange }} · {{ cycleNote }}</div>
          <a
            href="https://dash.cloudflare.com/?to=/:account/billing"
            target="_blank"
            rel="noopener"
            class="mt-2.5 inline-block font-medium text-[#1c5cab] underline underline-offset-2 hover:text-[#104281]"
          >
            Compare with the Cloudflare invoice ↗
          </a>
        </div>
        <template v-if="account">
          <div class="panel flex-[1_1_170px]">
            <div class="text-[13px] text-[#52514e]">Neurons used</div>
            <div class="mt-1.5 text-2xl font-semibold">{{ int(account.neurons) }}</div>
          </div>
          <div class="panel flex-[1_1_170px]">
            <div class="text-[13px] text-[#52514e]">Free pool</div>
            <div class="mt-1.5 text-2xl font-semibold">{{ int(account.freePool) }}</div>
            <div class="mt-0.5 text-[12.5px] text-[#6b6a66]">10,000 × {{ data.cycle.days }} days</div>
          </div>
          <div class="panel flex-[1_1_170px]">
            <div class="text-[13px] text-[#52514e]">Billable neurons</div>
            <div class="mt-1.5 text-2xl font-semibold">{{ int(account.billable) }}</div>
          </div>
          <div class="panel flex-[1_1_170px]">
            <div class="text-[13px] text-[#52514e]">Workers Paid plan</div>
            <div class="mt-1.5 text-2xl font-semibold">{{ usd(account.planFeeUsd) }}</div>
            <div class="mt-0.5 text-[12.5px] text-[#6b6a66]">fixed, per cycle</div>
          </div>
        </template>
      </section>

      <section class="panel">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h2 class="text-base font-semibold">Production vs everything else</h2>
          <span class="text-[13px] text-[#52514e]">
            Production = daily brief runs + article analysis at ingest. The rest is local development and model trials.
          </span>
        </div>
        <template v-if="productionSplit">
          <div class="flex h-[26px] gap-0.5 overflow-hidden rounded">
            <div class="min-w-1.5 bg-[#2a78d6]" :style="{ width: `${(productionSplit.share * 100).toFixed(1)}%` }"></div>
            <div class="flex-1 bg-[#eb6834]"></div>
          </div>
          <div class="mt-2.5 flex flex-wrap justify-between gap-x-6 gap-y-2">
            <span class="inline-flex flex-wrap items-center gap-2">
              <span class="swatch bg-[#2a78d6]"></span>
              <strong class="font-semibold">Production ≈ {{ pct(productionSplit.share) }}</strong>
              <span class="text-[#52514e]">
                ≈ {{ int(productionSplit.neurons) }} neurons · {{ productionSplit.runs }} brief runs
                {{ int(productionSplit.runNeurons) }} · article analysis {{ int(productionSplit.analysisNeurons) }}
              </span>
            </span>
            <span class="inline-flex flex-wrap items-center gap-2">
              <span class="swatch bg-[#eb6834]"></span>
              <strong class="font-semibold">Everything else ≈ {{ pct(productionSplit.otherShare) }}</strong>
              <span class="text-[#52514e]">≈ {{ int(productionSplit.otherNeurons) }} neurons</span>
            </span>
          </div>
          <p class="mt-3 text-[12.5px] text-[#52514e]">
            Approximation: brief runs count only runs with a recorded summary, and article analysis is all account usage of
            qwen3-30b in the cycle, including any local use of that model.
          </p>
        </template>
        <p v-else class="font-medium">Not available — {{ reasonOf(data.production) || reasonOf(data.account) }}</p>
      </section>

      <section class="panel">
        <div class="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h2 class="text-base font-semibold">Daily usage by model</h2>
          <div v-if="chart" class="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-[#52514e]">
            <span v-for="s in chart.used" :key="s.id" class="inline-flex items-center gap-1.5">
              <span class="swatch" :style="{ background: s.color }"></span>{{ s.name }}
            </span>
          </div>
        </div>
        <template v-if="chart">
          <div class="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2">
            <div class="relative" :style="{ height: `${CHART_HEIGHT}px` }" aria-hidden="true">
              <div
                v-for="t in chart.ticks"
                :key="t.y"
                class="absolute right-0 translate-y-1/2 text-[11.5px] text-[#6b6a66] tabular-nums"
                :style="{ bottom: `${t.y}px` }"
              >
                {{ t.label }}
              </div>
            </div>
            <div class="relative border-b border-[#c3c2b7]" :style="{ height: `${CHART_HEIGHT}px` }">
              <div
                v-for="t in chart.ticks"
                :key="t.y"
                class="absolute inset-x-0 h-px bg-[#e1e0d9]"
                :style="{ bottom: `${t.y}px` }"
              ></div>
              <div class="bars absolute inset-0 flex items-end justify-start px-1">
                <!-- 整个竖槽都是悬停 / 聚焦的目标，比柱子本身大 -->
                <div
                  v-for="b in chart.bars"
                  :key="b.day"
                  :data-day="b.day"
                  tabindex="0"
                  :aria-label="`${b.label}: ${int(b.total)} neurons`"
                  class="relative flex h-full max-w-[34px] flex-[1_1_0] flex-col items-center justify-end outline-none focus-visible:bg-black/5"
                  @mouseenter="hoveredDay = b.day"
                  @mouseleave="hoveredDay = null"
                  @focus="hoveredDay = b.day"
                  @blur="hoveredDay = null"
                >
                  <div class="flex w-full max-w-[22px] flex-col-reverse" :style="{ gap: `${SEGMENT_GAP}px` }">
                    <div
                      v-for="(s, j) in b.segments"
                      :key="s.id"
                      :style="{
                        height: `${s.height}px`,
                        background: s.color,
                        borderRadius: j === b.segments.length - 1 ? '4px 4px 0 0' : '0',
                      }"
                    ></div>
                  </div>
                  <div
                    v-if="hoveredDay === b.day"
                    role="tooltip"
                    class="absolute z-10 rounded-md bg-[#0b0b0b] px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
                    :class="b.alignRight ? 'right-0' : 'left-0'"
                    :style="{ bottom: `${Math.min(b.stackHeight + 8, CHART_HEIGHT - 60)}px` }"
                  >
                    <div>
                      <strong class="font-semibold">{{ int(b.total) }}</strong> neurons · {{ b.label }} ·
                      {{ usd((b.total * USD_PER_1K_NEURONS) / 1000) }} at list price
                    </div>
                    <div v-for="s in [...b.segments].reverse()" :key="s.id" class="mt-0.5 flex items-center gap-1.5">
                      <span class="swatch" :style="{ background: s.color }"></span>
                      <strong class="font-semibold tabular-nums">{{ int(s.neurons) }}</strong>
                      <span class="text-white/75">{{ s.name }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div></div>
            <div class="flex justify-between px-1 pt-1.5 text-[11.5px] text-[#6b6a66]">
              <span>{{ chart.first }}</span>
              <span>{{ chart.last }}</span>
            </div>
          </div>
          <p class="mt-3 text-[12.5px] text-[#52514e]">
            Days are UTC, as on the invoice. The cycle runs from the 4th to the 3rd, not by calendar month.
          </p>
        </template>
        <p v-else class="font-medium">Not available — {{ reasonOf(data.daily) }}</p>
      </section>

      <div class="flex flex-wrap gap-4">
        <section class="panel min-w-0 flex-[1_1_480px]">
          <h2 class="mb-2.5 text-base font-semibold">By model · this cycle</h2>
          <div v-if="byModel" class="overflow-x-auto">
            <table class="w-full min-w-[420px] border-collapse text-[13.5px]">
              <thead>
                <tr class="text-left text-[12.5px] text-[#52514e]">
                  <th scope="col" class="cell-head pr-2.5">Model</th>
                  <th scope="col" class="cell-head px-2.5 text-right">Neurons</th>
                  <th scope="col" class="cell-head px-2.5 text-right">Share</th>
                  <th scope="col" class="cell-head pl-2.5 text-right">At list price</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in byModel" :key="m.modelId">
                  <td class="cell pr-2.5">
                    <span class="inline-flex items-center gap-2">
                      <span class="swatch flex-none" :style="{ background: seriesOf(m.modelId).color }"></span>
                      {{ modelName(m.modelId) }}
                    </span>
                    <div class="pl-[18px] text-xs text-[#6b6a66]">{{ seriesOf(m.modelId).role }}</div>
                  </td>
                  <td class="cell px-2.5 text-right tabular-nums">{{ int(m.neurons) }}</td>
                  <td class="cell px-2.5 text-right tabular-nums">{{ pct(m.share) }}</td>
                  <td class="cell pl-2.5 text-right tabular-nums">{{ usd(m.usdAtList) }}</td>
                </tr>
                <tr v-if="byModel.length === 0">
                  <td colspan="4" class="cell pr-2.5 text-[#52514e]">No model usage in this cycle yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="font-medium">Not available — {{ reasonOf(data.byModel) }}</p>
        </section>

        <section class="panel min-w-0 flex-[1_1_420px]">
          <h2 class="mb-1 text-base font-semibold">Last production run, by step</h2>
          <template v-if="data.lastRunByStep">
            <p class="mb-2.5 text-[13px] text-[#52514e]">
              {{ beijingDate(data.lastRunByStep.day) }} ·
              <NuxtLink :to="`/admin/runs/${data.lastRunByStep.workflowId}`" class="text-[#1c5cab] hover:text-[#104281]">{{
                data.lastRunByStep.workflowId
              }}</NuxtLink>
              · exact, summed from every recorded call · article analysis at ingest is not part of a run
            </p>
            <table class="w-full border-collapse text-[13.5px]">
              <thead>
                <tr class="text-left text-[12.5px] text-[#52514e]">
                  <th scope="col" class="cell-head pr-2.5">Step</th>
                  <th scope="col" class="cell-head px-2.5 text-right">Calls</th>
                  <th scope="col" class="cell-head px-2.5 text-right">Neurons</th>
                  <th scope="col" class="cell-head pl-2.5 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in data.lastRunByStep.steps" :key="s.phase">
                  <td class="cell pr-2.5">{{ s.phase }}</td>
                  <td class="cell px-2.5 text-right tabular-nums">{{ int(s.calls) }}</td>
                  <td class="cell px-2.5 text-right tabular-nums">{{ int(s.neurons) }}</td>
                  <td class="cell pl-2.5 text-right tabular-nums">{{ usd(s.usd, 3) }}</td>
                </tr>
                <tr class="font-semibold">
                  <td class="py-2 pr-2.5">Total</td>
                  <td class="px-2.5 py-2 text-right tabular-nums">{{ int(stepTotals.calls) }}</td>
                  <td class="px-2.5 py-2 text-right tabular-nums">{{ int(stepTotals.neurons) }}</td>
                  <td class="py-2 pl-2.5 text-right tabular-nums">{{ usd(stepTotals.usd, 3) }}</td>
                </tr>
              </tbody>
            </table>
          </template>
          <p v-else class="text-[#52514e]">No production run has a recorded summary yet.</p>
        </section>
      </div>

      <section class="panel">
        <div class="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h2 class="text-base font-semibold">Other Cloudflare items · share of free allowance</h2>
          <span class="text-[13px] text-[#52514e]">
            Shown as usage, not dollars · monthly allowances of the Workers Paid plan, compared with this cycle
          </span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-8 gap-y-2.5">
          <div v-for="o in data.otherItems" :key="o.name" class="flex flex-col gap-1">
            <div class="flex justify-between gap-2 text-[13px]">
              <span>{{ o.name }}</span>
              <span v-if="o.used !== null && o.share !== null && o.allowance !== null" class="text-[#52514e] tabular-nums">
                <strong class="font-semibold text-[#0b0b0b]">{{ pct(o.share) }}</strong>
                · {{ amount(o.used) }} of {{ amount(o.allowance) }} {{ o.unit }}
              </span>
              <span v-else class="text-[#6b6a66]">
                not available<template v-if="o.allowance !== null"> · allowance {{ amount(o.allowance) }} {{ o.unit }}</template>
              </span>
            </div>
            <!-- 量表：底轨是同一色阶的浅一档；读不到时只有底轨 -->
            <div class="h-2 overflow-hidden rounded-r bg-[#e6eef9]">
              <div
                v-if="o.share !== null"
                class="h-full rounded-r bg-[#2a78d6]"
                :style="{ width: `${Math.min(100, o.share * 100).toFixed(2)}%`, minWidth: o.share > 0 ? '2px' : '0' }"
              ></div>
            </div>
          </div>
        </div>
      </section>
    </template>
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
/* 表格单元格：左右内边距由各格的工具类给（首尾两列贴边） */
.cell-head {
  border-bottom: 1px solid rgb(11 11 11 / 0.1);
  padding-block: 8px;
  font-weight: 500;
}
.cell {
  border-bottom: 1px solid rgb(11 11 11 / 0.06);
  padding-block: 8px;
}
/* 31 根柱在手机宽度下也要排得下：间距随视口收窄 */
.bars {
  gap: clamp(2px, 0.6vw, 6px);
}
</style>
