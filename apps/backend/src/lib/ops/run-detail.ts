import type { Context } from 'hono';
import { $brief_runs, eq } from '@meridian/database';
import {
  USD_PER_1K_NEURONS,
  briefV3RecordKey,
  type BriefV3Record,
  type OpsRunDetail,
  type OpsRunRow,
} from '@meridian/contracts';
import type { Env } from '../../index';
import { getDb } from '../database';
import { Logger } from '../core/logger';
import { PRODUCTION_RUN_ID_PREFIX, loadProductionRuns, toRunRow, type BriefRunRecord } from './run-rows';

const logger = new Logger({ module: 'ops-run-detail' });
/** 手动运行没有基线：慢 / 贵都不判 */
const NO_BASELINE = { runs: 0, medianDurationMs: null, medianNeurons: null };

/** 块表：读这期的 brief-v3 记录；没有或读不出来就返回原因，不返回空表 */
async function loadBlocks(bucket: R2Bucket, workflowId: string): Promise<OpsRunDetail['blocks']> {
  let record: BriefV3Record | null;
  try {
    const obj = await bucket.get(briefV3RecordKey(workflowId));
    if (obj === null) return { unavailable: 'block record not found' };
    record = (await obj.json()) as BriefV3Record | null;
  } catch (error) {
    logger.error('运维台：brief-v3 记录读取或解析失败', { workflow_id: workflowId }, error);
    return { unavailable: 'block record could not be read' };
  }
  if (!Array.isArray(record?.blocks)) return { unavailable: 'block record has an unexpected shape' };
  // 没写出来的块没有档位和成本，不列
  return record.blocks.flatMap(b =>
    b.ok
      ? [
          {
            index: b.storyIdx,
            tier: b.tier,
            title: b.title,
            articles: b.articles,
            check: b.check
              ? {
                  outcome: b.check.outcome,
                  revisions: b.check.revisions,
                  unchecked: b.check.unchecked.length,
                  // 一次调用核查的两项：记录里有才带，早于它的记录照旧只有上面三项
                  ...(b.check.paths ? { paths: { oneCall: b.check.paths.oneCall, agent: b.check.paths.agent } } : {}),
                  ...(Array.isArray(b.check.fallbacks) ? { fallbacks: b.check.fallbacks.length } : {}),
                }
              : null,
            refusals: b.writeRejects.length,
            calls: b.llmCalls,
            neurons: b.neurons,
            usd: (b.neurons * USD_PER_1K_NEURONS) / 1000,
          },
        ]
      : []
  );
}

async function rowOf(db: ReturnType<typeof getDb>, run: BriefRunRecord, now: Date): Promise<OpsRunRow> {
  if (!run.workflow_id.startsWith(PRODUCTION_RUN_ID_PREFIX)) return toRunRow(run, NO_BASELINE, now);
  const { rows } = await loadProductionRuns(db, run.started_at, now);
  return rows.find(r => r.workflowId === run.workflow_id) ?? toRunRow(run, NO_BASELINE, now);
}

// 运维台 run-detail 端点。响应类型在 @meridian/contracts 的 ops-console.ts
export async function opsRunDetail(c: Context<{ Bindings: Env }>): Promise<Response> {
  const workflowId = c.req.param('workflowId');
  const db = getDb(c.env.HYPERDRIVE);
  const [run] = await db.select().from($brief_runs).where(eq($brief_runs.workflow_id, workflowId)).limit(1);
  if (!run) return c.json({ error: 'Run not found' }, 404);

  const [row, blocks] = await Promise.all([rowOf(db, run, new Date()), loadBlocks(c.env.ARTICLES_BUCKET, workflowId)]);
  const detail: OpsRunDetail = { run: row, params: run.params, error: run.error, summary: run.ops_summary, blocks };
  return c.json(detail);
}
