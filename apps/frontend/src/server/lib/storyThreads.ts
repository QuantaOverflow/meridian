import { sql } from '@meridian/database';
import type { H3Event } from 'h3';
import type { StoryThreadDetail, StoryThreadEntry, StoryThreadSummary } from '~/shared/types';
import { ensureDate, formatReportDateCN, formatReportDateShortCN, getDB } from './utils';

/**
 * 事件追踪的判定阈值。
 *
 * 放在这里而不是写死在 SQL 里，是因为这几个数字要对读者可见（索引页筛选栏下方那行
 * 规则说明直接引用 ACTIVE_WINDOW_DAYS），改一处必须两边一起变。
 */
export const STORY_THREAD_CONFIG = {
  /** 最近这些天内有新条目并入 = 进行中；否则「暂无更新」 */
  ACTIVE_WINDOW_DAYS: 7,
  /** 连续这么多天每天都有新条目，判为升级中 */
  ESCALATING_STREAK_DAYS: 3,
  /** 概要取代表文章的前几条事件要点 */
  SUMMARY_POINTS: 3,
  /**
   * 至少出现在这么多期简报里，才算一条「线索」。
   *
   * 归并对每条匹配不上的故事都会新建线索，而每天入选的 25 条故事里大部分是当天独有的
   * 新闻——28 天下来 459 条线索中有 322 条（70%）只出现在一期。那不是跨期线索，就是
   * 一条当天新闻，读者在今日简报里已经看过了，列在这里只是噪声。
   * 设计交付文档对本页的定义是「列出**跨期存续**的线索」，据此取 2。
   */
  MIN_BRIEFS: 2,
} as const;

/**
 * ⚠️ 状态叫「暂无更新」而不是「已平息」。
 *
 * 系统只知道「最近没有新报道并入这条线索」，不知道现实中的冲突是否平息。用后者是在对
 * 世界下判断，会误导读者。设计交付文档专门点名要求改这个词，别改回去。
 */
export type StoryThreadStatus = 'active' | 'dormant';

interface ThreadRow {
  id: number;
  title: string;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  entry_count: number;
  brief_count: number;
  duration_days: number;
  days_since_update: number;
  streak_days: number;
  latest_importance: number | null;
  mean_importance: number | null;
  summary_points: string[] | null;
}

/** 事件要点是一串短事实句，拼成一行当概要；不是散文，但每个字都来自原文 */
function pointsToSummary(points: string[] | null): string {
  if (points === null || points.length === 0) return '';
  return points
    .slice(0, STORY_THREAD_CONFIG.SUMMARY_POINTS)
    .map(p => p.trim().replace(/[。.]$/, ''))
    .join(' · ');
}

function toStatus(daysSinceUpdate: number): StoryThreadStatus {
  return daysSinceUpdate <= STORY_THREAD_CONFIG.ACTIVE_WINDOW_DAYS ? 'active' : 'dormant';
}

/**
 * 升级中的判定：连续 N 天每天都有新条目，**或**最新条目重要度高于该线索历史均值。
 * 两条都不满足就什么都不显示——不要「平稳」这类填充词。
 */
function isEscalating(row: ThreadRow): boolean {
  if (toStatus(Number(row.days_since_update)) === 'dormant') return false;
  if (Number(row.streak_days) >= STORY_THREAD_CONFIG.ESCALATING_STREAK_DAYS) return true;
  if (row.latest_importance === null || row.mean_importance === null) return false;
  return Number(row.latest_importance) > Number(row.mean_importance);
}

function updateLabel(daysSinceUpdate: number): string {
  const days = Number(daysSinceUpdate);
  if (days <= 0) return '今日更新';
  if (days === 1) return '昨日更新';
  return `${days} 天前更新`;
}

/**
 * 线索的公共部分：成员、跨度、连续天数、重要度。
 *
 * 只统计 selected_for_intel 的成员——未入选的候选没进简报，不构成「进展」，
 * 它们只在详情页作为存疑条目出现。
 */
