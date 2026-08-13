/**
 * 每日定时简报触发。
 *
 * 由 wrangler.jsonc 的 cron 触发器调起(UTC 13:00 = 北京 21:00)。
 * 与 POST /admin/briefs/generate 是两个平级入口,共用同一个 workflow 与同一组聚类参数;
 * 差别只有:workflow id 前缀(cron-brief- vs admin-brief-)、triggered_by、以及这里的并发保护。
 */

import { getDb } from '../database';
import { $brief_runs, and, eq, gte } from '@meridian/database';
import { BRIEF_CLUSTERING_OPTIONS, CRON_BRIEF_PARAMS } from '../core/constants';
import { Logger } from '../core/logger';
import type { Env } from '../../index';

const logger = new Logger({ service: 'daily-brief-cron' });

export type DailyBriefCronResult =
  | { triggered: true; workflowId: string }
  | { triggered: false; reason: 'in-flight'; blockingWorkflowId: string }
  | { triggered: false; reason: 'error'; error: string };

/**
 * 查是否有仍在飞的简报 run。
 *
 * 只认时间窗内的 RUNNING:workflow 崩溃时不会回写终态,陈旧的 RUNNING 会永久留在表里,
 * 不设窗口的话第一次崩溃就会让 cron 从此再也不触发。
 */
async function findInFlightRun(env: Env): Promise<{ workflow_id: string } | undefined> {
  const db = getDb(env.HYPERDRIVE);
  const windowStart = new Date(Date.now() - CRON_BRIEF_PARAMS.IN_FLIGHT_WINDOW_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({ workflow_id: $brief_runs.workflow_id })
    .from($brief_runs)
    .where(and(eq($brief_runs.status, 'RUNNING'), gte($brief_runs.started_at, windowStart)))
    .limit(1);

  return rows[0];
}

export async function runDailyBriefCron(env: Env): Promise<DailyBriefCronResult> {
  try {
    const inFlight = await findInFlightRun(env);
    if (inFlight !== undefined) {
      logger.warn('上一次简报仍在运行,跳过本次定时触发', {
        blocking_workflow_id: inFlight.workflow_id,
        in_flight_window_hours: CRON_BRIEF_PARAMS.IN_FLIGHT_WINDOW_HOURS,
      });
      return { triggered: false, reason: 'in-flight', blockingWorkflowId: inFlight.workflow_id };
    }

    const workflowId = `cron-brief-${Date.now()}`;
    const instance = await env.MY_WORKFLOW.create({
      id: workflowId,
      params: {
        timeRangeDays: CRON_BRIEF_PARAMS.TIME_RANGE_DAYS,
        articleLimit: CRON_BRIEF_PARAMS.ARTICLE_LIMIT,
        minImportance: CRON_BRIEF_PARAMS.MIN_IMPORTANCE,
        maxStoriesToGenerate: CRON_BRIEF_PARAMS.MAX_STORIES_TO_GENERATE,
        storyMinImportance: CRON_BRIEF_PARAMS.STORY_MIN_IMPORTANCE,
        // 必须显式传:不传会落到 auto-brief-generation 的启发式分支,聚类参数与手动触发不一致
        clusteringOptions: BRIEF_CLUSTERING_OPTIONS,
        triggeredBy: 'cron',
      },
    });

    logger.info('定时简报工作流已触发', { workflow_id: instance.id });
    return { triggered: true, workflowId: instance.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('定时简报触发失败', { error_message: message }, error instanceof Error ? error : undefined);
    return { triggered: false, reason: 'error', error: message };
  }
}
