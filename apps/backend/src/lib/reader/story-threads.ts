import { $articles, $brief_runs, $brief_stories, $reports, $story_clusters, and, desc, eq, inArray, sql } from '@meridian/database';
import { isPublished } from './briefs';
import { pgTimestamp, type Db } from './db';

/**
 * 事件追踪的判定阈值。
 *
 * 放在这里而不是写死在 SQL 里，是因为这几个数字要对读者可见（索引页筛选栏下方那行
 * 规则说明直接引用 ACTIVE_WINDOW_DAYS，经 /reader/stories 的 activeWindowDays 带给前端），改一处必须两边一起变。
 */
const STORY_THREAD_CONFIG = {
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
  /**
   * 线索标题与概要默认取最新那条成员（说法跟着最近的进展走），只有它明显离群时才退回
   * 「最近 TITLE_RECENT_MEMBERS 条里离线索质心最近的那条」。
   *
   * 为什么要退：门槛 0.94 下偶尔串进一条相邻新闻，它一进来就顶掉标题——2026-09-29 重建后
   * 「尼泊尔冰川洪水」显示成「Nepal Avalanche Kills 2」、「邮寄投票诉讼」显示成「选民数据库」。
   * 为什么不一律挑离质心最近的：生产上试过，138 条线索里 112 条标题被换成更旧的说法
   * （图帕克案「被定罪」退回「审判前瞻」）——两三条成员的线索，质心就在它们中间，谁近几乎随机。
   * 离群判据（2026-09-29 在生产 138 条线索上看的）：成员 ≥6 条的线索里，最新成员比最近 5 条里
   * 最贴近质心的低 ≥0.04 的只有 4 条（雪崩、选民数据库、「战后控制伊朗石油」混进美委石油协议，
   * 和一条边界的「以色列吊销荷兰外交官身份」），其余都 ≤0.026；成员少的线索分不开，不判。
   */
  TITLE_RECENT_MEMBERS: 5,
  TITLE_OUTLIER_MIN_MEMBERS: 6,
  TITLE_OUTLIER_GAP: 0.03,
} as const;

/** 事件追踪的线索状态。「暂无更新」不是「已平息」——系统只知道没有新报道并入 */
type StoryThreadStatus = 'active' | 'dormant';

interface StoryThreadSummaryData {
  id: number;
  title: string;
  status: StoryThreadStatus;
  /** 连续多天有新条目，或最新条目重要度高于历史均值 */
  escalating: boolean;
  summary: string;
  durationDays: number;
  /** 出现在几期简报里 */
  briefCount: number;
  entryCount: number;
  /** 距最近一次并入过了几天（按数据库的 CURRENT_DATE 算），「N 天前更新」的文案在前端拼 */
  daysSinceUpdate: number;
}

export interface StoryThreadListData {
  threads: StoryThreadSummaryData[];
  counts: { active: number; dormant: number; all: number };
  /** 判「进行中」的天数阈值，索引页要把这个数字展示给读者 */
  activeWindowDays: number;
  /** 成为线索的最少期数，同样对读者可见 */
  minBriefs: number;
}

interface StoryThreadEntryData {
  id: number;
  /** 所在那期简报的时间 */
  createdAt: Date;
  title: string;
  description: string;
  reportId: number;
  /** 当天识别出来但没进简报的候选，按存疑条目渲染 */
  disputed: boolean;
}

export interface StoryThreadDetailData extends StoryThreadSummaryData {
  firstSeenAt: Date;
  lastSeenAt: Date;
  entries: StoryThreadEntryData[];
}

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

/**
 * ⚠️ dormant 对读者显示为「暂无更新」而不是「已平息」。
 *
 * 系统只知道「最近没有新报道并入这条线索」，不知道现实中的冲突是否平息。用后者是在对
 * 世界下判断，会误导读者。设计交付文档专门点名要求改这个词，别改回去。
 */
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

/**
 * 线索的公共部分：成员、跨度、连续天数、重要度。
 *
 * 只统计 selected_for_intel 的成员——未入选的候选没进简报，不构成「进展」，
 * 它们只在详情页作为存疑条目出现。
 *
 * CTE 查询构造器写不了，保留原生 SQL；表名与列名一律走 drizzle 的表 / 列对象（改列名时 typecheck 能拦住），
 * 只有 CTE 自己产出的列（members.cluster_id 等）是字面量。
 */
