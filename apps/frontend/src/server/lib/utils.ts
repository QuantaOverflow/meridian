export function ensureDate(dateInput: Date | string | null | undefined): Date {
  return dateInput ? new Date(dateInput) : new Date();
}

/**
 * 长日期，如「August 25, 2026」。
 *
 * 取 UTC 字段：旧的日期 slug（如 august-25-2026）按 UTC 日期解析，展示若换成本地时区，
 * 跨零点的那几个小时会出现「页面写 August 26、URL 却是 august-25」的错位。
 */
export function formatReportDate(date: Date): string {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

/** 短日期，如「Aug 25」，用于归档列表 */
export function formatReportDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}
