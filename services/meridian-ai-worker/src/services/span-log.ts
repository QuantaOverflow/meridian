/**
 * Span 落盘（按 trace_id 归档到 R2）。
 *
 * 从 `apps/backend/prototypes/block-writer/obs.ts` 搬入。原型那边解决的是「离线做
 * error analysis 时能不能查」，生产这边是同一个问题：
 * 证据链（判断声明 → 检索 → 自检找漏 → 重写）每一段的读数此前只写 console，
 * 落在 Workers Logs 里保留期有限、没法按 run 关联，也没法回答「近一个月补漏的
 * 增益/损失比是多少」这类必须跨 run 聚合的问题。
 *
 * 与既有两套观测的分工（同一个 bucket、同一套 trace_id 主键、同样 best-effort）：
 *   llm-calls/{trace}/{phase}-{idx}.json        一次 LLM 调用的完整 I/O
 *   observability/sensors/{trace}/{kind}-{idx}  成品上的传感器读数（卫生、块间一致性）
 *   observability/spans/{trace}/…               ← 本文件：管线内部各段的结构化过程
 *
 * 「落盘 vs 派生」的分界照搬原型的判据：**重建时要不要重跑会变的代码**。
 * 纯计数（claims 几条、gap 几条）本可从 llm-calls 重算，但重算依赖 parseLooseJSON /
 * dedupeByText / backingFor 的当前实现，而这三个本轮各改过至少一次——所以落。
 *
 * ——— 原型那边按 codex review 修出来的六条，逐条对应到这里 ———
 *
 * ① **trace_id 必须是一次执行的唯一 id**。生产里 trace_id = workflow_id，天然唯一，
 *    不用再造。但 span_id 不能用自增序号：b′ 的块写作是 N 次独立 HTTP 调用，
 *    模块级计数器在 Workers 里跨请求不可靠（同 isolate 复用会串号，换 isolate 会重头）。
 *    故 span_id 用 randomUUID。
 * ② **失败与重试必须各自成 span**。CF Workflow 的 step 重试会用同一个 trace_id 与
 *    同一个 callIndex 再跑一遍，key 若只由这两者决定，重试就会**覆盖掉失败那次的记录**，
 *    于是「哪一段最常失败」查出来的永远是「重试成功之后的样子」。key 里带 span_id 后缀
 *    即可，两次尝试各留一份，用 started_at 排序。
 * ③ **落进 span 的 text 必须是真正进了 prompt 的那段**。故 claims/gaps 的 backing 落的是
 *    `expand()` 扩展后的窗口原文，不是命中的中心句。
 * ④ **时间戳在操作真正开始时取**（见 `timeSpan`），不是事后补记。
 * ⑤ 派生判定要记 evaluator 名与阈值——本文件不做判定，只记事实，判定留给查询层。
 * ⑥ **必须记版本**。原型用 git HEAD；生产这边没有 git，用 CF 的 version_metadata binding
 *    （`wrangler.toml` 的 `[version_metadata]`）。但它给的是**部署实例 id 不是代码版本**：
 *    同一个 commit 重部署两次会被拆成两个"版本"，而本地 `wrangler dev` 每次启动都换一个
 *    随机 uuid——本地又直连生产 R2，不加区分的话本地试跑会把聚合打成无数个孤立版本。
 *    故拆成两个字段：`deployment_version`（部署实例，可能同码不同值）与
 *    `runtime_env`（development / production，本地数据按它过滤掉）。
 *    真正稳定的 code_revision 需要构建期注入 git sha，暂未做——**别把部署 id 当代码版本读**。
 */
import type { CloudflareEnv } from '../types';
import type { TraceContext } from './llm-call-logger';

export const SPAN_SCHEMA_VERSION = 1;

/** 粗粒度阶段，查询时按它分组。加新段先在这里加名字，别塞进 name 里 */
export type SpanStage = 'block' | 'evidence' | 'step';