const threadStatsQuery = sql`
  WITH members AS (
    SELECT ${$brief_stories.story_cluster_id} AS cluster_id,
           ${$brief_stories.id} AS story_id,
           ${$brief_stories.title} AS title,
           ${$brief_stories.importance} AS importance,
           ${$brief_stories.selected_for_intel} AS selected_for_intel,
           ${$brief_stories.lead_article_id} AS lead_article_id,
           ${$brief_stories.centroid} AS centroid,
           ${$reports.id} AS report_id,
           ${$reports.createdAt} AS created_at
    FROM ${$brief_stories}
    JOIN ${$brief_runs} ON ${$brief_runs.workflow_id} = ${$brief_stories.workflow_id}
    JOIN ${$reports} ON ${$reports.id} = ${$brief_runs.report_id}
    WHERE ${$brief_stories.story_cluster_id} IS NOT NULL
      -- 只算读者看得到的期：手动触发的调试期与撤回的期不构成线索的条目（见 schema.ts 的 published_at）
      AND ${isPublished}
  ),
  briefed AS (SELECT * FROM members WHERE selected_for_intel),
  latest AS (
    SELECT DISTINCT ON (cluster_id) cluster_id, title, importance, lead_article_id
    FROM briefed ORDER BY cluster_id, created_at DESC, importance DESC NULLS LAST
  ),
  -- 代表成员：标题与概要都取这一行，保证两者讲的是同一件事。
  -- 先排除单词标题（Delhi / Trump / Nepal 这类上游残缺标题）；其余默认取最新那条，
  -- 仅当线索够大且最新那条明显离群时改取离质心最近的（判据见 STORY_THREAD_CONFIG.TITLE_*）。
  recent AS (
    SELECT b.*,
           row_number() OVER (PARTITION BY b.cluster_id ORDER BY b.created_at DESC, b.importance DESC NULLS LAST) AS rn,
           count(*) OVER (PARTITION BY b.cluster_id) AS member_count,
           1 - (b.centroid <=> ${$story_clusters.centroid}) AS sim,
           array_length(regexp_split_to_array(btrim(b.title), '[[:space:]]+'), 1) >= 3 AS multiword
    FROM briefed b
    JOIN ${$story_clusters} ON ${$story_clusters.id} = b.cluster_id
  ),
  shape AS (
    SELECT cluster_id,
           max(member_count) AS member_count,
           max(sim) FILTER (WHERE rn <= ${STORY_THREAD_CONFIG.TITLE_RECENT_MEMBERS}) AS best_sim,
           max(sim) FILTER (WHERE rn = 1) AS newest_sim
    FROM recent GROUP BY cluster_id
  ),
  rep AS (
    SELECT DISTINCT ON (r.cluster_id) r.cluster_id, r.title, r.lead_article_id
    FROM recent r
    JOIN shape ON shape.cluster_id = r.cluster_id
    WHERE r.rn <= ${STORY_THREAD_CONFIG.TITLE_RECENT_MEMBERS}
    ORDER BY r.cluster_id,
             r.multiword DESC,
             CASE WHEN shape.member_count >= ${STORY_THREAD_CONFIG.TITLE_OUTLIER_MIN_MEMBERS}
                   AND shape.best_sim - shape.newest_sim >= ${STORY_THREAD_CONFIG.TITLE_OUTLIER_GAP}
                  THEN -r.sim ELSE r.rn::float8 END ASC NULLS LAST,
             r.rn ASC
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
  SELECT ${$story_clusters.id} AS id,
         -- 标题取**代表成员**（rep）的标题，而不是 story_clusters.title。
         -- 后者是归并时逐条写进去的，同一天有多条成员时最后处理的那条会覆盖前面的，
         -- 于是标题来自「最后处理的（重要度最低的）」、概要却来自另一条，
         -- 两者对不上。实测线索 808：48 条成员几乎全是美伊经济施压，标题却是
         -- 「Pakistan's mediation efforts」，概要是 Bessent 的制裁——读者会以为串了话题。
         -- 标题与概要从同一行取，这类漂移就不存在了。
         coalesce(rep.title, ${$story_clusters.title}) AS title,
         ${$story_clusters.first_seen_at} AS first_seen_at,
         ${$story_clusters.last_seen_at} AS last_seen_at,
         agg.entry_count,
         agg.brief_count,
         agg.mean_importance,
         coalesce(streaks.streak_days, 1) AS streak_days,
         (${$story_clusters.last_seen_at}::date - ${$story_clusters.first_seen_at}::date + 1)::int AS duration_days,
         (CURRENT_DATE - ${$story_clusters.last_seen_at}::date)::int AS days_since_update,
         latest.importance AS latest_importance,
         ${$articles.event_summary_points} AS summary_points
  FROM ${$story_clusters}
  JOIN agg ON agg.cluster_id = ${$story_clusters.id}
  LEFT JOIN streaks ON streaks.cluster_id = ${$story_clusters.id}
  LEFT JOIN latest ON latest.cluster_id = ${$story_clusters.id}
  LEFT JOIN rep ON rep.cluster_id = ${$story_clusters.id}
  -- 概要取代表成员的**代表文章**（离故事质心最近的成员，归并时算好落在
  -- brief_stories.lead_article_id）。不能拿 article_ids[0]：聚类会把无关文章混进故事，
  -- 数组顺序又是任意的——实测有线索因此把「智力障碍人群预期寿命」当成了野火报道的概要。
  LEFT JOIN ${$articles} ON ${$articles.id} = rep.lead_article_id
`;

