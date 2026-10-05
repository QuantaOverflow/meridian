<script lang="ts" setup>
import type { OpsAttentionLink, OpsHealth, OpsLevel, OpsRunRow, OpsServiceName, OpsSourceKind, OpsUnavailable } from '@meridian/contracts';
import { beijingDate, beijingDateTime, beijingTime } from '~/utils/beijingTime';

definePageMeta({ layout: 'admin' });
useSeoMeta({ title: 'Health · Meridian Ops' });

// 页面只渲染：每个灯、每行待处理都是 backend 判好的（apps/backend/src/lib/ops/health.ts）。
// 只在打开页面时取一次，不轮询、不自动刷新：读 ml-service 的健康会唤醒它的容器并重置 10 分钟的休眠计时。
const { data, error } = await useFetch<OpsHealth>('/api/admin/ops/health');
if (error.value?.statusCode === 401) {
  await navigateTo('/admin/login');
}

function ok<T extends object>(value: T | OpsUnavailable | undefined): T | null {
  return value && !('unavailable' in value) ? value : null;
}
function reasonOf(value: object | undefined): string {
  return value && 'unavailable' in value ? String(value.unavailable) : '';
}

// ── 格式 ───────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 账单按 UTC 日：`2026-10-04` → `Oct 4`，不换时区 */
function utcDayLabel(day: string) {
  const [, month, date] = day.split('-').map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (n: number | null) => (n === null ? '—' : int(n));
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%');
function duration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
const cost = (usd: number | null) => (usd === null ? 'not recorded' : `$${usd.toFixed(3)}`);

// ── 状态的文字与图形（图形 + 文字，不只靠颜色）─────────────────────────
type Icon = 'ok' | 'yellow' | 'red' | 'pending' | 'paused';
const PILL: Record<OpsLevel, { label: string; bg: string }> = {
  ok: { label: 'OK', bg: 'bg-[#e8f5e8]' },
  yellow: { label: 'Warn', bg: 'bg-[#fff3d6]' },
  red: { label: 'Problem', bg: 'bg-[#fbeaea]' },
};
const STATUS_LABEL: Record<OpsRunRow['status'], string> = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  DEGRADED: 'Degraded',
  FAILED: 'Failed',
  BLOCKED_FAITHFULNESS: 'Blocked',
  TERMINATED_NO_STORIES: 'No stories',
};
/** 运行行的状态：运行状态 + 状态本身没说出来的标记（慢、贵、迟） */
function runLabel(run: OpsRunRow): string {
  const extra = run.flags.filter(f => f === 'slow' || f === 'costly' || f === 'late');
  return [STATUS_LABEL[run.status], ...extra].join(' · ');
}
const runIcon = (run: OpsRunRow): Icon => (run.status === 'RUNNING' && run.level === 'ok' ? 'pending' : run.level);

// ── 今天 ───────────────────────────────────────────────────────────────
const today = computed(() => data.value?.today);
/** 基线不满时不判慢 / 贵，页面上要说出来 */
const baselineNote = computed(() => {
  const t = today.value;
  return t && t.baselineRuns < t.baselineMin ? `baseline: ${t.baselineRuns} of ${t.baselineMin} runs` : null;
});
const typicalNote = computed(() => {
  const t = today.value;
  if (!t) return '';
  return t.medianDurationMs === null ? (baselineNote.value ?? '') : `Typical run ${duration(t.medianDurationMs)}`;
});

const todayCard = computed(() => {
  const t = today.value;
  if (!t) return null;
  if (t.run) {
    const r = t.run;
    const running = r.status === 'RUNNING';
    return {
      pill: running && t.level === 'ok' ? { label: 'Running', bg: 'bg-[#efeeea]', icon: 'pending' as Icon } : { ...PILL[t.level], icon: t.level as Icon },
      headline: running ? `Running since ${beijingTime(r.startedAt)}` : runLabel(r),
      sub: running
        ? `${typicalNote.value} · red if not done by 22:00`
        : `${duration(r.durationMs)} · ${num(r.blocks)} blocks · ${cost(r.usd)}`,
    };
  }
  if (t.state === 'scheduled') {
    return {
      pill: { label: 'Scheduled', bg: 'bg-[#efeeea]', icon: 'pending' as Icon },
      headline: 'Runs at 21:00',
      sub: `${typicalNote.value} · red if not done by 22:00`,
    };
  }
  return {
    pill: { ...PILL.red, icon: 'red' as Icon },
    headline: 'No brief today',
    sub: 'No production run has started · it was due at 21:00',
  };
});
/** 卡片下半：今天有运行就连到它；还没有就显示上一次 */
const todayFooter = computed(() => {
  const t = today.value;
  if (!t) return null;
  if (t.run) return { run: t.run, isToday: true };
  const last = data.value?.runs[0];
  return last ? { run: last, isToday: false } : null;
});

