import { sql } from '@meridian/database';
import type { OpsLevel, OpsSourceKind, OpsSources } from '@meridian/contracts';
import type { Db } from '../reader/db';

/**
 * 运维台「来源异常」的判据：每个源按近 7 天的数据判成六种之一（术语见 CONTEXT.md「来源异常」）。
 * 阈值全在这里，调参改一行。Sources 页（sources.ts）与 Health 页的来源摘要共用 `computeSourceStatuses`。
 */

/** 近多少天算「新文章」的窗口 */
export const SOURCE_WINDOW_DAYS = 7;
/** not_checked：超过「两个抓取间隔」没查过。键是 sources.scrape_frequency（1–4），值是小时数 */
export const NOT_CHECKED_AFTER_HOURS: Record<number, number> = { 1: 2, 2: 8, 3: 12, 4: 48 };
/** dead_feed：7 天内至少这么多篇，最近 DEAD_FEED_QUIET_HOURS 小时却一篇没有 */
export const DEAD_FEED_MIN_ARTICLES_7D = 7;
export const DEAD_FEED_QUIET_HOURS = 48;
/** fetch_failing：新文章里抓取失败的占比超过它（严格大于） */
export const FETCH_FAILING_PCT = 30;
/** bad_body：垃圾页占比或「黏成一行」占比超过它（严格大于，各自判） */
export const BAD_BODY_PCT = 20;
/** fail_reason 以它开头 = 垃圾页，不算抓取失败 */
export const JUNK_REASON_PREFIX = 'EXTRACTION_JUNK:';

const FREQUENCY_LABEL: Record<number, string> = { 1: 'Hourly', 2: '4 Hours', 3: '6 Hours', 4: 'Daily' };

const LEVEL_OF_KIND: Record<OpsSourceKind, OpsLevel | 'grey'> = {
  paused: 'grey',
  not_checked: 'red',
  dead_feed: 'red',
  fetch_failing: 'yellow',
  bad_body: 'yellow',
  ok: 'ok',
};

/** 列表排序：红、黄、ok、灰 */
const KIND_ORDER: OpsSourceKind[] = ['not_checked', 'dead_feed', 'fetch_failing', 'bad_body', 'ok', 'paused'];

export type SourceStatus = OpsSources['sources'][number];

export const SOURCE_THRESHOLDS: OpsSources['thresholds'] = {
  fetchFailingPct: FETCH_FAILING_PCT,
  badBodyPct: BAD_BODY_PCT,
  deadFeedMinArticles7d: DEAD_FEED_MIN_ARTICLES_7D,
  deadFeedQuietHours: DEAD_FEED_QUIET_HOURS,
};

interface Counts {
  n7: number;
  n48: number;
  failed: number;
  junk: number;
  bodies: number;
  singleLine: number;
  browser: number;
}

const HOUR_MS = 3_600_000;

/** 占比的比较用整数乘法（part * 100 > pct * total），避开 3/10*100 = 30.000000000000004 这类浮点误差 */
const over = (part: number, total: number, limitPct: number) => total > 0 && part * 100 > limitPct * total;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);

/** 第一个匹配的赢：paused → not_checked → dead_feed → fetch_failing → bad_body → ok */
function kindOf(
  source: { paused_at: Date | null; scrape_frequency: number; lastChecked: Date | null },
  c: Counts,
  now: Date
): OpsSourceKind {
  if (source.paused_at !== null) return 'paused';
  const staleAfterMs = (NOT_CHECKED_AFTER_HOURS[source.scrape_frequency] ?? NOT_CHECKED_AFTER_HOURS[4]) * HOUR_MS;
  if (source.lastChecked === null || now.getTime() - source.lastChecked.getTime() > staleAfterMs) return 'not_checked';
  if (c.n7 >= DEAD_FEED_MIN_ARTICLES_7D && c.n48 === 0) return 'dead_feed';
  if (over(c.failed, c.n7, FETCH_FAILING_PCT)) return 'fetch_failing';
  if (over(c.junk, c.n7, BAD_BODY_PCT) || over(c.singleLine, c.bodies, BAD_BODY_PCT)) return 'bad_body';
  return 'ok';
}

