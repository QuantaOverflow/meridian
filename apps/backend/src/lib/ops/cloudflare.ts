import type { OpsServiceName } from '@meridian/contracts';
import type { Env } from '../../index';

/**
 * 运维台读 Cloudflare 账户用量的客户端：GraphQL Analytics API，只读。
 * 凭证是 secret `CF_ANALYTICS_TOKEN`（Account Analytics: Read），账户是变量 `CF_ACCOUNT_ID`；
 * `CF_API_BASE_URL` 单列成变量，测试把它指到假服务（test/fake-cloudflare.ts）。
 *
 * 读不到一律抛 `CloudflareAnalyticsError`，`message` 是给人看的原因；调用方把它放进面板的 `{ unavailable }`，
 * 端点照常回 200（`unavailableReason` 做这个转换）。
 *
 * 数据集与字段名在 2026-10-05 对真实账户实测过。几个限制：
 * - 账户类型不给 introspection，字段名写错只会在运行时报 unknown field；
 * - 单次查询的时间窗上限约 31 天，更长的范围要分段（`workerErrorsByDay` 已分段）；
 * - 容器用量、Workers Logs 事件数没有 GraphQL 数据集。
 */

export type CloudflareEnv = Pick<Env, 'CF_ANALYTICS_TOKEN' | 'CF_ACCOUNT_ID' | 'CF_API_BASE_URL'>;

export class CloudflareAnalyticsError extends Error {}

