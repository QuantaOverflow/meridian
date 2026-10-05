import { describe, expect, it } from 'vitest';
import { beijingCycleRange, beijingDate, beijingDateTime, beijingTime } from '../src/utils/beijingTime';

// 运维台的时间一律是北京时间，不跟运行测试的机器时区走
describe('北京时间格式化', () => {
  it('UTC 13:02:01 是北京 21:02:01', () => {
    expect(beijingTime('2026-10-05T13:02:01.754Z')).toBe('21:02');
    expect(beijingTime('2026-10-05T13:02:01.754Z', true)).toBe('21:02:01');
    expect(beijingDateTime('2026-10-05T13:02:01.754Z')).toBe('Oct 5 21:02');
  });

  it('UTC 傍晚已经是北京的第二天；跨年也对', () => {
    expect(beijingDate('2026-10-05T16:30:00Z')).toBe('Oct 6');
    expect(beijingDateTime('2026-12-31T20:00:00Z')).toBe('Jan 1 04:00');
  });

  it('计费周期按 UTC 零点切，显示成北京 8 点到 8 点；跨年也对', () => {
    expect(beijingCycleRange('2026-10-04', '2026-11-03')).toBe('Oct 4 08:00 – Nov 4 08:00');
    expect(beijingCycleRange('2026-12-04', '2027-01-03')).toBe('Dec 4 08:00 – Jan 4 08:00');
  });

  it('缺失或非法输入返回 -', () => {
    expect(beijingDate(null)).toBe('-');
    expect(beijingTime(undefined)).toBe('-');
    expect(beijingDateTime('not a date')).toBe('-');
  });
});
