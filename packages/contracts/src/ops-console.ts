/**
 * 运维台（Ops console）的接口约定：backend `/observability/ops/*` 的响应，前端 `/api/admin/ops/*` 原样转发。
 * 术语见根目录 CONTEXT.md「运维台」。日期一律是 UTC 的 ISO 字符串，换北京时间在前端做。
 * 某块数据的来源（Cloudflare、R2）读不到时，该块给 `{ unavailable: 原因 }`，接口照常回 200。
 */

export type OpsLevel = 'ok' | 'yellow' | 'red';

/** 这一块读不到数据；`unavailable` 是给人看的原因 */
export interface OpsUnavailable {
  unavailable: string;
}

/** 写作–核查循环各块的收尾（同 brief-v3 记录的 check.outcome），外加拿不到核查记录的 `missing` */
export type OpsCheckOutcome = 'off' | 'clean' | 'fixed' | 'revise_failed' | 'still_flagged' | 'missing';

/** `brief_runs.ops_summary`：run 结束时写下的汇总，页面不必再去 R2 逐条加 */
export interface RunOpsSummary {
  v: 1;
  llm: {
    calls: number;
    neurons: number;
    byPhase: Record<string, { calls: number; neurons: number }>;
  };
  steps: Array<{
    name: string;
    status: 'completed' | 'degraded' | 'failed';
    startedAt: string;
    ms: number;
  }>;
  blocks: {
    expected: number;
    written: number;
    tiers: { lead: number; more: number; brief: number };
    writeRejects: number;
  } | null;
  check: {
    outcomes: Record<OpsCheckOutcome, number>;
    uncheckedBlocks: number;
    revisions: number;
  } | null;
  degradedReasons: string[];
}

export type OpsRunStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'DEGRADED'
  | 'FAILED'
  | 'BLOCKED_FAITHFULNESS'
  | 'TERMINATED_NO_STORIES';

export type OpsRunFlag = 'slow' | 'costly' | 'degraded' | 'failed' | 'no_stories' | 'late';

