/**
 * 观测 wrapper：请求内的每个步骤用 `traced()` 包一行，父子关系、耗时、成败、异常、
 * 以及步骤里发生的 LLM 调用都自动记下，调用方不再手写 recordSpan、不再手传 parent。
 * 设计依据：docs/engineering-notes/llm-observability-integration-patterns.md（业界的 wrapper +
 * 隐式上下文 + 埋点与去向分离）。
 *
 * 去向按请求选，由 `observeMiddleware` 在请求入口决定：
 *   x-observe: inline         → 记录收在本请求自己的内存里，随 JSON 响应的 `observation` 字段带回。
 *                                开发 / 验收用，不写 R2（本地 wrangler dev 直连生产桶，写了就是污染）
 *   只有 x-trace-id            → 步骤写 R2 `observability/spans/`（与 span-log 同一套 schema）。
 *                                LLM I/O 已由 llm-call-logger 落 `llm-calls/`，这里不重复；请求本身也不落，
 *                                免得给所有带 trace 的旧端点平添 R2 写入
 *   都没有                     → 不记，被包的函数照常执行
 *
 * 收集器挂在每个请求自己的上下文里，不放模块级数组：同一个 isolate 会被多个请求共用，
 * 模块级状态会串请求。
 *
 * AsyncLocalStorage 只在同一次请求内传递上下文；跨请求（backend → ai-worker、Workflow step 重试）
 * 仍靠 x-trace-id 头显式传——Workers 的 ALS 绑定不能跨请求（CF 官方文档）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import type { CloudflareEnv } from '../types';
import { newSpanId, recordSpan } from './span-log';

export type ObserveMode = 'inline' | 'r2';

/** 字段形状对齐 OTel（trace / span / parent / attributes），以后要接外部平台只需多写一个去向。 */
export interface ObservedSpan {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: 'request' | 'step' | 'llm';
  status: 'ok' | 'error';
  started_at: string;
  duration_ms: number;
  attributes: Record<string, unknown>;
}

interface Scope { traceId: string; mode: ObserveMode; env: CloudflareEnv; spans: ObservedSpan[] }
interface Frame { scope: Scope; span: ObservedSpan }

const als = new AsyncLocalStorage<Frame>();

async function emit(scope: Scope, s: ObservedSpan): Promise<void> {
  if (scope.mode === 'inline') {
    scope.spans.push(s);
    return;
  }
  if (s.kind !== 'step') return;
  // recordSpan 自己吞写入错误只 warn：观测不能拖垮主流程
  await recordSpan(scope.env, { traceId: scope.traceId }, {
    name: s.name, stage: 'step', spanId: s.span_id, parent: s.parent_span_id,
    startedAt: s.started_at, durationMs: s.duration_ms, status: s.status, attributes: s.attributes,
  });
}

async function run<T>(
  scope: Scope, parent: ObservedSpan | null, name: string, kind: ObservedSpan['kind'],
  fn: () => Promise<T>, attrs: Record<string, unknown> = {}
): Promise<T> {
  const span: ObservedSpan = {
    span_id: newSpanId(), trace_id: scope.traceId, parent_span_id: parent?.span_id ?? null,
    name, kind, status: 'ok', started_at: new Date().toISOString(), duration_ms: 0, attributes: { ...attrs },
  };
  const t0 = Date.now();
  try {
    return await als.run({ scope, span }, fn);
  } catch (e) {
    // 失败也成 span：只记成功的话，「哪一步最常失败」查出来的永远是重试成功之后的样子
    span.status = 'error';
    span.attributes.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    span.duration_ms = Date.now() - t0;
    await emit(scope, span);
  }
}

/** 包一个步骤。请求没开观测、或在 node 里直接调用（没有上下文）时原样执行。 */
export function traced<T>(name: string, fn: () => Promise<T>, attrs?: Record<string, unknown>): Promise<T> {
  const f = als.getStore();
  if (!f) return fn();
  return run(f.scope, f.span, name, 'step', fn, attrs);
}

/** 给当前步骤补业务读数（条数、命中数……）。没有上下文时什么都不做。 */
export function annotate(attrs: Record<string, unknown>): void {
  const f = als.getStore();
  if (f) Object.assign(f.span.attributes, attrs);
}

/**
 * 一次 LLM 调用挂到当前步骤下（由 llm-call-logger 的 loggedChat 统一调用，业务代码不用管）。
 * 只在 inline 模式记完整 I/O——r2 模式下 llm-call-logger 已经落了 llm-calls/，不重复。
 */
export async function recordLLMCall(info: {
  phase: string; model?: string; params?: Record<string, unknown>; messages: unknown;
  content?: string; finishReason?: string; usage?: unknown; error?: string;
  startedAt: number; latencyMs: number;
}): Promise<void> {
  const f = als.getStore();
  if (!f || f.scope.mode !== 'inline') return;
  await emit(f.scope, {
    span_id: newSpanId(), trace_id: f.scope.traceId, parent_span_id: f.span.span_id,
    name: `llm ${info.phase}`, kind: 'llm', status: info.error ? 'error' : 'ok',
    started_at: new Date(info.startedAt).toISOString(), duration_ms: info.latencyMs,
    attributes: {
      phase: info.phase, model: info.model, params: info.params, messages: info.messages,
      content: info.content, finish_reason: info.finishReason, usage: info.usage, error: info.error,
    },
  });
}

/** 请求入口：按请求头建立观测上下文；inline 模式把记录附到 JSON 响应的 `observation` 字段。 */
export const observeMiddleware: MiddlewareHandler<{ Bindings: CloudflareEnv }> = async (c, next) => {
  const inline = (c.req.header('x-observe') ?? '').toLowerCase() === 'inline';
  const headerTrace = c.req.header('x-trace-id') || undefined;
  if (!inline && !headerTrace) return next();

  const scope: Scope = { traceId: headerTrace ?? `local-${newSpanId()}`, mode: inline ? 'inline' : 'r2', env: c.env, spans: [] };
  await run(scope, null, `${c.req.method} ${c.req.path}`, 'request', () => next());

  if (!inline || !(c.res.headers.get('content-type') ?? '').includes('application/json')) return;
  try {
    const body = await c.res.clone().json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const spans = [...scope.spans].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify({ ...body, observation: { trace_id: scope.traceId, spans } }), { status: c.res.status, headers });
  } catch (e) {
    console.warn(`[observe] 附加 observation 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
};
