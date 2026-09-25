export function ensureDate(dateInput: Date | string | null | undefined): Date {
  return dateInput ? new Date(dateInput) : new Date();
}

/**
 * 中文长日期，如「2026 年 8 月 25 日」。
 *
 * 取 UTC 字段：旧的日期 slug（如 august-25-2026）按 UTC 日期解析，展示若换成本地时区，
 * 跨零点的那几个小时会出现「页面写 8 月 26 日、URL 却是 august-25」的错位。
 */
export function formatReportDateCN(date: Date): string {
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

/** 短日期，如「8 月 25 日」，用于归档列表 */
export function formatReportDateShortCN(date: Date): string {
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}
