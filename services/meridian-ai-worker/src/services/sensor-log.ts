/**
 * 传感器读数落盘（按 trace_id 归档到 R2）。
 *
 * 为什么需要：本项目所有观测数据都按 workflow_id 落 R2 永久保存——步骤 metrics、
 * 每次 LLM 调用的完整 I/O、情报报告、覆盖对账、忠实度 verdict 全在。唯独 2026-08-12
 * 新加的三个传感器（简报卫生检查、情报解析重采样、输出语言）只写 console，落在
 * Workers Logs 里保留期有限、且没法按 run 关联。
 *
 * 后果很具体：做 error-analysis 时最想问的一类问题是「近一个月卫生问题的发生率与趋势」，
 * 而只写 console 的读数答不了——**为定位问题而建的传感器，自己成了最难定位的部分**。
 *
 * 形状刻意与 llm-call-logger 对齐（同一个 bucket、同一套 trace_id 主键、同样 best-effort）：
 *   observability/sensors/{trace_id}/{kind}-{idx 3位}.json
 * 一次 run 内同类传感器可能触发多次（如逐 story 的解析重采样），故带 idx。
 */
import type { CloudflareEnv } from '../types';
import type { TraceContext } from './llm-call-logger';

export type SensorKind = 'brief_hygiene' | 'intel_parse' | 'story_validation_parse' | 'output_language'
  // 块间数值一致性：b′ 分段写独有的缺陷类（每块独立调用，无跨块仲裁者）
  | 'block_consistency';

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
  const key = `observability/sensors/${trace.traceId}/${kind}-${String(idx).padStart(3, '0')}.json`;
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