/** 把读 Cloudflare 时的失败变成面板上显示的原因 */
export function unavailableReason(error: unknown): string {
  if (error instanceof CloudflareAnalyticsError) return error.message;
  return `Cloudflare analytics failed: ${error instanceof Error ? error.message : String(error)}`;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** 单次查询最多回这么多行（API 的上限）；本账户按日 × 模型 / 服务分组，一个周期远不到 */
const ROW_LIMIT = 10_000;
/** 单次查询的时间窗上限（R2 文档写 31 天，其它数据集实测到 32 天报 quota 错） */
const MAX_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`（UTC） */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 查账户下的一个数据集。`selection` 是 `accounts(...) { ... }` 里的内容，以数据集名开头；
 * 变量在 `variableTypes` 里声明类型（Cloudflare 的标量：`Date` = YYYY-MM-DD，`Time` = ISO 时刻）。
 */
async function queryDataset<Row>(
  env: CloudflareEnv,
  dataset: string,
  selection: string,
  variableTypes: Record<string, 'Date' | 'Time'>,
  variables: Record<string, string>
): Promise<Row[]> {
  if (!env.CF_ANALYTICS_TOKEN) throw new CloudflareAnalyticsError('CF_ANALYTICS_TOKEN is not set');

  const declared = Object.entries(variableTypes)
    .map(([name, type]) => `, $${name}: ${type}!`)
    .join('');
  const query = `query($accountTag: string!${declared}) { viewer { accounts(filter: { accountTag: $accountTag }) { ${dataset}${selection} } } }`;

  let res: Response;
  try {
    res = await fetch(`${env.CF_API_BASE_URL}/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { accountTag: env.CF_ACCOUNT_ID, ...variables } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CloudflareAnalyticsError(
      `Cloudflare analytics unreachable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CloudflareAnalyticsError(`Cloudflare analytics replied HTTP ${res.status}`);
  }

  let body: { data?: { viewer?: { accounts?: Array<Record<string, Row[]>> } } | null; errors?: Array<{ message?: string }> | null };
  try {
    body = await res.json();
  } catch {
    throw new CloudflareAnalyticsError('Cloudflare analytics replied with a body that is not JSON');
  }
  if (body.errors?.length) {
    throw new CloudflareAnalyticsError(`Cloudflare analytics error: ${body.errors.map(e => e.message).join('; ')}`);
  }
  const rows = body.data?.viewer?.accounts?.[0]?.[dataset];
  if (!Array.isArray(rows)) throw new CloudflareAnalyticsError(`Cloudflare analytics returned no ${dataset} data`);
  // 行数顶到上限 = 很可能被截断，合计会偏小；宁可说读不到，也不给一个悄悄少算的数
  if (rows.length >= ROW_LIMIT) throw new CloudflareAnalyticsError(`Cloudflare analytics truncated ${dataset} at ${ROW_LIMIT} rows`);
  return rows;
}

// ── Workers AI ─────────────────────────────────────────────────────────

export interface NeuronsRow {
  /** UTC 日，`YYYY-MM-DD` */
  day: string;
  modelId: string;
  neurons: number;
}

/** Workers AI 用量：按 UTC 日和模型。`from` / `to` 是 `YYYY-MM-DD`，两端都含，跨度不超过 31 天 */
export async function neuronsByDayAndModel(env: CloudflareEnv, from: string, to: string): Promise<NeuronsRow[]> {
  const rows = await queryDataset<{ sum: { totalNeurons: number }; dimensions: { date: string; modelId: string } }>(
    env,
    'aiInferenceAdaptiveGroups',
    `(limit: ${ROW_LIMIT}, filter: { date_geq: $from, date_leq: $to }) { sum { totalNeurons } dimensions { date modelId } }`,
    { from: 'Date', to: 'Date' },
    { from, to }
  );
  return rows.map(r => ({ day: r.dimensions.date, modelId: r.dimensions.modelId, neurons: r.sum.totalNeurons }));
}

// ── Worker 报错 ────────────────────────────────────────────────────────

/** 三个服务在 Cloudflare 上的脚本名 */
export const WORKER_SCRIPT_NAMES: Record<OpsServiceName, string> = {
  backend: 'meridian-backend',
  'ai-worker': 'meridian-ai-worker',
  'ml-service': 'meridian-ml-service',
};

/** 这两种调用结果不算报错：正常返回，和客户端自己断开 */
const NOT_ERROR_STATUSES = ['success', 'clientDisconnected'];

export interface WorkerErrorsRow {
  /** UTC 日，`YYYY-MM-DD` */
  day: string;
  service: OpsServiceName;
  errors: number;
}

/**
 * 生产 Worker 的报错次数：[`since`, `until`) 内，按 UTC 日和服务，只回有报错的（日, 服务）。
 * 只算生产版本：本地 `wrangler dev` 走 remote binding 时建的预览会话也进这个数据集，`scriptVersion` 为空，
 * 它们的 loadShed / scriptThrewException 比生产多两个数量级（2026-09-26 实测一周几千次，生产 0 次）。
 * 过滤在查询里做一遍、拿到行后再做一遍：这是整个读数是否可信的前提，不只托付给对方的过滤器。
 */
export async function workerErrorsByDay(env: CloudflareEnv, since: Date, until: Date): Promise<WorkerErrorsRow[]> {
  const serviceOf = new Map(Object.entries(WORKER_SCRIPT_NAMES).map(([service, script]) => [script, service as OpsServiceName]));
  const scripts = JSON.stringify(Object.values(WORKER_SCRIPT_NAMES));

  const windows: Array<[Date, Date]> = [];
  for (let start = since.getTime(); start < until.getTime(); start += MAX_WINDOW_DAYS * DAY_MS) {
    windows.push([new Date(start), new Date(Math.min(start + MAX_WINDOW_DAYS * DAY_MS, until.getTime()))]);
  }

  const chunks = await Promise.all(
    windows.map(([from, to]) =>
      queryDataset<{ sum: { requests: number }; dimensions: { date: string; scriptName: string; status: string; scriptVersion: string } }>(
        env,
        'workersInvocationsAdaptive',
        `(limit: ${ROW_LIMIT}, filter: { datetime_geq: $since, datetime_lt: $until, scriptName_in: ${scripts}, scriptVersion_neq: "", status_notin: ${JSON.stringify(NOT_ERROR_STATUSES)} }) { sum { requests } dimensions { date scriptName status scriptVersion } }`,
        { since: 'Time', until: 'Time' },
        { since: from.toISOString(), until: to.toISOString() }
      )
    )
  );

  const totals = new Map<string, WorkerErrorsRow>();
  for (const row of chunks.flat()) {
    const { date, scriptName, status, scriptVersion } = row.dimensions;
    const service = serviceOf.get(scriptName);
    if (!service || !scriptVersion || NOT_ERROR_STATUSES.includes(status)) continue;
    const key = `${date}|${service}`;
    const total = totals.get(key) ?? { day: date, service, errors: 0 };
    total.errors += row.sum.requests;
    totals.set(key, total);
  }
  return [...totals.values()].sort((a, b) => a.day.localeCompare(b.day) || a.service.localeCompare(b.service));
}

// ── 模型以外的计费项 ───────────────────────────────────────────────────

/**
 * R2 的 A 类操作（改状态的那些），名单照 R2 定价页（2026-10-05 读）。
 * 数据集里的 `actionType` 就是这些名字；B 类和免费的（DeleteObject 等）不计。
 */
const R2_CLASS_A_ACTIONS = new Set([
  'ListBuckets',
  'PutBucket',
  'ListObjects',
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
  'CreateMultipartUpload',
  'LifecycleStorageTierTransition',
  'ListMultipartUploads',
  'UploadPart',
  'UploadPartCopy',
  'ListParts',
  'PutBucketEncryption',
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
]);

const DATE_RANGE = { from: 'Date', to: 'Date' } as const;
const dateRangeFilter = `(limit: ${ROW_LIMIT}, filter: { date_geq: $from, date_leq: $to })`;

/** 全账户 Worker 调用数与 CPU 毫秒（含本地预览会话：它们同样计费） */
export async function workersUsage(env: CloudflareEnv, from: string, to: string): Promise<{ requests: number; cpuMs: number }> {
  const rows = await queryDataset<{ sum: { requests: number; cpuTimeUs: number } }>(
    env,
    'workersInvocationsAdaptive',
    `${dateRangeFilter} { sum { requests cpuTimeUs } }`,
    DATE_RANGE,
    { from, to }
  );
  return {
    requests: rows.reduce((sum, r) => sum + r.sum.requests, 0),
    cpuMs: rows.reduce((sum, r) => sum + r.sum.cpuTimeUs, 0) / 1000,
  };
}

/** Durable Objects 的 duration，单位 GB-s（计费单位；数据集已按 128 MB 折算） */
export async function durableObjectsDurationGbSeconds(env: CloudflareEnv, from: string, to: string): Promise<number> {
  const rows = await queryDataset<{ sum: { duration: number } }>(
    env,
    'durableObjectsPeriodicGroups',
    `${dateRangeFilter} { sum { duration } }`,
    DATE_RANGE,
    { from, to }
  );
  return rows.reduce((sum, r) => sum + r.sum.duration, 0);
}

export async function r2ClassAOperations(env: CloudflareEnv, from: string, to: string): Promise<number> {
  const rows = await queryDataset<{ sum: { requests: number }; dimensions: { actionType: string } }>(
    env,
    'r2OperationsAdaptiveGroups',
    `${dateRangeFilter} { sum { requests } dimensions { actionType } }`,
    DATE_RANGE,
    { from, to }
  );
  return rows.reduce((sum, r) => sum + (R2_CLASS_A_ACTIONS.has(r.dimensions.actionType) ? r.sum.requests : 0), 0);
}

/** Queues 的计费操作数（写、读、删各算一次） */
export async function queuesOperations(env: CloudflareEnv, from: string, to: string): Promise<number> {
  const rows = await queryDataset<{ sum: { billableOperations: number } }>(
    env,
    'queueMessageOperationsAdaptiveGroups',
    `${dateRangeFilter} { sum { billableOperations } }`,
    DATE_RANGE,
    { from, to }
  );
  return rows.reduce((sum, r) => sum + r.sum.billableOperations, 0);
}
