import { describe, expect, it } from 'vitest';
import { blockIndexOfCall } from '../src/utils/runCalls';

// 编号规则取自 ai-worker 的 services/brief-block-v6.ts：
// 写作 / 改写 callIndex = 600 + 块序号 × 100 + 块内计数；逐句核查 callIndex = 块序号 × 1000 + 块内计数
describe('模型调用属于哪一块', () => {
  it('写作 / 改写调用：(callIndex - 600) / 100 取整', () => {
    expect(blockIndexOfCall('brief_block_v6', 600)).toBe(0);
    expect(blockIndexOfCall('brief_block_v6', 699)).toBe(0);
    expect(blockIndexOfCall('brief_block_v6', 1001)).toBe(4);
    expect(blockIndexOfCall('brief_block_v6', 3017)).toBe(24);
  });

  it('核查调用：callIndex / 1000 取整', () => {
    expect(blockIndexOfCall('brief_block_v6_check', 0)).toBe(0);
    expect(blockIndexOfCall('brief_block_v6_check', 4000)).toBe(4);
    expect(blockIndexOfCall('brief_block_v6_check', 4671)).toBe(4);
  });

  it('其它 phase 或缺编号：不属于任何块', () => {
    expect(blockIndexOfCall('brief_generation', 690)).toBeNull();
    expect(blockIndexOfCall('brief_block_v6', undefined)).toBeNull();
    expect(blockIndexOfCall(undefined, 700)).toBeNull();
    // 低于起点 600 的写作编号不是块的调用
    expect(blockIndexOfCall('brief_block_v6', 12)).toBeNull();
  });
});
