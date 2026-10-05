import type { Context } from 'hono';
import { sql } from '@meridian/database';
import { USD_PER_1K_NEURONS, type OpsTrends, type OpsUnavailable } from '@meridian/contracts';
import type { Env } from '../../index';
import { Logger } from '../core/logger';
import { getDb } from '../database';
import type { Db } from '../reader/db';
import { unavailableReason, utcDay, workerErrorsByDay } from './cloudflare';
import { baselineFrom, loadProductionRuns } from './run-rows';
import { JUNK_REASON_PREFIX } from './source-status';

/**
 * 运维台 trends 端点：近 N 天的生产运行、按北京日的入库、Worker 报错、核查结果。响应类型 `OpsTrends` 在 @meridian/contracts。
 * 运行的灯与基线全部来自 run-rows.ts；入库的计数口径与 source-status.ts 一致。Cloudflare 读不到时 `workerErrors` 给 `{ unavailable }`，端点照常回 200。
 */

const logger = new Logger({ module: 'ops-trends' });

const MIN_DAYS = 7;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 北京日 `YYYY-MM-DD`（输入是 UTC 时刻） */
const beijingDay = (d: Date) => utcDay(new Date(d.getTime() + BEIJING_OFFSET_MS));

/** 范围内每个北京日，旧的在前，最后一个是 `now` 所在的那天；`since` 是第一天北京 0 点对应的 UTC 时刻 */
function beijingRange(now: Date, days: number): { since: Date; days: string[] } {
  const todayStartUtc = Date.parse(`${beijingDay(now)}T00:00:00Z`) - BEIJING_OFFSET_MS;
  const since = new Date(todayStartUtc - (days - 1) * DAY_MS);
  return { since, days: Array.from({ length: days }, (_, i) => beijingDay(new Date(since.getTime() + i * DAY_MS))) };
}

type IngestDay = OpsTrends['ingest'][number];

async function ingestByBeijingDay(db: Db, since: Date, dayList: string[]): Promise<IngestDay[]> {
  // articles.created_at 是不带时区的 UTC；ISO 串转 timestamp 时丢掉 Z，值不变。北京日 = UTC 加 8 小时后的日期
  const rows = await db.execute(sql`
    SELECT to_char((created_at + interval '8 hours')::date, 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE status = 'PROCESSED') AS processed,
      count(*) FILTER (WHERE status = 'FETCH_FAILED'
        AND NOT starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS fetch_failed,
      count(*) FILTER (WHERE starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS junk,
      count(*) FILTER (WHERE body_lines IS NOT NULL) AS bodies,
      count(*) FILTER (WHERE body_lines = 1) AS single_line
    FROM articles
    WHERE created_at >= ${since.toISOString()}::timestamp
    GROUP BY 1
  `);
  const byDay = new Map<string, Record<string, string | number>>();
  for (const r of rows as unknown as Array<Record<string, string | number>>) byDay.set(String(r.day), r);

  return dayList.map(day => {
    const r = byDay.get(day);
    const bodies = Number(r?.bodies ?? 0);
    return {
      day,
      processed: Number(r?.processed ?? 0),
      fetchFailed: Number(r?.fetch_failed ?? 0),
      junk: Number(r?.junk ?? 0),
      bodies,
      // 一篇正文都没记的日子是「没开始记」，不是 0
      singleLine: bodies === 0 ? null : Number(r?.single_line ?? 0),
    };
  });
}

/** 范围内每个 UTC 日（Cloudflare 按 UTC 日分组）一行，没报错的补 0 */
async function workerErrors(env: Env, since: Date, now: Date): Promise<OpsTrends['workerErrors']> {
  try {
    const rows = await workerErrorsByDay(env, since, now);
    const byDay = new Map<string, { day: string; backend: number; aiWorker: number; mlService: number }>();
    for (let t = Date.parse(`${utcDay(since)}T00:00:00Z`); t <= now.getTime(); t += DAY_MS) {
      const day = utcDay(new Date(t));
      byDay.set(day, { day, backend: 0, aiWorker: 0, mlService: 0 });
    }
    const field = { backend: 'backend', 'ai-worker': 'aiWorker', 'ml-service': 'mlService' } as const;
    for (const r of rows) {
      const entry = byDay.get(r.day);
      if (entry) entry[field[r.service]] += r.errors;
    }
    return [...byDay.values()];
  } catch (error) {
    logger.warn('运维台 trends：Worker 报错读不到', { error_message: unavailableReason(error) });
    return { unavailable: unavailableReason(error) } satisfies OpsUnavailable;
  }
}

export async function opsTrends(c: Context<{ Bindings: Env }>): Promise<Response> {
  const raw = c.req.query('days');
  const days = raw === undefined ? DEFAULT_DAYS : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    return c.json({ error: `days must be an integer from ${MIN_DAYS} to ${MAX_DAYS}` }, 400);
  }

  const now = new Date();
  const range = beijingRange(now, days);
  const db = getDb(c.env.HYPERDRIVE);

  const [{ records, rows, all }, ingest, errors] = await Promise.all([
    loadProductionRuns(db, range.since, now),
    ingestByBeijingDay(db, range.since, range.days),
    workerErrors(c.env, range.since, now),
  ]);

  // 中位数就是下一次运行会拿来判慢 / 贵的基线；基线不足时两个都是 null
  const baseline = baselineFrom(all);
  const checks = records.flatMap(run => {
    const check = run.ops_summary?.check;
    if (!check) return [];
    const blocks = run.ops_summary?.blocks;
    return [
      {
        workflowId: run.workflow_id,
        day: beijingDay(run.started_at),
        clean: check.outcomes.clean,
        fixed: check.outcomes.fixed,
        unchecked: check.uncheckedBlocks,
        notWritten: blocks ? Math.max(0, blocks.expected - blocks.written) : 0,
      },
    ];
  });

  const body: OpsTrends = {
    days,
    runs: rows,
    medianDurationMs: baseline.medianDurationMs,
    medianUsd: baseline.medianNeurons === null ? null : (baseline.medianNeurons * USD_PER_1K_NEURONS) / 1000,
    ingest,
    workerErrors: errors,
    checks,
  };
  return c.json(body);
}