// ── 入库 ───────────────────────────────────────────────────────────────
const ingest = computed(() => data.value?.ingest24h);

// ── 服务 ───────────────────────────────────────────────────────────────
const HEALTH_LABEL = { healthy: 'healthy', unhealthy: 'unhealthy', unknown: 'could not be reached' };
const workerErrors = computed(() => ok(data.value?.workerErrors24h));
const workerErrorTotal = computed(() => {
  const e = workerErrors.value;
  return e ? (Object.keys(e) as OpsServiceName[]).reduce((sum, k) => sum + e[k], 0) : null;
});
const servicesLevel = computed<OpsLevel>(() => {
  const unhealthy = (data.value?.services ?? []).some(s => s.health !== 'healthy');
  return unhealthy || (workerErrorTotal.value ?? 0) > 0 ? 'yellow' : 'ok';
});

// ── 来源 ───────────────────────────────────────────────────────────────
const KIND_TEXT: Record<OpsSourceKind, string> = {
  not_checked: 'not checked',
  dead_feed: 'dead feed',
  fetch_failing: 'fetch failing',
  bad_body: 'bad body format',
  paused: 'paused',
  ok: 'OK',
};
const KIND_ICON: Record<OpsSourceKind, Icon> = {
  not_checked: 'red',
  dead_feed: 'red',
  fetch_failing: 'yellow',
  bad_body: 'yellow',
  paused: 'paused',
  ok: 'ok',
};
const PROBLEM_KINDS: OpsSourceKind[] = ['not_checked', 'dead_feed', 'fetch_failing', 'bad_body'];
const sourcesCard = computed(() => {
  const s = data.value?.sources;
  if (!s) return null;
  const problems = PROBLEM_KINDS.filter(k => s.counts[k] > 0);
  const level: OpsLevel = problems.some(k => KIND_ICON[k] === 'red') ? 'red' : problems.length > 0 ? 'yellow' : 'ok';
  const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
  return {
    level,
    headline: problems.length > 0 ? `${s.counts[problems[0]]} ${KIND_TEXT[problems[0]]}` : `All ${total - s.counts.paused} active OK`,
    rest: problems.slice(1).map(k => ({ kind: k, text: `${s.counts[k]} ${KIND_TEXT[k]}` })),
    tail: `${s.counts.paused} paused · ${s.counts.ok} OK`,
    worst: s.worst,
  };
});

// ── 待处理 ─────────────────────────────────────────────────────────────
function attentionTarget(link: OpsAttentionLink): { to: string; label: string } {
  if (typeof link === 'object') return { to: `/admin/runs/${encodeURIComponent(link.run)}`, label: 'Run' };
  return { trends: { to: '/admin/trends', label: 'Trends' }, cost: { to: '/admin/cost', label: 'Cost' }, sources: { to: '/admin/sources', label: 'Sources' } }[link];
}

// ── 花费 ───────────────────────────────────────────────────────────────
const spend = computed(() => ok(data.value?.spend));

// ── 运行表：耗时条共用一个刻度，竖线标中位数 ──────────────────────────
const runsTable = computed(() => {
  const runs = data.value?.runs ?? [];
  const t = today.value;
  const median = t?.medianDurationMs ?? null;
  const max = Math.max(1, ...runs.map(r => r.durationMs ?? 0), t?.slowAboveMs ?? 0);
  return {
    medianLeft: median === null ? null : (median / max) * 100,
    rows: runs.map(r => ({
      run: r,
      width: r.durationMs === null ? 0 : Math.max(0.8, (r.durationMs / max) * 100),
      // 条的颜色跟这行的灯走；状态列有图形和文字，颜色不是唯一的线索
      fill: r.level === 'red' ? '#d03b3b' : r.level === 'yellow' ? '#fab219' : '#2a78d6',
    })),
  };
});
</script>

