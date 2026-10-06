import { $brief_runs, eq } from '@meridian/database';
import {
  briefV3RecordKey,
  llmCallsPrefix,
  workflowObservabilityKey,
  type BriefBlockV6Check,
  type OpsCheckOutcome,
  type RunOpsSummary,
} from '@meridian/contracts';
import type { Env } from '../../index';
import { Logger } from '../core/logger';
import { getDb } from '../database';

/**
 * run 结束时写进 `brief_runs.ops_summary` 的汇总：运维台的页面读这一行，不必每次去 R2 把几百上千条调用记录加一遍。
 *
 * 数据全部来自这次 run 已经落在 R2 的记录——`llm-calls/<wf>/` 下每次模型调用一个对象、`observability/<wf>.json`
 * 一份逐步观测、`observability/brief-v3/<wf>.json` 一份块记录（只取一次调用核查的那几项）——所以 workflow 里的那一步和回填脚本（scripts/backfill-ops-summary.ts）走同一个 `buildRunOpsSummary`，
 * 只是读 R2 的方式不同（binding / Cloudflare REST API）。
 */

/**
 * 汇总要读的两类 R2 记录从哪来。读失败一律抛错：缺一部分的汇总不写（列留空 = 页面显示「not recorded」）
 * @internal 导出只给 scripts/backfill-ops-summary.ts（回填脚本经 REST API 读 R2）；生产在本文件内用
 */
export interface RunRecordSource {
  /** 列一页 key（R2 一次最多回 1000 个）；还有下一页时带 `cursor` */
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
  /** 对象原文；不存在回 null */
  get(key: string): Promise<string | null>;
}

/** 一次读多少个调用记录：核查调用每条带整段多轮对话，一次全读会顶到 Worker 的内存上限（同 /observability/runs/:wf/llm-calls） */
const READ_BATCH = 50;

/** 观测里只当标记用的条目，不是步骤 */
const MARKER_STEPS = new Set(['workflow_start', 'workflow_complete', 'workflow_failed', 'workflow_terminated']);

const CHECK_OUTCOMES: OpsCheckOutcome[] = ['off', 'clean', 'fixed', 'revise_failed', 'still_flagged', 'missing'];

interface ObservedMetric {
  stepName: string;
  status: 'started' | 'completed' | 'degraded' | 'failed';
  timestamp: string;
  data?: any;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** `llm-calls/<wf>/<phase>-<3 位序号>.json` 里的 phase（记录本身没写 phase 时用） */
const phaseFromKey = (key: string) => key.slice(key.lastIndexOf('/') + 1).replace(/-\d+\.json$/, '');

async function sumLlmCalls(source: RunRecordSource, workflowId: string): Promise<RunOpsSummary['llm']> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await source.list(llmCallsPrefix(workflowId), cursor);
    keys.push(...page.keys);
    cursor = page.cursor;
  } while (cursor);

  const byPhase: RunOpsSummary['llm']['byPhase'] = {};
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = await Promise.all(
      keys.slice(i, i + READ_BATCH).map(async key => {
        const text = await source.get(key);
        if (text === null) throw new Error(`调用记录列得到、读不到：${key}`);
        const data: any = JSON.parse(text);
        return {
          phase: typeof data?.phase === 'string' ? data.phase : phaseFromKey(key),
          // 出错的调用没有 usage，按 0 计
          neurons: count(data?.response?.usage?.neurons),
        };
      })
    );
    for (const { phase, neurons } of batch) {
      const p = (byPhase[phase] ??= { calls: 0, neurons: 0 });
      p.calls += 1;
      p.neurons += neurons;
    }
  }

  for (const p of Object.values(byPhase)) p.neurons = round2(p.neurons);
  return {
    calls: keys.length,
    neurons: round2(Object.values(byPhase).reduce((n, p) => n + p.neurons, 0)),
    byPhase,
  };
}

/**
 * 观测条目 → 每步的起止。耗时按两条的时间戳相减，不用条目里的 `duration`（logStep 只给 completed / failed 算，degraded 没有）。
 * - 只在结束时记一条的步骤（story_rank、brief_blocks）没有 started：起点取它之前最近一步结束的时刻，
 *   所以这类步骤的耗时含两步之间的落库等零碎时间。
 * - 开始了没结束的步骤（run 中途失败）记 failed，耗时算到最后一条观测。
 */
