/**
 * 传感器读数落盘（按 trace_id 归档到 R2）。
 *
 * 为什么需要：只写 console 的传感器读数落在 Workers Logs 里，保留期有限、且没法按 run 关联，
 * 做 error-analysis 时答不了「近一个月发生率与趋势」——**为定位问题而建的传感器，
 * 自己成了最难定位的部分**。现在只有输出语言一个传感器（call-llm.ts）。
 *
 * 形状刻意与 llm-call-logger 对齐（同一个 bucket、同一套 trace_id 主键、同样 best-effort）：
 *   observability/sensors/{trace_id}/{kind}-{idx 3位}.json
 * 一次 run 内同类传感器可能触发多次，故带 idx。
 */
import type { CloudflareEnv } from '../types';
import type { TraceContext } from './llm-call-logger';
import { sensorKey } from '@meridian/contracts';

export type SensorKind = 'output_language';

/**
 * 落一条传感器读数。无 trace_id 或无 R2 binding 时静默跳过（本地/单测场景）。
 * 必须 await：CF Worker 在响应返回后会取消未完成的异步任务，fire-and-forget 的 put 会丢。
 */
export async function recordSensor(
  env: CloudflareEnv,
  trace: TraceContext,
  kind: SensorKind,
  payload: Record<string, unknown>,
  idx = 0
): Promise<void> {
  const bucket = (env as any).ARTICLES_BUCKET as R2Bucket | undefined;
  if (!trace?.traceId || !bucket) return;
  const key = sensorKey(trace.traceId, kind, idx);
  try {
    await bucket.put(
      key,
      JSON.stringify({ trace_id: trace.traceId, kind, timestamp: new Date().toISOString(), ...payload }, null, 2)
    );
  } catch (e) {
    // 观测写入失败绝不能拖垮主流程——但要留痕，否则"传感器没数据"和"没触发"无法区分
    console.warn(`[SensorLog] 落盘失败 ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
