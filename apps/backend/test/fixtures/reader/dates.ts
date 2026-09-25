/**
 * 读者视图快照的「当前时间」冻结。
 *
 * 线索的「N 天前更新」、后台的近 7 天 / 今日 / 过期源都随当前时间变，快照不能存绝对日期。做法：
 * 1. fixture 的每个时间戳都写成「锚点日 + 偏移」（fixture.ts 的 `at()`），锚点日取数据库的 CURRENT_DATE
 *    （线索的 days_since_update 就是按它算的），所以哪天跑相对关系都一样；
 * 2. 存快照前把响应里的日期换成相对锚点的记号（`tokenizeDates`）：ISO 日期 `2026-09-24T…` → `{D-2}T…`，
 *    中文长日期「2026 年 9 月 24 日」→ `{D-2 年月日}`，短日期「9 月 24 日」→ `{D-2 月日}`（年份取离锚点最近的那年）；
 * 3. 前端测试回放 backend 快照时反过来（`detokenizeDates`）把 `{D±k}T` 还原成某个锚点下的真实日期。
 *    backend 只回 ISO 日期（中文日期是前端的展示），所以只需要还原这一种。
 *
 * fixture 的时间都在当天 12:00 UTC 前后，离「今天 / 7 天前 / 过期」这些边界至少隔几小时，
 * 一天里什么时刻跑、数据库时区是不是 UTC 都不影响结果（fixture.ts 顶部逐条说明）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD'（数据库 CURRENT_DATE::text）→ 当天 00:00 UTC */
export function anchorFromDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function offsetOf(anchor: Date, y: number, m: number, d: number): string {
  const k = Math.round((Date.UTC(y, m - 1, d) - anchor.getTime()) / DAY_MS);
  return k >= 0 ? `+${k}` : String(k);
}

export function tokenizeDates(text: string, anchor: Date): string {
  const anchorYear = anchor.getUTCFullYear();
  return text
    .replace(/(\d{4})-(\d{2})-(\d{2})T/g, (_, y, m, d) => `{D${offsetOf(anchor, +y, +m, +d)}}T`)
    .replace(/(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/g, (_, y, m, d) => `{D${offsetOf(anchor, +y, +m, +d)} 年月日}`)
    .replace(/(\d{1,2}) 月 (\d{1,2}) 日/g, (_, m, d) => {
      // 短日期没有年份：取离锚点最近的那一年
      const candidates = [anchorYear - 1, anchorYear, anchorYear + 1].map(y => offsetOf(anchor, y, +m, +d));
      const nearest = candidates.reduce((a, b) => (Math.abs(+a) <= Math.abs(+b) ? a : b));
      return `{D${nearest} 月日}`;
    });
}

export function detokenizeDates(text: string, anchor: Date): string {
  return text.replace(
    /\{D([+-]\d+)\}T/g,
    (_, k) => `${new Date(anchor.getTime() + Number(k) * DAY_MS).toISOString().slice(0, 10)}T`
  );
}