function stepsFrom(metrics: ObservedMetric[]): RunOpsSummary['steps'] {
  const steps: RunOpsSummary['steps'] = [];
  const open = new Map<string, string>();
  let lastEnd: string | undefined = metrics[0]?.timestamp;
  const span = (from: string, to: string) => Math.max(0, Date.parse(to) - Date.parse(from));

  for (const m of metrics) {
    if (MARKER_STEPS.has(m.stepName)) continue;
    if (m.status === 'started') {
      open.set(m.stepName, m.timestamp);
      continue;
    }
    const startedAt = open.get(m.stepName) ?? lastEnd ?? m.timestamp;
    open.delete(m.stepName);
    steps.push({ name: m.stepName, status: m.status, startedAt, ms: span(startedAt, m.timestamp) });
    lastEnd = m.timestamp;
  }

  const lastSeen = metrics[metrics.length - 1]?.timestamp;
  for (const [name, startedAt] of open) {
    steps.push({ name, status: 'failed', startedAt, ms: span(startedAt, lastSeen ?? startedAt) });
  }
  return steps.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** `brief_blocks` 那条观测的 data → 块计数与核查计数。没有这条（run 没走到写块）两者都是 null；旧 run 没有核查字段，check 为 null */
function blocksFrom(metrics: ObservedMetric[]): Pick<RunOpsSummary, 'blocks' | 'check'> {
  const data = metrics.find(m => m.stepName === 'brief_blocks' && m.status !== 'started')?.data;
  if (!data || typeof data !== 'object') return { blocks: null, check: null };
  const outcomes = data.checkOutcomes;
  return {
    blocks: {
      expected: count(data.expected),
      written: count(data.written),
      tiers: { lead: count(data.tiers?.lead), more: count(data.tiers?.more), brief: count(data.tiers?.brief) },
      writeRejects: count(data.writeRejects),
    },
    check:
      outcomes && typeof outcomes === 'object'
        ? {
            outcomes: Object.fromEntries(CHECK_OUTCOMES.map(k => [k, count(outcomes[k])])) as Record<OpsCheckOutcome, number>,
            uncheckedBlocks: count(data.uncheckedBlocks),
            revisions: count(data.checkRevisions),
          }
        : null,
  };
}

type OneCallSummary = NonNullable<NonNullable<RunOpsSummary['check']>['oneCall']>;

/**
 * 一次调用核查（ADR 0012）的 run 级汇总，从各块的核查记录加出来。
 * 没有任何块带这些字段（记录早于它，或 ai-worker 回滚到了旧版本）时返回 undefined：汇总里不写这一项，页面照旧。
 */
function oneCallFrom(checks: BriefBlockV6Check[]): OneCallSummary | undefined {
  const carrying = checks.filter(c => c.mode !== undefined || c.paths !== undefined || c.fallbacks !== undefined);
  if (carrying.length === 0) return undefined;
  const fallbacks = carrying.flatMap(c => (Array.isArray(c.fallbacks) ? c.fallbacks : []));
  const fallbackReasons: Record<string, number> = {};
  for (const f of fallbacks) fallbackReasons[f.reason] = (fallbackReasons[f.reason] ?? 0) + 1;
  return {
    checks: carrying.reduce((n, c) => n + count(c.paths?.oneCall) + count(c.paths?.agent), 0),
    fallbacks: fallbacks.length,
    fallbackReasons,
    fallbackMessage: fallbacks[0]?.message ?? null,
    noMeaningSearchBlocks: carrying.filter(c => c.meaningSearch === false).length,
    // 留 6 位小数去掉浮点尾巴
    dashscopeUsd: Math.round(carrying.reduce((n, c) => n + count(c.dashscope?.usd), 0) * 1e6) / 1e6,
  };
}

/** 这次 run 的块记录里各块的核查记录；没有块记录（run 没走到拼装，或那次落盘失败）就是空 */
async function blockChecks(source: RunRecordSource, workflowId: string): Promise<BriefBlockV6Check[]> {
  const text = await source.get(briefV3RecordKey(workflowId));
  if (text === null) return [];
  const blocks: unknown = JSON.parse(text)?.blocks;
  return Array.isArray(blocks) ? blocks.flatMap(b => (b?.ok && b.check && typeof b.check === 'object' ? [b.check] : [])) : [];
}

/**
 * 从一次 run 落在 R2 的记录拼出汇总。没有观测对象（很早就失败的 run）时步骤为空、块与核查为 null，照样返回；
 * R2 读失败、记录不是合法 JSON 则抛错。
 * @internal 导出只给 scripts/backfill-ops-summary.ts（回填脚本）；生产在本文件内用
 */
export async function buildRunOpsSummary(
  source: RunRecordSource,
  workflowId: string,
  degradedReasons: string[]
): Promise<RunOpsSummary> {
  const llm = await sumLlmCalls(source, workflowId);
  const observed = await source.get(workflowObservabilityKey(workflowId));
  const parsed = observed === null ? null : JSON.parse(observed);
  const metrics: ObservedMetric[] = Array.isArray(parsed?.detailedMetrics) ? parsed.detailedMetrics : [];
  const { blocks, check } = blocksFrom(metrics);
  const oneCall = check ? oneCallFrom(await blockChecks(source, workflowId)) : undefined;
  return { v: 1, llm, steps: stepsFrom(metrics), blocks, check: check && oneCall ? { ...check, oneCall } : check, degradedReasons };
}

function r2BucketSource(bucket: R2Bucket): RunRecordSource {
  return {
    async list(prefix, cursor) {
      const page = await bucket.list({ prefix, cursor });
      return { keys: page.objects.map(o => o.key), cursor: page.truncated ? page.cursor : undefined };
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? obj.text() : null;
    },
  };
}

/**
 * 给 workflow 结束时的那一步用：拼汇总、写进这次 run 的行。任何失败只打一条 warn、列留空，
 * 不抛错，也不碰 run 的 status——观测不能弄坏一期简报。返回写没写成。
 */
export async function recordRunOpsSummary(
  env: Pick<Env, 'ARTICLES_BUCKET' | 'HYPERDRIVE'>,
  workflowId: string,
  degradedReasons: string[]
): Promise<boolean> {
  try {
    const summary = await buildRunOpsSummary(r2BucketSource(env.ARTICLES_BUCKET), workflowId, degradedReasons);
    await getDb(env.HYPERDRIVE)
      .update($brief_runs)
      .set({ ops_summary: summary })
      .where(eq($brief_runs.workflow_id, workflowId));
    return true;
  } catch (error) {
    new Logger({ component: 'RunOpsSummary', workflow_id: workflowId }).warn(
      '[运维台] run 汇总没写成（ops_summary 留空，run 状态不受影响）',
      undefined,
      error
    );
    return false;
  }
}