<template>
  <main class="mx-auto flex max-w-[1320px] flex-col gap-5 pb-14 text-sm text-[#0b0b0b]">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Health</h1>
        <p class="mt-1 text-[#52514e]">
          <template v-if="data">{{ beijingDate(data.generatedAt) }} · </template>production runs only
        </p>
      </div>
      <p v-if="data" class="text-[13px] text-[#52514e]" data-test="updated">
        Beijing time (UTC+8) · updated {{ beijingTime(data.generatedAt) }} · reload the page to refresh
      </p>
    </div>

    <p v-if="error && !data" class="panel text-[#52514e]" data-test="load-error">
      Not available — the health data could not be loaded ({{ error.statusMessage || error.message }}).
    </p>

    <template v-if="data">
      <section aria-label="Now" class="grid grid-cols-[repeat(auto-fit,minmax(min(270px,100%),1fr))] gap-4">
        <!-- 今天的简报 -->
        <article v-if="todayCard" class="panel card" data-test="today">
          <div class="card-head">
            <h2 class="text-sm font-semibold">Today's brief</h2>
            <span class="pill" :class="todayCard.pill.bg" data-test="pill"><OpsStatusIcon :kind="todayCard.pill.icon" />{{ todayCard.pill.label }}</span>
          </div>
          <div>
            <div class="headline">{{ todayCard.headline }}</div>
            <div class="mt-0.5 text-[#52514e]">{{ todayCard.sub }}</div>
          </div>
          <div v-if="todayFooter" class="card-foot">
            <template v-if="!todayFooter.isToday">
              <div class="flex items-center gap-2">
                <OpsStatusIcon :kind="runIcon(todayFooter.run)" />
                <span class="font-medium">{{ beijingDate(todayFooter.run.startedAt) }} · {{ runLabel(todayFooter.run) }}</span>
              </div>
              <div class="text-[#52514e]">
                {{ duration(todayFooter.run.durationMs) }} · {{ num(todayFooter.run.blocks) }} blocks · {{ cost(todayFooter.run.usd) }}
              </div>
            </template>
            <div v-else-if="baselineNote" class="text-[#52514e]">{{ baselineNote }} · slow and costly are not judged yet</div>
            <NuxtLink :to="`/admin/runs/${encodeURIComponent(todayFooter.run.workflowId)}`" class="link">
              Open {{ todayFooter.isToday ? "today's" : beijingDate(todayFooter.run.startedAt) }} run →
            </NuxtLink>
          </div>
        </article>

        <!-- 近 24 小时入库 -->
        <article v-if="ingest" class="panel card" data-test="ingest">
          <div class="card-head">
            <h2 class="text-sm font-semibold">Ingest · last 24 h</h2>
            <span class="pill" :class="PILL[ingest.level].bg" data-test="pill"><OpsStatusIcon :kind="ingest.level" />{{ PILL[ingest.level].label }}</span>
          </div>
          <div>
            <div class="headline">{{ int(ingest.processed) }} processed</div>
            <div class="mt-0.5 text-[#52514e]">
              {{ int(ingest.fetchFailed) }} failed ({{ pct(ingest.fetchFailed, ingest.processed) }}) · {{ int(ingest.junk) }} junk pages ·
              {{ int(ingest.viaBrowser) }} via browser ({{ pct(ingest.viaBrowser, ingest.processed) }})
            </div>
          </div>
          <div class="card-foot">
            <div class="flex items-center gap-2">
              <OpsStatusIcon :kind="ingest.level" />
              <span class="font-medium">
                <template v-if="ingest.bodies > 0">{{ pct(ingest.singleLine, ingest.bodies) }} of bodies are one line</template>
                <template v-else>No body line counts recorded</template>
              </span>
            </div>
            <div class="text-[#52514e]">{{ int(ingest.singleLine) }} of {{ int(ingest.bodies) }} · limit 20%</div>
            <NuxtLink to="/admin/trends" class="link">See trend →</NuxtLink>
          </div>
        </article>

        <!-- 服务 -->
        <article class="panel card" data-test="services">
          <div class="card-head">
            <h2 class="text-sm font-semibold">Services</h2>
            <span class="pill" :class="PILL[servicesLevel].bg" data-test="pill"><OpsStatusIcon :kind="servicesLevel" />{{ PILL[servicesLevel].label }}</span>
          </div>
          <div class="flex flex-col gap-2.5">
            <div v-for="s in data.services" :key="s.service" class="flex min-w-0 flex-col gap-px" :data-service="s.service">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="min-w-[82px] font-medium">{{ s.service }}</span>
                <span class="font-mono text-[12.5px]">{{ s.commit ?? 'no commit recorded' }}<template v-if="s.dirty"> (dirty)</template></span>
                <span class="ml-auto text-[12.5px] text-[#52514e]">{{ s.deployedAt ? beijingDateTime(s.deployedAt) : '' }}</span>
              </div>
              <div v-if="s.title" class="truncate text-[12.5px] text-[#6b6a66]">{{ s.title }}</div>
              <div class="flex items-center gap-1.5 text-[12.5px]" :class="s.health === 'healthy' ? 'text-[#6b6a66]' : 'font-medium'">
                <OpsStatusIcon :kind="s.health === 'healthy' ? 'ok' : 'yellow'" :size="10" />{{ HEALTH_LABEL[s.health] }}
              </div>
            </div>
          </div>
          <div class="card-foot" data-test="worker-errors">
            <div v-if="workerErrors" class="flex items-center gap-2">
              <OpsStatusIcon :kind="workerErrorTotal ? 'yellow' : 'ok'" />
              <span>
                Worker errors, 24 h: <strong class="font-semibold">{{ int(workerErrorTotal ?? 0) }}</strong>
                <template v-if="workerErrorTotal">
                  (backend {{ workerErrors.backend }} · ai-worker {{ workerErrors['ai-worker'] }} · ml-service {{ workerErrors['ml-service'] }})
                </template>
              </span>
            </div>
            <div v-else>Worker errors, 24 h: Not available — {{ reasonOf(data.workerErrors24h) }}</div>
          </div>
        </article>

        <!-- 来源 -->
        <article v-if="sourcesCard" class="panel card" data-test="sources">
          <div class="card-head">
            <h2 class="text-sm font-semibold">Sources</h2>
            <span class="pill" :class="PILL[sourcesCard.level].bg" data-test="pill"><OpsStatusIcon :kind="sourcesCard.level" />{{ PILL[sourcesCard.level].label }}</span>
          </div>
          <div>
            <div class="headline">{{ sourcesCard.headline }}</div>
            <div v-for="r in sourcesCard.rest" :key="r.kind" class="mt-1 flex items-center gap-2">
              <OpsStatusIcon :kind="KIND_ICON[r.kind]" /><span>{{ r.text }}</span>
            </div>
          </div>
          <div class="card-foot">
            <div v-for="w in sourcesCard.worst" :key="w.id" class="flex min-w-0 items-start gap-2">
              <OpsStatusIcon :kind="KIND_ICON[w.kind]" class="mt-1" />
              <span class="min-w-0"><span class="font-medium">{{ w.name }}</span> <span class="text-[#52514e]">· {{ w.detail }}</span></span>
            </div>
            <div class="flex items-center gap-2"><OpsStatusIcon kind="paused" /><span>{{ sourcesCard.tail }}</span></div>
            <NuxtLink to="/admin/sources" class="link">All sources →</NuxtLink>
          </div>
        </article>
      </section>

      <section class="flex flex-wrap items-stretch gap-4">
        <div class="panel flex min-w-0 flex-[999_1_560px] flex-col gap-1" data-test="attention">
          <h2 class="mb-2 text-base font-semibold">Needs attention</h2>
          <NuxtLink
            v-for="(a, i) in data.attention"
            :key="i"
            :to="attentionTarget(a.link).to"
            class="-mx-2.5 flex min-h-11 items-start gap-3 rounded-lg px-2.5 py-3 text-[#0b0b0b] no-underline hover:bg-black/[0.04]"
            :data-level="a.level"
            data-test="attention-line"
          >
            <OpsStatusIcon :kind="a.level" :size="14" class="mt-[3px]" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="font-medium">
                <span class="sr-only">{{ a.level === 'red' ? 'Problem: ' : 'Warning: ' }}</span>{{ a.title }}
              </span>
              <span class="break-words text-[#52514e]">{{ a.detail }}</span>
            </span>
            <span class="ml-auto whitespace-nowrap font-medium text-[#1c5cab]">{{ attentionTarget(a.link).label }} →</span>
          </NuxtLink>
          <div class="mt-1 border-t border-black/[0.08] pt-2 text-[13px] text-[#6b6a66]">
            {{ data.attention.length > 0 ? 'Everything else is within limits.' : 'Everything is within limits.' }}
          </div>
        </div>

        <div class="panel flex flex-[1_1_300px] flex-col gap-2.5" data-test="spend">
          <h2 class="text-base font-semibold">Model spend · this billing cycle</h2>
          <template v-if="spend">
            <div class="text-[44px] leading-[1.05] font-semibold tracking-tight">${{ spend.usd.toFixed(2) }}</div>
            <div class="text-[#52514e]">
              {{ utcDayLabel(spend.cycleStart) }} – {{ utcDayLabel(spend.cycleEnd) }} · day {{ spend.day }} of {{ spend.days }} · estimate from usage
            </div>
            <div class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-black/[0.08] pt-2 text-[13px]">
              <span class="text-[#52514e]">Neurons used</span><span class="text-right tabular-nums">{{ int(spend.neurons) }}</span>
              <span class="text-[#52514e]">Free pool</span><span class="text-right tabular-nums">− {{ int(spend.freePool) }}</span>
              <span class="text-[#52514e]">Production share</span>
              <span class="text-right tabular-nums">{{ spend.productionShare === null ? '—' : `${(spend.productionShare * 100).toFixed(1)}%` }}</span>
            </div>
          </template>
          <p v-else class="font-medium">Not available — {{ reasonOf(data.spend) }}</p>
          <NuxtLink to="/admin/cost" class="link">Cost breakdown →</NuxtLink>
        </div>
      </section>

      <section aria-labelledby="runs-h" class="panel" data-test="runs">
        <div class="mb-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="runs-h" class="text-base font-semibold">Last 14 production runs</h2>
          <span class="text-[13px] text-[#52514e]" data-test="baseline">
            <template v-if="today && today.medianDurationMs !== null">
              Median {{ duration(today.medianDurationMs) }} · slow above {{ duration(today.slowAboveMs) }} (1.5×)
            </template>
            <template v-else-if="baselineNote">{{ baselineNote }} · slow and costly are not judged yet</template>
          </span>
        </div>
        <p v-if="runsTable.rows.length === 0" class="text-[#52514e]">No production run in the last 30 days.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[820px] border-collapse text-[13.5px]">
            <thead>
              <tr class="text-left text-[12.5px] text-[#52514e]">
                <th scope="col" class="cell-head pr-2.5">Run</th>
                <th scope="col" class="cell-head px-2.5">Status</th>
                <th scope="col" class="cell-head w-[34%] px-2.5">Duration</th>
                <th scope="col" class="cell-head px-2.5 text-right">Articles</th>
                <th scope="col" class="cell-head px-2.5 text-right">Stories</th>
                <th scope="col" class="cell-head px-2.5 text-right">Model calls</th>
                <th scope="col" class="cell-head pl-2.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in runsTable.rows" :key="row.run.workflowId" :data-run="row.run.workflowId" :data-level="row.run.level">
                <td class="cell pr-2.5 whitespace-nowrap">
                  <NuxtLink :to="`/admin/runs/${encodeURIComponent(row.run.workflowId)}`" class="link">{{ beijingDate(row.run.startedAt) }}</NuxtLink>
                  <span class="text-[#6b6a66]"> · {{ beijingTime(row.run.startedAt) }}</span>
                </td>
                <td class="cell px-2.5 whitespace-nowrap">
                  <span class="inline-flex items-center gap-1.5"><OpsStatusIcon :kind="runIcon(row.run)" />{{ runLabel(row.run) }}</span>
                </td>
                <td class="cell px-2.5">
                  <div class="flex items-center gap-3">
                    <div class="relative h-2 min-w-[120px] flex-1 rounded-r bg-[#eeede8]">
                      <div class="h-2 rounded-r" :style="{ width: `${row.width.toFixed(2)}%`, background: row.fill }"></div>
                      <div
                        v-if="runsTable.medianLeft !== null"
                        class="absolute -top-1 h-4 w-px bg-[#52514e]"
                        :style="{ left: `${runsTable.medianLeft.toFixed(2)}%` }"
                      ></div>
                    </div>
                    <span class="min-w-[60px] text-right tabular-nums">{{ duration(row.run.durationMs) }}</span>
                  </div>
                </td>
                <td class="cell px-2.5 text-right tabular-nums">{{ num(row.run.articles) }}</td>
                <td class="cell px-2.5 text-right tabular-nums">{{ num(row.run.stories) }}</td>
                <td class="cell px-2.5 text-right tabular-nums" :class="row.run.calls === null ? 'text-[#6b6a66]' : ''">
                  {{ row.run.calls === null ? 'not recorded' : int(row.run.calls) }}
                </td>
                <td class="cell pl-2.5 text-right tabular-nums" :class="row.run.usd === null ? 'text-[#6b6a66]' : ''">{{ cost(row.run.usd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="runsTable.medianLeft !== null" class="mt-2.5 text-[12.5px] text-[#6b6a66]">
          Bars share one scale. The vertical tick on each bar marks the median of the baseline runs.
        </p>
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
.card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid rgb(11 11 11 / 0.08);
  padding-top: 12px;
}
.headline {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 3px 10px 3px 8px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}
.link {
  color: #1c5cab;
  font-weight: 500;
  text-decoration: none;
}
.link:hover {
  color: #104281;
  text-decoration: underline;
}
.cell-head {
  border-bottom: 1px solid rgb(11 11 11 / 0.1);
  padding-block: 8px;
  font-weight: 500;
}
.cell {
  border-bottom: 1px solid rgb(11 11 11 / 0.06);
  padding-block: 9px;
}
</style>