export interface Span {
  span_id: string;
  /** 一次 workflow 执行的 id。**不要放块序号进去**，那是维度不是身份 */
  trace_id: string;
  parent_span_id: string | null;
  schema_version: number;
  /** 这次**部署**的 CF version id（不是代码版本，同码重部署会变）；未配 binding 时 'unknown' */
  deployment_version: string;
  /** development / production。本地直连生产 R2，聚合时按它把本地数据滤掉 */
  runtime_env: string;
  name: string;
  stage: SpanStage;
  status: 'ok' | 'error';
  started_at: string;
  duration_ms: number;
  attributes: Record<string, unknown>;
}

function deploymentVersion(env: CloudflareEnv): string {
  const v = (env as any).CF_VERSION_METADATA as { id?: string } | undefined;
  return v?.id ?? 'unknown';
}

export function newSpanId(): string {
  return crypto.randomUUID();
}

/**
 * 落一条 span。无 trace_id 或无 R2 binding 时静默跳过（本地/单测场景）。
 *
 * 必须 await：CF Worker 在响应返回后会取消未完成的异步任务，fire-and-forget 的 put 会丢。
 * 写入失败只 warn 不抛——观测绝不能拖垮主流程，但要留痕，否则「没数据」和「没触发」分不开。
 */
export async function recordSpan(
  env: CloudflareEnv,
  trace: TraceContext,
  o: {
    name: string;
    stage: SpanStage;
    attributes: Record<string, unknown>;
    /** 块序号，只用来给 R2 key 分组，语义在 attributes 里 */
    idx?: number;
    spanId?: string;
    parent?: string | null;
    startedAt?: string;
    durationMs?: number;
    status?: 'ok' | 'error';
  }
): Promise<string> {
  const spanId = o.spanId ?? newSpanId();
  const bucket = (env as any).ARTICLES_BUCKET as R2Bucket | undefined;
  if (!trace?.traceId || !bucket) return spanId;

  const span: Span = {
    span_id: spanId,
    trace_id: trace.traceId,
    parent_span_id: o.parent ?? null,
    schema_version: SPAN_SCHEMA_VERSION,
    deployment_version: deploymentVersion(env),
    runtime_env: env.ENVIRONMENT ?? 'unknown',
    name: o.name,
    stage: o.stage,
    status: o.status ?? 'ok',
    started_at: o.startedAt ?? new Date().toISOString(),
    duration_ms: o.durationMs ?? 0,
    attributes: o.attributes,
  };
  // key 里同时有 name/idx（供按前缀捞同一段）与完整 span_id 后缀（供 step 重试各留一份，见 ②）。
  // 用完整 uuid 不用前 8 位：截断留下一个 32-bit 碰撞面，代价是静默覆盖掉一次失败历史，
  // 而 key 长一点在 R2 上什么都不多花。
  const key =
    `observability/spans/${trace.traceId}/` +
    `${o.name}-${String(o.idx ?? 0).padStart(3, '0')}-${spanId}.json`;
  try {
    await bucket.put(key, JSON.stringify(span, null, 2));
  } catch (e) {
    console.warn(`[SpanLog] 落盘失败 ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return spanId;
}

/**
 * 包一段异步操作：**开始时**取时间戳（见 ④），失败也落 span（status=error）后再抛。
 * `attrs` 在 fn 结束后调用，用来把结果并进 attributes——失败时它拿到的是 undefined。
 */
export async function timeSpan<T>(
  env: CloudflareEnv,
  trace: TraceContext,
  o: {
    name: string;
    stage: SpanStage;
    attributes?: Record<string, unknown>;
    idx?: number;
    spanId?: string;
    parent?: string | null;
  },
  fn: () => Promise<T>,
  attrs?: (r: T | undefined, err: unknown) => Record<string, unknown>
): Promise<T> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  let r: T | undefined;
  let err: unknown;
  try {
    r = await fn();
  } catch (e) {
    err = e;
  }
  await recordSpan(env, trace, {
    ...o,
    startedAt,
    durationMs: Date.now() - t0,
    status: err ? 'error' : 'ok',
    attributes: {
      ...(o.attributes ?? {}),
      ...(attrs?.(r, err) ?? {}),
      ...(err ? { error: String((err as any)?.message ?? err) } : {}),
    },
  });
  if (err) throw err;
  return r as T;
}
