import type { Context } from 'hono';
import { $brief_runs, and, desc, gte, isNotNull, sql } from '@meridian/database';
import { USD_PER_1K_NEURONS, type OpsCost, type OpsUnavailable } from '@meridian/contracts';
import type { Env } from '../../index';
import { Logger } from '../core/logger';
import { getDb } from '../database';
import type { Db } from '../reader/db';
import {
  durableObjectsDurationGbSeconds,
  neuronsByBeijingDayAndModel,
  neuronsByDayAndModel,
  queuesOperations,
  r2ClassAOperations,
  unavailableReason,
  beijingDay, utcDay,
  workersUsage,
  type CloudflareEnv,
  type NeuronsRow,
} from './cloudflare';
import { PRODUCTION_RUN_ID_PREFIX } from './run-rows';

/**
 * 运维台 cost 端点：一个计费周期的模型花费，按 Cloudflare 出账的算法；生产与其它分开；其它计费项只看占免费额度多少。
 * 响应类型 `OpsCost` 在 @meridian/contracts。Cloudflare 读不到时受影响的块给 `{ unavailable }`，端点照常回 200。
 */

const logger = new Logger({ module: 'ops-cost' });

// ── 计费规则（改价或改账期时只动这里）──────────────────────────────────
/** 计费周期从每月这一天（UTC）开始，到下月的前一天结束 */
const CYCLE_START_DAY = 4;
/** Workers AI 的免费池：每天这么多 neurons，按周期天数合计后整池抵扣（不是按天清零） */
const FREE_NEURONS_PER_DAY = 10_000;
/** Workers Paid 套餐月费 */
const PLAN_FEE_USD = 5;
/** 文章分析（入库时逐篇）用的模型，与 ai-worker 的 `/meridian/article/analyze` 首选档一致 */
const ARTICLE_ANALYSIS_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingCycle {
  /** 周期第一天、最后一天，UTC 的 `YYYY-MM-DD` */
  start: string;
  end: string;
  /** 今天是周期的第几天；已结束的周期 = `days` */
  day: number;
  days: number;
  complete: boolean;
}

/** `now` 所在的计费周期，或它的上一个 */
export function billingCycle(now: Date, which: 'current' | 'previous'): BillingCycle {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // 这个月的开始日还没到，周期就是从上个月开始的那个；Date.UTC 的月份越界会自己进位 / 借位
  const monthsBack = (now.getUTCDate() < CYCLE_START_DAY ? 1 : 0) + (which === 'previous' ? 1 : 0);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, CYCLE_START_DAY);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack + 1, CYCLE_START_DAY - 1);
  const days = (end - start) / DAY_MS + 1;
  const complete = today > end;
  return {
    start: utcDay(new Date(start)),
    end: utcDay(new Date(end)),
    day: complete ? days : (today - start) / DAY_MS + 1,
    days,
    complete,
  };
}

/** 按牌价算的美元数（不扣免费池），留 6 位小数去掉浮点尾巴 */
const usdAtList = (neurons: number) => Math.round(neurons * USD_PER_1K_NEURONS * 1000) / 1_000_000;

/** 一个周期的模型账单：整池抵扣后按牌价计，美元取到分（与账单一致） */
export function modelBill(neurons: number, cycleDays: number) {
  const freePool = FREE_NEURONS_PER_DAY * cycleDays;
  const billable = Math.max(0, neurons - freePool);
  return { neurons, freePool, billable, usd: Math.round(billable * USD_PER_1K_NEURONS * 0.1) / 100, planFeeUsd: PLAN_FEE_USD };
}

// ── 模型以外的计费项 ───────────────────────────────────────────────────
// 免费额度取自 Workers Paid 套餐（Workers / Durable Objects / Queues / Containers / Workers Logs 在 Workers 定价页，
// R2 在 R2 定价页，均 2026-10-05 读）。额度按月给，这里按一个计费周期比。
// 容器内存和 Workers Logs 事件数没有 GraphQL 数据集（容器的 `containers*` 字段全部 unknown field；
// 日志用量只在 dashboard 和 observability 接口里，后者要另一种 token），所以这两项只列额度、用量给 null。
type OtherItem = OpsCost['otherItems'][number];

function otherItem(name: string, unit: string, allowance: number, used: number | null): OtherItem {
  return { name, unit, allowance, used, share: used === null ? null : used / allowance };
}

