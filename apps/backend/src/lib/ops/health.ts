import type { Context } from 'hono';
import { sql } from '@meridian/database';
import {
  USD_PER_1K_NEURONS,
  type OpsHealth,
  type OpsRunRow,
  type OpsServiceName,
  type OpsServiceVersion,
  type OpsUnavailable,
} from '@meridian/contracts';
import type { Env } from '../../index';
import { Logger } from '../core/logger';
import { getDb } from '../database';
import type { Db } from '../reader/db';
import { neuronsByDayAndModel, unavailableReason, utcDay, workerErrorsByDay } from './cloudflare';
import { billingCycle, modelBill, productionRunsIn, productionUsage } from './cost';
import {
  BASELINE_MIN_RUNS,
  COSTLY_FACTOR,
  LATE_HOUR_BEIJING,
  SLOW_FACTOR,
  baselineFrom,
  loadProductionRuns,
  type BriefRunRecord,
  type RunBaseline,
} from './run-rows';
import { getServiceVersions } from './services';
import { BAD_BODY_PCT, computeSourceStatuses, countByKind, JUNK_REASON_PREFIX, type SourceStatus } from './source-status';

/**
 * 运维台 health 端点：今天的生产运行、近 24 小时入库、各服务、来源、本周期花费、待处理清单、最近 14 次生产运行。
 * 响应类型 `OpsHealth` 在 @meridian/contracts。运行行与来源的判据各在 run-rows.ts / source-status.ts，
 * 这里只有 Health 页自己的几条：今天的状态、黏成一行的正文占比、Worker 报错、服务健康，以及把它们拼成待处理清单。
 * Cloudflare 读不到时受影响的面板给 `{ unavailable }`，端点照常回 200。
 *
 * 读 ml-service 的健康会唤醒它的容器并重置 10 分钟的休眠计时，所以这个端点只在打开页面时请求一次，页面不轮询。
 */

const logger = new Logger({ module: 'ops-health' });

// ── Health 页自己的阈值 ────────────────────────────────────────────────
/** 定时任务开跑的钟点（北京时间），只用在说明文字里；判红的钟点是 run-rows.ts 的 LATE_HOUR_BEIJING */
const RUN_START_HOUR_BEIJING = 21;
/** 近 24 小时记了行数的正文里，黏成一行的占比超过它（严格大于）就黄 */
const SINGLE_LINE_YELLOW_PCT = 20;
/** 运行表列多少次 */
const RUNS_SHOWN = 14;
/** 往回取多少天的运行来凑这张表（每天一次，留出缺跑的余量） */
const RUNS_LOOKBACK_DAYS = 30;
/** 来源面板最多列几个最差的源 */
const WORST_SOURCES_SHOWN = 5;

const HOUR_MS = 3_600_000;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

type Attention = OpsHealth['attention'][number];