const threadStatsQuery = sql`
  WITH members AS (
    SELECT bs.story_cluster_id AS cluster_id,
           bs.id AS story_id,
           bs.title,
           bs.importance,
           bs.selected_for_intel,
           bs.lead_article_id,
           r.id AS report_id,
           r.created_at
    FROM brief_stories bs
    JOIN brief_runs br ON br.workflow_id = bs.workflow_id
    JOIN reports r ON r.id = br.report_id
    WHERE bs.story_cluster_id IS NOT NULL
  ),
  briefed AS (SELECT * FROM members WHERE selected_for_intel),
  latest AS (
    SELECT DISTINCT ON (cluster_id) cluster_id, story_id, title, importance, lead_article_id
    FROM briefed ORDER BY cluster_id, created_at DESC, importance DESC NULLS LAST
  ),
  agg AS (
    SELECT cluster_id,
           count(*)::int AS entry_count,
           count(DISTINCT report_id)::int AS brief_count,
           avg(importance) AS mean_importance,
           max(created_at) AS last_entry_at
    FROM briefed
    GROUP BY cluster_id
    -- 门槛放在 agg 里而不是外层 WHERE：外层要留给详情页追加它自己的 WHERE 条件，
    -- 在这里过滤，两条读路径自动共用同一套口径。
    HAVING count(DISTINCT report_id) >= ${STORY_THREAD_CONFIG.MIN_BRIEFS}
  ),
  -- 连续天数：从最后一条往回数 N 天窗口里出现过几个不同日期，等于 N 就说明这 N 天
  -- 每天都有新条目。单独拆一个 CTE，是因为 FILTER 子句里不允许出现窗口函数。
  streaks AS (
    SELECT b.cluster_id, count(DISTINCT b.created_at::date)::int AS streak_days
    FROM briefed b
    JOIN agg ON agg.cluster_id = b.cluster_id
    WHERE b.created_at::date > agg.last_entry_at::date - ${STORY_THREAD_CONFIG.ESCALATING_STREAK_DAYS}::int
    GROUP BY b.cluster_id
  )
  SELECT sc.id,
         -- 标题取**最新那条成员故事**的标题，而不是 story_clusters.title。
         -- 后者是归并时逐条写进去的，同一天有多条成员时最后处理的那条会覆盖前面的，
         -- 于是标题来自「最后处理的（重要度最低的）」、概要却来自 latest（重要度最高的），
         -- 两者对不上。实测线索 808：48 条成员几乎全是美伊经济施压，标题却是
         -- 「Pakistan's mediation efforts」，概要是 Bessent 的制裁——读者会以为串了话题。
         -- 从同一行取，这类漂移就不存在了。
         coalesce(latest.title, sc.title) AS title,
         sc.first_seen_at,
         sc.last_seen_at,
         agg.entry_count,
         agg.brief_count,
         agg.mean_importance,
         coalesce(streaks.streak_days, 1) AS streak_days,
         (sc.last_seen_at::date - sc.first_seen_at::date + 1)::int AS duration_days,
         (CURRENT_DATE - sc.last_seen_at::date)::int AS days_since_update,
         latest.importance AS latest_importance,
         lead_article.event_summary_points AS summary_points
  FROM story_clusters sc
  JOIN agg ON agg.cluster_id = sc.id
  LEFT JOIN streaks ON streaks.cluster_id = sc.id
  LEFT JOIN latest ON latest.cluster_id = sc.id
  -- 概要取该故事的**代表文章**（离故事质心最近的成员，归并时算好落在
  -- brief_stories.lead_article_id）。不能拿 article_ids[0]：聚类会把无关文章混进故事，
  -- 数组顺序又是任意的——实测有线索因此把「智力障碍人群预期寿命」当成了野火报道的概要。
  LEFT JOIN articles lead_article ON lead_article.id = latest.lead_article_id
`;

function toSummary(row: ThreadRow): StoryThreadSummary {
  const daysSinceUpdate = Number(row.days_since_update);
  return {
    id: row.id,
    title: row.title,
    status: toStatus(daysSinceUpdate),
    escalating: isEscalating(row),
    summary: pointsToSummary(row.summary_points),
    durationDays: Number(row.duration_days),
    briefCount: Number(row.brief_count),
    entryCount: Number(row.entry_count),
    updateLabel: updateLabel(daysSinceUpdate),
  };
}

export async function listStoryThreads(event: H3Event) {
  const rows = (await getDB(event).execute(sql`
    ${threadStatsQuery}
    -- 进行中优先，其次按最近更新
    ORDER BY sc.last_seen_at DESC, agg.entry_count DESC
  `)) as unknown as ThreadRow[];

  const threads = rows.map(toSummary);
  return {
    threads,
    counts: {
      active: threads.filter(t => t.status === 'active').length,
      dormant: threads.filter(t => t.status === 'dormant').length,
      all: threads.length,
    },
    activeWindowDays: STORY_THREAD_CONFIG.ACTIVE_WINDOW_DAYS,
    minBriefs: STORY_THREAD_CONFIG.MIN_BRIEFS,
  };
}

interface EntryRow {
  story_id: number;
  title: string;
  selected_for_intel: boolean;
  created_at: string | Date;
  report_id: number;
  summary_points: string[] | null;
}

export async function getStoryThread(event: H3Event, id: number): Promise<StoryThreadDetail | null> {
  const db = getDB(event);

  // 两条查询互不依赖，并行发省一趟往返
  const [[row], entryRows] = (await Promise.all([
    db.execute(sql`
      ${threadStatsQuery}
      WHERE sc.id = ${id}
    `),
    db.execute(sql`
    SELECT bs.id AS story_id,
           bs.title,
           bs.selected_for_intel,
           r.created_at,
           r.id AS report_id,
           lead_article.event_summary_points AS summary_points
    FROM brief_stories bs
    JOIN brief_runs br ON br.workflow_id = bs.workflow_id
    JOIN reports r ON r.id = br.report_id
    -- 同上：取该故事的代表文章
    LEFT JOIN articles lead_article ON lead_article.id = bs.lead_article_id
    WHERE bs.story_cluster_id = ${id}
    ORDER BY r.created_at DESC, bs.selected_for_intel DESC, bs.importance DESC NULLS LAST
  `),
  ])) as unknown as [ThreadRow[], EntryRow[]];

  if (row === undefined) return null;

  const entries: StoryThreadEntry[] = entryRows.map(entry => {
    const createdAt = ensureDate(entry.created_at);
    return {
      id: entry.story_id,
      dateShortCN: formatReportDateShortCN(createdAt),
      title: entry.title,
      description: pointsToSummary(entry.summary_points),
      briefSlug: String(entry.report_id),
      briefNumber: entry.report_id,
      // 未入选情报分析 = 当天识别出来了但没进简报，正是设计稿里的「存疑条目」
      disputed: !entry.selected_for_intel,
    };
  });

  const summary = toSummary(row);
  return {
    ...summary,
    firstSeenCN: formatReportDateCN(ensureDate(row.first_seen_at)),
    lastSeenCN: formatReportDateCN(ensureDate(row.last_seen_at)),
    entries,
  };
}
