import { describe, expect, it } from 'vitest';
import { formatReportDate, formatReportDateShort } from '../src/server/lib/utils';

// 站内英文化（04 票）：日期展示从中文长/短日期换成英文。覆盖年度边界（golden 用的锚点日
// 2026-01-10），确认跨年不会把月份算错。
describe('formatReportDate', () => {
  it('长日期渲染为英文，如 "August 25, 2026"', () => {
    expect(formatReportDate(new Date('2026-08-25T12:00:00Z'))).toBe('August 25, 2026');
  });

  it('年初的日期（golden 锚点 2026-01-10）不会被 UTC 换算推到上一年', () => {
    expect(formatReportDate(new Date('2026-01-10T12:00:00Z'))).toBe('January 10, 2026');
  });
});

describe('formatReportDateShort', () => {
  it('短日期渲染为英文、不带年份，如 "Aug 25"', () => {
    expect(formatReportDateShort(new Date('2026-08-25T12:00:00Z'))).toBe('Aug 25');
  });

  it('年初的日期（golden 锚点 2026-01-10）渲染为 "Jan 10"', () => {
    expect(formatReportDateShort(new Date('2026-01-10T12:00:00Z'))).toBe('Jan 10');
  });
});
