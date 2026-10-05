import { $brief_runs, and, gte, sql } from '@meridian/database';
import { USD_PER_1K_NEURONS, type OpsRunFlag, type OpsRunRow } from '@meridian/contracts';
import type { Db } from '../reader/db';

/**
 * 运维台里「一次生产运行」这一行怎么来：从 brief_runs 取定时触发的运行，判红黄灯。
 * 健康页、趋势页、运行详情页共用这一份，判据只写在这里（阈值上线后要调，改常量即可）。
 */

/** 生产运行 = 定时触发的那次（workflow id 由 cron 入口生成）；手动运行不算进流水线健康 */
export const PRODUCTION_RUN_ID_PREFIX = 'cron-brief-';

/**
 * 判「慢 / 贵」只跟这一天之后的运行比。2026-10-05 写作–核查循环上线，一期从约 17 分钟、两三千 neurons
 * 变成约 30 分钟、八万多 neurons；拿上线前的运行当基线，之后每期都会被标黄，真变慢时也分不出来。
 * 以后再有让正常耗时或成本整体换档的改动，把这个日期往后挪。
 */
const BASELINE_START = new Date('2026-10-05T00:00:00Z');
/** 基线内不足这么多次已完成的运行时，不判慢 / 贵 */
export const BASELINE_MIN_RUNS = 5;
/** 中位数取被判那次之前的最多这么多次 */
const BASELINE_WINDOW = 14;
export const SLOW_FACTOR = 1.5;
const COSTLY_FACTOR = 1.5;
/** 当天这个钟点（北京时间）还没跑完算红 */
const LATE_HOUR_BEIJING = 22;

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export type BriefRunRecord = typeof $brief_runs.$inferSelect;

export interface RunBaseline {
  /** 基线内已完成的运行数（最多 BASELINE_WINDOW） */
  runs: number;
  medianDurationMs: number | null;
  medianNeurons: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isFinished = (r: BriefRunRecord) =>
  r.finished_at !== null && (r.status === 'COMPLETED' || r.status === 'DEGRADED');

const durationMs = (r: BriefRunRecord) =>
  r.finished_at ? r.finished_at.getTime() - r.started_at.getTime() : null;

/** `earlier`：被判那次之前的运行（任意顺序）。不足 BASELINE_MIN_RUNS 次时两个中位数都是 null */
export function baselineFrom(earlier: BriefRunRecord[]): RunBaseline {
  const window = earlier
    .filter(r => isFinished(r) && r.started_at.getTime() >= BASELINE_START.getTime())
    .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
    .slice(0, BASELINE_WINDOW);
  if (window.length < BASELINE_MIN_RUNS) return { runs: window.length, medianDurationMs: null, medianNeurons: null };
  return {
    runs: window.length,
    medianDurationMs: median(window.map(r => durationMs(r)!)),
    // 没记下汇总的运行不进成本中位数
    medianNeurons: median(window.flatMap(r => (r.ops_summary ? [r.ops_summary.llm.neurons] : []))),
  };
}

/** 这次运行开始那个北京日的 LATE_HOUR_BEIJING 点，对应的 UTC 时刻 */
function lateDeadline(startedAt: Date): number {
  const beijing = new Date(startedAt.getTime() + BEIJING_OFFSET_MS);
  return Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate(), LATE_HOUR_BEIJING) - BEIJING_OFFSET_MS;
}

export function toRunRow(run: BriefRunRecord, baseline: RunBaseline, now: Date): OpsRunRow {
  const ms = durationMs(run);
  const neurons = run.ops_summary?.llm.neurons ?? null;
  const flags: OpsRunFlag[] = [];

  if (run.status === 'FAILED' || run.status === 'BLOCKED_FAITHFULNESS') flags.push('failed');
  if (run.status === 'TERMINATED_NO_STORIES') flags.push('no_stories');
  if (run.status === 'RUNNING' && now.getTime() >= lateDeadline(run.started_at)) flags.push('late');
  if (run.status === 'DEGRADED') flags.push('degraded');
  if (isFinished(run)) {
    if (ms !== null && baseline.medianDurationMs !== null && ms > baseline.medianDurationMs * SLOW_FACTOR) flags.push('slow');
    if (neurons !== null && baseline.medianNeurons !== null && neurons > baseline.medianNeurons * COSTLY_FACTOR) flags.push('costly');
  }

  const red = flags.some(f => f === 'failed' || f === 'no_stories' || f === 'late');
  return {
    workflowId: run.workflow_id,
    status: run.status,
    level: red ? 'red' : flags.length > 0 ? 'yellow' : 'ok',
    flags,
    startedAt: run.started_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
    durationMs: ms,
    articles: run.total_articles,
    stories: run.stories_identified,
    blocks: run.ops_summary?.blocks?.written ?? run.intelligence_analyses,
    calls: run.ops_summary?.llm.calls ?? null,
    neurons,
    usd: neurons === null ? null : (neurons * USD_PER_1K_NEURONS) / 1000,
  };
}

/**
 * `since` 之后开始的生产运行，旧的在前，每行按它之前的运行判灯。
 * 多取到 BASELINE_START：范围外的运行只用来算基线，不出现在结果里。
 */
export async function loadProductionRuns(
  db: Db,
  since: Date,
  now: Date
): Promise<{ records: BriefRunRecord[]; rows: OpsRunRow[]; all: BriefRunRecord[] }> {
  const from = new Date(Math.min(since.getTime(), BASELINE_START.getTime()));
  const all = await db
    .select()
    .from($brief_runs)
    .where(and(sql`${$brief_runs.workflow_id} like ${`${PRODUCTION_RUN_ID_PREFIX}%`}`, gte($brief_runs.started_at, from)))
    .orderBy($brief_runs.started_at);

  const records: BriefRunRecord[] = [];
  const rows: OpsRunRow[] = [];
  all.forEach((run, i) => {
    if (run.started_at.getTime() < since.getTime()) return;
    records.push(run);
    rows.push(toRunRow(run, baselineFrom(all.slice(0, i)), now));
  });
  return { records, rows, all };
}