/** 全部源的状态（含近 7 天各项数字），按严重度排。`now` 由调用方给，测试与 Health 页用同一个时钟 */
export async function computeSourceStatuses(db: Db, now: Date): Promise<SourceStatus[]> {
  const since7d = new Date(now.getTime() - SOURCE_WINDOW_DAYS * 24 * HOUR_MS).toISOString();
  const since48h = new Date(now.getTime() - DEAD_FEED_QUIET_HOURS * HOUR_MS).toISOString();

  // articles.created_at、sources.last_checked 是不带时区的 UTC；ISO 串转 timestamp 时丢掉 Z，值不变
  const [sources, stats, lasts] = await Promise.all([
    db.query.$sources.findMany(),
    db.execute(sql`
      SELECT source_id,
        count(*) AS n7,
        count(*) FILTER (WHERE created_at >= ${since48h}::timestamp) AS n48,
        count(*) FILTER (WHERE status = 'FETCH_FAILED'
          AND NOT starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS failed,
        count(*) FILTER (WHERE starts_with(coalesce(fail_reason, ''), ${JUNK_REASON_PREFIX})) AS junk,
        count(*) FILTER (WHERE body_lines IS NOT NULL) AS bodies,
        count(*) FILTER (WHERE body_lines = 1) AS single_line,
        count(*) FILTER (WHERE used_browser) AS browser
      FROM articles
      WHERE created_at >= ${since7d}::timestamp
      GROUP BY source_id
    `),
    // 最近一篇新文章取全部历史（死掉很久的源也要显示它最后一次出文章的时间）
    db.execute(sql`SELECT source_id, max(created_at) AS last_at FROM articles GROUP BY source_id`),
  ]);

  const countsBySource = new Map<number, Counts>();
  for (const r of stats as unknown as Array<Record<string, string | number>>) {
    countsBySource.set(Number(r.source_id), {
      n7: Number(r.n7),
      n48: Number(r.n48),
      failed: Number(r.failed),
      junk: Number(r.junk),
      bodies: Number(r.bodies),
      singleLine: Number(r.single_line),
      browser: Number(r.browser),
    });
  }
  const lastBySource = new Map<number, string>();
  for (const r of lasts as unknown as Array<{ source_id: number; last_at: string | Date }>) {
    // db.execute 的 timestamp 是 Postgres 原文，按 UTC 解释
    const t = r.last_at instanceof Date ? r.last_at : new Date(`${r.last_at}+0000`);
    lastBySource.set(Number(r.source_id), t.toISOString());
  }

  const empty: Counts = { n7: 0, n48: 0, failed: 0, junk: 0, bodies: 0, singleLine: 0, browser: 0 };
  const rows = sources.map((s): SourceStatus => {
    const c = countsBySource.get(s.id) ?? empty;
    const kind = kindOf(s, c, now);
    return {
      id: s.id,
      name: s.name,
      url: s.url,
      category: s.category,
      frequency: FREQUENCY_LABEL[s.scrape_frequency] ?? 'Daily',
      kind,
      level: LEVEL_OF_KIND[kind],
      lastChecked: s.lastChecked?.toISOString() ?? null,
      lastArticleAt: lastBySource.get(s.id) ?? null,
      pausedAt: s.paused_at?.toISOString() ?? null,
      articles7d: c.n7,
      articles48h: c.n48,
      fetchFailedPct: pct(c.failed, c.n7),
      junkPct: pct(c.junk, c.n7),
      singleLinePct: pct(c.singleLine, c.bodies),
      viaBrowserPct: pct(c.browser, c.n7),
    };
  });

  return rows.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

export function countByKind(sources: Array<{ kind: OpsSourceKind }>): Record<OpsSourceKind, number> {
  const counts: Record<OpsSourceKind, number> = { ok: 0, not_checked: 0, dead_feed: 0, fetch_failing: 0, bad_body: 0, paused: 0 };
  for (const s of sources) counts[s.kind]++;
  return counts;
}