async function loadOtherItems(env: CloudflareEnv, from: string, to: string): Promise<OtherItem[]> {
  // 每项各自一次查询、各自失败：一个数据集读不到不连累别的项
  const read = async <T>(item: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (error) {
      logger.warn('运维台 cost：计费项读不到，按 not available 显示', { item, error_message: unavailableReason(error) });
      return null;
    }
  };
  const [workers, doDuration, r2ClassA, queues] = await Promise.all([
    read('workers', () => workersUsage(env, from, to)),
    read('durable_objects', () => durableObjectsDurationGbSeconds(env, from, to)),
    read('r2', () => r2ClassAOperations(env, from, to)),
    read('queues', () => queuesOperations(env, from, to)),
  ]);
  return [
    otherItem('Workers requests', 'requests', 10_000_000, workers?.requests ?? null),
    otherItem('Workers CPU time', 'CPU ms', 30_000_000, workers?.cpuMs ?? null),
    otherItem('Durable Objects duration', 'GB-s', 400_000, doDuration),
    otherItem('R2 Class A operations', 'operations', 1_000_000, r2ClassA),
    otherItem('Queues operations', 'operations', 1_000_000, queues),
    otherItem('Container memory', 'GiB-hours', 25, null),
    otherItem('Workers Logs events', 'events', 20_000_000, null),
  ];
}

// ── 生产运行 ───────────────────────────────────────────────────────────

const isProductionRun = sql`${$brief_runs.workflow_id} like ${`${PRODUCTION_RUN_ID_PREFIX}%`}`;
/** 在周期最后一天结束之前开始（裸 sql 里不能直接塞 Date，见 .claude/rules/workers.md） */
const startedBeforeEndOf = (cycle: BillingCycle) =>
  sql`${$brief_runs.started_at} < ${new Date(Date.parse(`${cycle.end}T00:00:00Z`) + DAY_MS).toISOString()}`;

/** 周期内开始的生产运行：次数，以及记下了汇总的那些的 neurons 合计（没记汇总的不计入，也无从补） */
export async function productionRunsIn(db: Db, cycle: BillingCycle): Promise<{ runs: number; runNeurons: number }> {
  const rows = await db
    .select({ summary: $brief_runs.ops_summary })
    .from($brief_runs)
    .where(
      and(
        isProductionRun,
        gte($brief_runs.started_at, new Date(`${cycle.start}T00:00:00Z`)),
        startedBeforeEndOf(cycle)
      )
    );
  return { runs: rows.length, runNeurons: rows.reduce((sum, r) => sum + (r.summary?.llm.neurons ?? 0), 0) };
}

/** 周期结束前最近一次记下了汇总的生产运行，按阶段拆开 */
async function lastRunByStep(db: Db, cycle: BillingCycle): Promise<OpsCost['lastRunByStep']> {
  const [run] = await db
    .select({ workflowId: $brief_runs.workflow_id, startedAt: $brief_runs.started_at, summary: $brief_runs.ops_summary })
    .from($brief_runs)
    .where(
      and(
        isProductionRun,
        isNotNull($brief_runs.ops_summary),
        startedBeforeEndOf(cycle)
      )
    )
    .orderBy(desc($brief_runs.started_at))
    .limit(1);
  if (!run?.summary) return null;
  return {
    workflowId: run.workflowId,
    day: run.startedAt.toISOString(),
    steps: Object.entries(run.summary.llm.byPhase)
      .map(([phase, s]) => ({ phase, calls: s.calls, neurons: s.neurons, usd: usdAtList(s.neurons) }))
      .sort((a, b) => b.neurons - a.neurons),
  };
}

/**
 * 生产用了多少：生产运行的汇总 + 文章分析模型的全账户用量（后者是近似：这个模型只有入库时逐篇分析在用）。
 * `usage` 是同一个周期的账户用量；账户一点没用时占比是 0。Cost 页与 Health 页的「生产占比」共用这一份。
 */
