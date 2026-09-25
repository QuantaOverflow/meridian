import type { getDb } from '../database';

/**
 * 读者视图的查询都接收调用方传进来的 db：一次请求建一个（`getDb(env.HYPERDRIVE)`），同一请求里的几条并行查询共用它。
 * 不能缓存到模块级跨请求复用——Workers 里 socket 属于创建它的那次请求，见 .claude/rules/workers.md「只在 Workers 生产才炸的两类 bug」。
 */
export type Db = ReturnType<typeof getDb>;

/**
 * `db.execute` 的原生 SQL 结果里，timestamp（无时区）列是 Postgres 的原文 `2026-09-24 12:00:00`
 * （drizzle 的 postgres-js 驱动把日期类型的解析关掉了）。按 UTC 解释，与 drizzle 查询构造器对同一列的映射一致。
 */
export function pgTimestamp(value: string | Date): Date {
  return value instanceof Date ? value : new Date(`${value}+0000`);
}
