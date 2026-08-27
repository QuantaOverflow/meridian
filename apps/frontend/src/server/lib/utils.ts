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

const DB_CONTEXT_KEY = '_meridianDb';

/**
 * 数据库句柄，在**单次请求内**复用。
 *
 * 每次调用 getDb(url) 都新建连接池的话，到 Neon（ap-southeast-1）的 TLS 握手实测约
 * 2.5 秒，而握手完之后查询几乎免费（同一连接跑 5 条查询同样是 2.5 秒）。调两次 getDB
 * 的接口（briefDetail 与 briefSources 并行取数就是这种）会翻倍到 5-7 秒。所以要复用。
 *
 * 但复用**不能跨请求**。postgres.js 底下是一条 TCP socket，而 Cloudflare Workers 里
 * socket 属于创建它的那次请求的 I/O 上下文；同一个 isolate 接到下一个请求再碰它，
 * runtime 直接抛 "Cannot perform I/O on behalf of a different request"。
 * 曾经用模块级 Map 缓存，生产上约三分之一的请求因此 500——且只在生产复现，
 * 本地 dev 是单个 Node 进程没有这层隔离，一路绿灯。
 *
 * 于是缓存挂在 event.context 上：请求内共享，请求结束即随 event 一起丢弃。
 */
export function getDB(event: H3Event): ReturnType<typeof getDb> {
  const cached = event.context[DB_CONTEXT_KEY] as ReturnType<typeof getDb> | undefined;
  if (cached !== undefined) return cached;

  const db = getDb(useRuntimeConfig(event).database.url, {
    // Neon 会主动关掉闲置连接。池子不回收的话偶尔会拿到一条已死的连接、
    // 请求一直挂到超时——实测出现过一次 40 秒。让 postgres.js 提前回收。
    idle_timeout: 20,
    connect_timeout: 15,
  });
  event.context[DB_CONTEXT_KEY] = db;
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