export function productionUsage(usage: NeuronsRow[], production: { runs: number; runNeurons: number }) {
  const total = Math.round(usage.reduce((sum, r) => sum + r.neurons, 0));
  const analysisNeurons = Math.round(
    usage.reduce((sum, r) => sum + (r.modelId === ARTICLE_ANALYSIS_MODEL ? r.neurons : 0), 0)
  );
  const neurons = production.runNeurons + analysisNeurons;
  return { neurons, runs: production.runs, runNeurons: production.runNeurons, analysisNeurons, share: total > 0 ? neurons / total : 0 };
}

// ── 组装 ───────────────────────────────────────────────────────────────

type ModelPanels = Pick<OpsCost, 'account' | 'production' | 'byModel'>;

function modelPanels(usage: NeuronsRow[], cycle: BillingCycle, production: { runs: number; runNeurons: number }): ModelPanels {
  const total = Math.round(usage.reduce((sum, r) => sum + r.neurons, 0));
  const shareOf = (neurons: number) => (total > 0 ? neurons / total : 0);

  const perModel = new Map<string, number>();
  for (const row of usage) perModel.set(row.modelId, (perModel.get(row.modelId) ?? 0) + row.neurons);

  return {
    account: modelBill(total, cycle.days),
    production: productionUsage(usage, production),
    byModel: [...perModel]
      .map(([modelId, n]) => ({ modelId, neurons: Math.round(n), share: shareOf(n), usdAtList: usdAtList(n) }))
      .sort((a, b) => b.neurons - a.neurons),
  };
}

/**
 * 每日用量图：按北京日。周期本身从 UTC 零点（北京 8 点）起止，所以第一根柱子只有 16 小时，
 * 已结束的周期最后多出一根 8 小时的柱子；各柱之和仍等于周期合计。没用量的日子是空对象（图上那天是空的，而不是被跳过）。
 */
function dailyPanel(rows: NeuronsRow[], since: Date, until: Date): Extract<OpsCost['daily'], unknown[]> {
  const perDay = new Map<string, Record<string, number>>();
  const lastDay = beijingDay(new Date(until.getTime() - 1));
  for (let t = since.getTime(); beijingDay(new Date(t)) <= lastDay; t += DAY_MS) perDay.set(beijingDay(new Date(t)), {});
  for (const row of rows) {
    const day = perDay.get(row.day);
    if (day) day[row.modelId] = (day[row.modelId] ?? 0) + row.neurons;
  }
  return [...perDay].map(([day, byModel]) => ({
    day,
    byModel: Object.fromEntries(Object.entries(byModel).map(([model, n]) => [model, Math.round(n)])),
  }));
}

export async function opsCost(c: Context<{ Bindings: Env }>): Promise<Response> {
  const which = c.req.query('cycle') ?? 'current';
  if (which !== 'current' && which !== 'previous') {
    return c.json({ error: 'cycle must be "current" or "previous"' }, 400);
  }

  const now = new Date();
  const cycle = billingCycle(now, which);
  // 还没结束的周期只查到今天
  const lastDay = cycle.complete ? cycle.end : utcDay(now);
  const db = getDb(c.env.HYPERDRIVE);

  // 每日用量图的范围：周期的 UTC 起点到终点（没结束的周期到此刻）
  const since = new Date(`${cycle.start}T00:00:00Z`);
  const until = cycle.complete ? new Date(Date.parse(`${cycle.end}T00:00:00Z`) + DAY_MS) : now;
  const unavailable = (what: string) => (error: unknown): OpsUnavailable => {
    logger.warn(`运维台 cost：${what}读不到`, { error_message: unavailableReason(error) });
    return { unavailable: unavailableReason(error) };
  };

  const [usage, hourly, production, lastRun, otherItems] = await Promise.all([
    neuronsByDayAndModel(c.env, cycle.start, lastDay).catch(unavailable('模型用量')),
    neuronsByBeijingDayAndModel(c.env, since, until).catch(unavailable('按小时的模型用量')),
    productionRunsIn(db, cycle),
    lastRunByStep(db, cycle),
    loadOtherItems(c.env, cycle.start, lastDay),
  ]);

  const panels: ModelPanels = Array.isArray(usage)
    ? modelPanels(usage, cycle, production)
    : { account: usage, production: usage, byModel: usage };
  const daily: OpsCost['daily'] = Array.isArray(hourly) ? dailyPanel(hourly, since, until) : hourly;

  const body: OpsCost = { cycle, ...panels, daily, lastRunByStep: lastRun, otherItems };
  return c.json(body);
}