/** 一次生产运行。`calls` / `neurons` / `usd` 为 null = 这次运行没有记下汇总 */
export interface OpsRunRow {
  workflowId: string;
  status: OpsRunStatus;
  level: OpsLevel;
  flags: OpsRunFlag[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  articles: number | null;
  stories: number | null;
  blocks: number | null;
  calls: number | null;
  neurons: number | null;
  usd: number | null;
}

export type OpsServiceName = 'backend' | 'ai-worker' | 'ml-service';

export interface OpsServiceVersion {
  service: OpsServiceName;
  commit: string | null;
  title: string | null;
  dirty: boolean | null;
  deployedAt: string | null;
  versionId: string | null;
  health: 'healthy' | 'unhealthy' | 'unknown';
}

export type OpsSourceKind = 'ok' | 'not_checked' | 'dead_feed' | 'fetch_failing' | 'bad_body' | 'paused';

export type OpsAttentionLink = 'trends' | 'cost' | 'sources' | { run: string };

/** GET /observability/ops/health */
export interface OpsHealth {
  generatedAt: string;
  today: {
    state: 'scheduled' | 'running' | 'done';
    level: OpsLevel;
    run: OpsRunRow | null;
    /** 基线内的运行数（判慢 / 贵要满 `baselineMin` 次） */
    baselineRuns: number;
    baselineMin: number;
    medianDurationMs: number | null;
    slowAboveMs: number | null;
  };
  ingest24h: {
    processed: number;
    fetchFailed: number;
    junk: number;
    viaBrowser: number;
    bodies: number;
    singleLine: number;
    level: OpsLevel;
  };
  services: OpsServiceVersion[];
  workerErrors24h: Record<OpsServiceName, number> | OpsUnavailable;
  sources: {
    counts: Record<OpsSourceKind, number>;
    worst: Array<{ id: number; name: string; kind: OpsSourceKind; detail: string }>;
  };
  spend:
    | {
        cycleStart: string;
        cycleEnd: string;
        day: number;
        days: number;
        neurons: number;
        freePool: number;
        usd: number;
        productionShare: number | null;
      }
    | OpsUnavailable;
  attention: Array<{
    level: 'yellow' | 'red';
    title: string;
    detail: string;
    link: OpsAttentionLink;
  }>;
  /** 最近 14 次生产运行，新的在前 */
  runs: OpsRunRow[];
}

/** GET /observability/ops/trends?days=30（7–90，默认 30） */
export interface OpsTrends {
  days: number;
  /** 范围内的生产运行，旧的在前 */
  runs: OpsRunRow[];
  medianDurationMs: number | null;
  medianUsd: number | null;
  /** 按北京日；`singleLine` 为 null = 那天还没开始记 */
  ingest: Array<{
    day: string;
    processed: number;
    fetchFailed: number;
    junk: number;
    bodies: number;
    singleLine: number | null;
  }>;
  workerErrors: Array<{ day: string; backend: number; aiWorker: number; mlService: number }> | OpsUnavailable;
  /** 只列有核查记录的运行 */
  checks: Array<{
    workflowId: string;
    day: string;
    clean: number;
    fixed: number;
    unchecked: number;
    notWritten: number;
  }>;
}

/** GET /observability/ops/cost?cycle=current|previous */
export interface OpsCost {
  cycle: { start: string; end: string; day: number; days: number; complete: boolean };
  account: { neurons: number; freePool: number; billable: number; usd: number; planFeeUsd: number } | OpsUnavailable;
  production:
    | { neurons: number; runs: number; runNeurons: number; analysisNeurons: number; share: number }
    | OpsUnavailable;
  /** 按 UTC 日（与账单一致） */
  daily: Array<{ day: string; byModel: Record<string, number> }> | OpsUnavailable;
  byModel: Array<{ modelId: string; neurons: number; share: number; usdAtList: number }> | OpsUnavailable;
  lastRunByStep: {
    workflowId: string;
    day: string;
    steps: Array<{ phase: string; calls: number; neurons: number; usd: number }>;
  } | null;
  /** 读不到的项留在表里，数值给 null */
  otherItems: Array<{
    name: string;
    used: number | null;
    allowance: number | null;
    unit: string;
    share: number | null;
  }>;
}

/** GET /observability/ops/sources */
export interface OpsSources {
  generatedAt: string;
  counts: Record<OpsSourceKind, number>;
  sources: Array<{
    id: number;
    name: string;
    url: string;
    category: string;
    frequency: string;
    kind: OpsSourceKind;
    level: OpsLevel | 'grey';
    lastChecked: string | null;
    /** 抓取程序最近一轮（成功或失败）是什么时候；null = 加这个记录之前，或还没跑过 */
    lastAttemptAt: string | null;
    /** 最近一轮失败的原因（如 `Fetch failed with status: 406 Not Acceptable`）；最近一轮成功时是 null */
    lastError: string | null;
    lastArticleAt: string | null;
    pausedAt: string | null;
    articles7d: number;
    articles48h: number;
    fetchFailedPct: number | null;
    junkPct: number | null;
    singleLinePct: number | null;
    viaBrowserPct: number | null;
  }>;
  thresholds: {
    fetchFailingPct: number;
    badBodyPct: number;
    deadFeedMinArticles7d: number;
    deadFeedQuietHours: number;
  };
}

/** GET /observability/ops/runs/:workflowId */
export interface OpsRunDetail {
  run: OpsRunRow;
  params: unknown;
  error: string | null;
  summary: RunOpsSummary | null;
  blocks:
    | Array<{
        index: number;
        tier: 'lead' | 'more' | 'brief';
        title: string;
        articles: number;
        check: { outcome: string; revisions: number; unchecked: number } | null;
        refusals: number;
        calls: number;
        neurons: number;
        usd: number;
      }>
    | OpsUnavailable;
}

/** Workers AI 牌价：每 1,000 neurons 的美元数（单次运行成本按牌价算，不扣免费池） */
export const USD_PER_1K_NEURONS = 0.011;