/** `YYYY-MM-DD`（北京日） */
const beijingDay = (d: Date) => new Date(d.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
const beijingHour = (d: Date) => new Date(d.getTime() + BEIJING_OFFSET_MS).getUTCHours();
/** `HH:mm`（北京时间），只用在待处理清单的说明文字里 */
const beijingClock = (d: Date) => new Date(d.getTime() + BEIJING_OFFSET_MS).toISOString().slice(11, 16);
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** `45m 1s` / `2h 30m` / `3d 4h`：取最大的两级 */
function formatSpan(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

const formatUsd = (neurons: number) => `$${((neurons * USD_PER_1K_NEURONS) / 1000).toFixed(2)}`;

// ── 今天的生产运行 ─────────────────────────────────────────────────────

/** 今天这次运行为什么亮灯：一行标题 + 一行说明。红的原因优先 */
function runAttention(row: OpsRunRow, record: BriefRunRecord, judgedAgainst: RunBaseline): Attention {
  const link = { run: row.workflowId };
  if (row.flags.includes('failed')) {
    return { level: 'red', title: "Today's run failed", detail: record.error?.slice(0, 200) || `Status ${row.status}`, link };
  }
  if (row.flags.includes('no_stories')) {
    return { level: 'red', title: "Today's run ended with no stories", detail: 'No brief was published', link };
  }
  if (row.flags.includes('late')) {
    return {
      level: 'red',
      title: `Today's run is still running after ${hourLabel(LATE_HOUR_BEIJING)}`,
      detail: `Started ${beijingClock(record.started_at)} · not finished by ${hourLabel(LATE_HOUR_BEIJING)}`,
      link,
    };
  }

  const words: string[] = [];
  const details: string[] = [];
  if (row.flags.includes('degraded')) {
    words.push('degraded');
    const reasons = record.ops_summary?.degradedReasons ?? [];
    details.push(reasons.length > 0 ? reasons.join('; ') : 'Finished with partial failures · open the run for the reasons');
  }
  if (row.flags.includes('slow') && row.durationMs !== null && judgedAgainst.medianDurationMs !== null) {
    words.push('slow');
    details.push(`Took ${formatSpan(row.durationMs)} · slow above ${formatSpan(judgedAgainst.medianDurationMs * SLOW_FACTOR)}`);
  }
  if (row.flags.includes('costly') && row.neurons !== null && judgedAgainst.medianNeurons !== null) {
    words.push('costly');
    details.push(`Cost ${formatUsd(row.neurons)} · costly above ${formatUsd(judgedAgainst.medianNeurons * COSTLY_FACTOR)}`);
  }
  return { level: 'yellow', title: `Today's run was ${words.join(' and ')}`, detail: details.join(' · '), link };
}

function todayPanel(
  runs: { records: BriefRunRecord[]; rows: OpsRunRow[]; all: BriefRunRecord[] },
  now: Date
): { today: OpsHealth['today']; attention: Attention[] } {
  // 一次从现在开跑的运行会跟哪些运行比：页面上的「中位数 / 慢线 / 基线几次」说的是这个
  const baseline = baselineFrom(runs.all);
  const numbers = {
    baselineRuns: baseline.runs,
    baselineMin: BASELINE_MIN_RUNS,
    medianDurationMs: baseline.medianDurationMs,
    slowAboveMs: baseline.medianDurationMs === null ? null : baseline.medianDurationMs * SLOW_FACTOR,
  };

  const today = beijingDay(now);
  // 一天多次（重跑）时取最新的那次
  const index = runs.records.map(r => beijingDay(r.started_at)).lastIndexOf(today);
  if (index === -1) {
    if (beijingHour(now) < LATE_HOUR_BEIJING) return { today: { state: 'scheduled', level: 'ok', run: null, ...numbers }, attention: [] };
    return {
      today: { state: 'done', level: 'red', run: null, ...numbers },
      attention: [
        {
          level: 'red',
          title: "Today's brief is late or missing",
          detail: `No production run has started today · due at ${hourLabel(RUN_START_HOUR_BEIJING)}, red after ${hourLabel(LATE_HOUR_BEIJING)}`,
          link: 'trends',
        },
      ],
    };
  }

  const record = runs.records[index];
  const row = runs.rows[index];
  const judgedAgainst = baselineFrom(runs.all.slice(0, runs.all.indexOf(record)));
  return {
    today: { state: row.status === 'RUNNING' ? 'running' : 'done', level: row.level, run: row, ...numbers },
    attention: row.level === 'ok' ? [] : [runAttention(row, record, judgedAgainst)],
  };
}

// ── 近 24 小时入库 ─────────────────────────────────────────────────────

/** 计数口径同 source-status.ts：垃圾页不算抓取失败；没记行数的正文不进占比 */
async function ingestPanel(db: Db, now: Date): Promise<{ ingest24h: OpsHealth['ingest24h']; attention: Attention[] }> {
  const since = new Date(now.getTime() - 24 * HOUR_MS).toISOString();
  const [r] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status <> 'PENDING_FETCH') AS processed,
      count(*) FILTER (WHERE status = 'FETCH_FAILED'
        AND NOT starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS failed,
      count(*) FILTER (WHERE starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS junk,
      count(*) FILTER (WHERE used_browser) AS browser,
      count(*) FILTER (WHERE body_lines IS NOT NULL) AS bodies,
      count(*) FILTER (WHERE body_lines = 1) AS single_line
    FROM articles
    WHERE created_at >= ${since}::timestamp
  `)) as unknown as Array<Record<string, string | number>>;

  const bodies = Number(r.bodies);
  const singleLine = Number(r.single_line);
  // 整数乘法比较，避开浮点误差
  const yellow = bodies > 0 && singleLine * 100 > SINGLE_LINE_YELLOW_PCT * bodies;
  return {
    ingest24h: {
      processed: Number(r.processed),
      fetchFailed: Number(r.failed),
      junk: Number(r.junk),
      viaBrowser: Number(r.browser),
      bodies,
      singleLine,
      level: yellow ? 'yellow' : 'ok',
    },
    attention: yellow
      ? [
          {
            level: 'yellow',
            title: `${Math.round((singleLine / bodies) * 100)}% of new article bodies are a single line`,
            detail: `${singleLine} of ${bodies} bodies in the last 24 hours · limit ${SINGLE_LINE_YELLOW_PCT}%`,
            link: 'trends',
          },
        ]
      : [],
  };
}

// ── 服务与 Worker 报错 ─────────────────────────────────────────────────

function serviceAttention(services: OpsServiceVersion[]): Attention[] {
  return services.flatMap((s): Attention[] => {
    if (s.health === 'healthy') return [];
    return [
      s.health === 'unknown'
        ? { level: 'yellow', title: `${s.service} could not be reached`, detail: 'The health check got no answer', link: 'trends' }
        : { level: 'yellow', title: `${s.service} is unhealthy`, detail: 'The health check did not answer healthy', link: 'trends' },
    ];
  });
}

async function workerErrorsPanel(env: Env, now: Date): Promise<{ workerErrors24h: OpsHealth['workerErrors24h']; attention: Attention[] }> {
  let rows;
  try {
    rows = await workerErrorsByDay(env, new Date(now.getTime() - 24 * HOUR_MS), now);
  } catch (error) {
    logger.warn('运维台 health：Worker 报错数读不到', { error_message: unavailableReason(error) });
    return { workerErrors24h: { unavailable: unavailableReason(error) }, attention: [] };
  }
  const counts: Record<OpsServiceName, number> = { backend: 0, 'ai-worker': 0, 'ml-service': 0 };
  for (const row of rows) counts[row.service] += row.errors;
  const total = counts.backend + counts['ai-worker'] + counts['ml-service'];
  return {
    workerErrors24h: counts,
    attention:
      total > 0
        ? [
            {
              level: 'yellow',
              title: `${total} production Worker ${total === 1 ? 'error' : 'errors'} in the last 24 hours`,
              detail: Object.entries(counts)
                .filter(([, n]) => n > 0)
                .map(([service, n]) => `${service} ${n}`)
                .join(' · '),
              link: 'trends',
            },
          ]
        : [],
  };
}

// ── 来源 ───────────────────────────────────────────────────────────────

const SOURCE_TITLE: Record<'not_checked' | 'dead_feed' | 'fetch_failing' | 'bad_body', string> = {
  not_checked: 'has not been checked',
  dead_feed: 'looks like a dead feed',
  fetch_failing: 'is failing to fetch',
  bad_body: 'has a bad body format',
};

/** 这个源为什么是红 / 黄：一句话，数字取自判它的那几项 */
function sourceDetail(s: SourceStatus, now: Date): string {
  switch (s.kind) {
    case 'not_checked':
      return s.lastChecked === null ? 'Never checked' : `Last checked ${formatSpan(now.getTime() - Date.parse(s.lastChecked))} ago`;
    case 'dead_feed':
      return `No new article in 48 hours · ${s.articles7d} in the last 7 days`;
    case 'fetch_failing':
      return `${Math.round(s.fetchFailedPct ?? 0)}% of new articles failed to fetch`;
    case 'bad_body': {
      const parts: string[] = [];
      if ((s.singleLinePct ?? 0) > BAD_BODY_PCT) parts.push(`${Math.round(s.singleLinePct!)}% single-line bodies`);
      if ((s.junkPct ?? 0) > BAD_BODY_PCT) parts.push(`${Math.round(s.junkPct!)}% junk pages`);
      return parts.join(' · ');
    }
    default:
      return '';
  }
}

function sourcesPanel(statuses: SourceStatus[], now: Date): { sources: OpsHealth['sources']; attention: Attention[] } {
  // computeSourceStatuses 已按严重度排好（红、黄、ok、灰）
  const problems = statuses
    .filter(s => s.level === 'red' || s.level === 'yellow')
    .map(s => ({ status: s, detail: sourceDetail(s, now) }));
  return {
    sources: {
      counts: countByKind(statuses),
      worst: problems.slice(0, WORST_SOURCES_SHOWN).map(({ status: s, detail }) => ({ id: s.id, name: s.name, kind: s.kind, detail })),
    },
    attention: problems.map(({ status: s, detail }) => ({
      level: s.level as 'red' | 'yellow',
      title:
        s.kind === 'not_checked' && s.lastChecked === null
          ? `${s.name} has never been checked`
          : `${s.name} ${SOURCE_TITLE[s.kind as keyof typeof SOURCE_TITLE]}`,
      detail,
      link: 'sources',
    })),
  };
}

// ── 本周期模型花费 ─────────────────────────────────────────────────────

async function spendPanel(env: Env, db: Db, now: Date): Promise<OpsHealth['spend']> {
  const cycle = billingCycle(now, 'current');
  const [usage, production] = await Promise.all([
    neuronsByDayAndModel(env, cycle.start, utcDay(now)).catch((error): OpsUnavailable => {
      logger.warn('运维台 health：模型用量读不到', { error_message: unavailableReason(error) });
      return { unavailable: unavailableReason(error) };
    }),
    productionRunsIn(db, cycle),
  ]);
  if (!Array.isArray(usage)) return usage;

  const bill = modelBill(Math.round(usage.reduce((sum, r) => sum + r.neurons, 0)), cycle.days);
  return {
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    day: cycle.day,
    days: cycle.days,
    neurons: bill.neurons,
    freePool: bill.freePool,
    usd: bill.usd,
    // 账户一点没用时占比没有意义
    productionShare: bill.neurons > 0 ? productionUsage(usage, production).share : null,
  };
}

// ── 组装 ───────────────────────────────────────────────────────────────

export async function opsHealth(c: Context<{ Bindings: Env }>): Promise<Response> {
  const now = new Date();
  const db = getDb(c.env.HYPERDRIVE);

  const [runs, ingest, statuses, services, workerErrors, spend] = await Promise.all([
    loadProductionRuns(db, new Date(now.getTime() - RUNS_LOOKBACK_DAYS * 24 * HOUR_MS), now),
    ingestPanel(db, now),
    computeSourceStatuses(db, now),
    getServiceVersions(c.env),
    workerErrorsPanel(c.env, now),
    spendPanel(c.env, db, now),
  ]);

  const today = todayPanel(runs, now);
  const sources = sourcesPanel(statuses, now);
  // 顺序：今天的运行、来源、入库、Worker 报错、服务；再把红的提到前面（sort 稳定，组内顺序不变）
  const attention = [...today.attention, ...sources.attention, ...ingest.attention, ...workerErrors.attention, ...serviceAttention(services)].sort(
    (a, b) => Number(b.level === 'red') - Number(a.level === 'red')
  );

  const body: OpsHealth = {
    generatedAt: now.toISOString(),
    today: today.today,
    ingest24h: ingest.ingest24h,
    services,
    workerErrors24h: workerErrors.workerErrors24h,
    sources: sources.sources,
    spend,
    attention,
    runs: runs.rows.slice(-RUNS_SHOWN).reverse(),
  };
  return c.json(body);
}
