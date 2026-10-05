/**
 * 一条模型调用属于运行里的哪一块。规则取自 ai-worker 的 services/brief-block-v6.ts：
 * - phase `brief_block_v6`（标重点 / 写作 / 改写）：callIndex = 600 + 块序号 × 100 + 块内计数
 * - phase `brief_block_v6_check`（逐句核查）：callIndex = 块序号 × 1000 + 块内计数
 * 块序号就是 brief-v3 记录里的 storyIdx（backend 以 x-call-index 传给 ai-worker）。其它 phase 不属于任何块。
 */
const WRITE_BASE = 600;
const WRITE_STRIDE = 100;
const CHECK_STRIDE = 1000;

export function blockIndexOfCall(phase: string | undefined, callIndex: number | undefined): number | null {
  if (callIndex === undefined) return null;
  if (phase === 'brief_block_v6') return callIndex >= WRITE_BASE ? Math.floor((callIndex - WRITE_BASE) / WRITE_STRIDE) : null;
  if (phase === 'brief_block_v6_check') return Math.floor(callIndex / CHECK_STRIDE);
  return null;
}
