import { getDb } from '@meridian/database';
import type { H3Event } from 'h3';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface FormattedDate {
  month: string;
  day: number;
  year: number;
}

export function formatReportDate(date: Date): FormattedDate {
  return {
    month: MONTH_NAMES[date.getUTCMonth()],
    day: date.getUTCDate(),
    year: date.getUTCFullYear(),
  };
}

export function generateReportSlug(date: Date): string {
  const { month, day, year } = formatReportDate(date);
  return `${month.toLowerCase()}-${day}-${year}`;
}

export function ensureDate(dateInput: Date | string | null | undefined): Date {
  return dateInput ? new Date(dateInput) : new Date();
}

/**
 * 数据库句柄，按连接串在进程内复用。
 *
 * 原实现每次请求都 getDb(url) 新建一个连接池。到 Neon（ap-southeast-1）的 TLS 握手
 * 实测约 2.5 秒，而握手完之后查询本身几乎免费（同一连接跑 5 条查询同样是 2.5 秒）。
 * 于是每个接口至少 2.5 秒起步，调两次 getDB 的接口翻倍到 5-7 秒，页面切换肉眼可见地卡。
 *
 * postgres.js 的返回值本来就是**长期持有**的连接池，重建它没有任何好处。
 * 按 url 做 key 而不是单例，是为了让不同连接串（如测试库）互不干扰。
 */
const dbCache = new Map<string, ReturnType<typeof getDb>>();

export function getDB(event: H3Event) {
  const url = useRuntimeConfig(event).database.url;
  let db = dbCache.get(url);
  if (db === undefined) {
    db = getDb(url, {
      // Neon 会主动关掉闲置连接。池子不回收的话偶尔会拿到一条已死的连接、
      // 请求一直挂到超时——实测出现过一次 40 秒。让 postgres.js 提前回收。
      idle_timeout: 20,
      connect_timeout: 15,
    });
    dbCache.set(url, db);
  }
  return db;
}

/**
 * 中文长日期，如「2026 年 8 月 25 日」。
 *
 * 刻意和 formatReportDate / generateReportSlug 一样取 UTC 字段：slug 就是按 UTC 日期
 * 生成的，展示若换成本地时区，跨零点的那几个小时会出现「页面写 8 月 26 日、URL 却是
 * august-25」的错位。
 */
export function formatReportDateCN(date: Date): string {
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

/** 短日期，如「8 月 25 日」，用于归档列表 */
export function formatReportDateShortCN(date: Date): string {
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}