function toSummary(row: ThreadRow): StoryThreadSummaryData {
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
    daysSinceUpdate,
  };
}

export async function listStoryThreads(db: Db): Promise<StoryThreadListData> {
  const rows = (await db.execute(sql`
    ${threadStatsQuery}
    -- 进行中优先，其次按最近更新
    ORDER BY ${$story_clusters.last_seen_at} DESC, agg.entry_count DESC
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

/**
 * 地图首页（brief-map.ts）与搜索（search-blocks.ts）用：这几条线索里过了门槛的，标题、期数与跨度。
 * 与列表页同一条 threadStatsQuery，门槛与算法不会分叉；没过门槛的不在结果里。
 */
export async function threadStatsByIds(
  db: Db,
  ids: number[]
): Promise<Map<number, { title: string; briefCount: number; durationDays: number }>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.execute(sql`
    ${threadStatsQuery}
    WHERE ${inArray($story_clusters.id, ids)}
  `)) as unknown as ThreadRow[];
  return new Map(
    rows.map(toSummary).map(t => [t.id, { title: t.title, briefCount: t.briefCount, durationDays: t.durationDays }])
  );
}

export async function getStoryThread(db: Db, id: number): Promise<StoryThreadDetailData | null> {
  // 两条查询互不依赖，并行发省一趟往返
  const [[row], entryRows] = await Promise.all([
    db.execute(sql`
      ${threadStatsQuery}
      WHERE ${$story_clusters.id} = ${id}
    `) as unknown as Promise<ThreadRow[]>,
    db
      .select({
        storyId: $brief_stories.id,
        title: $brief_stories.title,
        selectedForIntel: $brief_stories.selected_for_intel,
        createdAt: $reports.createdAt,
        reportId: $reports.id,
        summaryPoints: $articles.event_summary_points,
      })
      .from($brief_stories)
      .innerJoin($brief_runs, eq($brief_runs.workflow_id, $brief_stories.workflow_id))
      .innerJoin($reports, eq($reports.id, $brief_runs.report_id))
      // 同上：取该故事的代表文章
      .leftJoin($articles, eq($articles.id, $brief_stories.lead_article_id))
      .where(and(eq($brief_stories.story_cluster_id, id), isPublished))
      .orderBy(
        desc($reports.createdAt),
        desc($brief_stories.selected_for_intel),
        sql`${$brief_stories.importance} DESC NULLS LAST`
      ),
  ]);

  if (row === undefined) return null;

  return {
    ...toSummary(row),
    firstSeenAt: pgTimestamp(row.first_seen_at),
    lastSeenAt: pgTimestamp(row.last_seen_at),
    entries: entryRows.map(entry => ({
      id: entry.storyId,
      createdAt: entry.createdAt,
      title: entry.title as string,
      description: pointsToSummary(entry.summaryPoints as string[] | null),
      reportId: entry.reportId,
      // 未入选情报分析 = 当天识别出来了但没进简报，正是设计稿里的「存疑条目」
      disputed: !entry.selectedForIntel,
    })),
  };
}
