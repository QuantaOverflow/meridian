import { sql } from '@meridian/database';

/**
 * 跨期线索归并（读者端「事件追踪」）。
 *
 * 把每天的 brief_stories 归到跨天存续的线索上。判据是 e5-small 文章 embedding 均值的
 * 余弦相似度——不调 LLM：向量库里本来就有，判据确定、可复现、零成本，也就不需要再养一把
 * 判官尺。
 *
 * 比对的是**线索质心**而不是最相似的单个成员。单链归并（比最近邻）会串线：首次回填实测
 * 一条线索从「以色列在黎巴嫩的军事行动」经由中东主题的中间故事一路并到「G7 埃维昂峰会」
 * 与「安卡拉北约峰会对乌援助」，滚成 77 个成员跨 52 天。质心链接要求新故事像这条线索的
 * **整体**，链式漂移就被挡住了。
 *
 * 标定（2026-08-26，865 条已进简报的历史 story，逐条看最近邻）：
 *   ≥0.97   几乎全对（同一事件的次日续报）
 *   .95-.97 大体对（US-Iran 升级、哥伦比亚大选等同一主线的不同侧面）
 *   .93-.95 已明显串线——「UK 气候政策」被并到「Starmer 辞职」；且低阈值下出现枢纽效应，
 *           某条大新闻成为一堆无关故事的共同最近邻
 * 故 τ 取 0.95。这是个口味阈值，放配置里而不是写死。
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.95;

/**
 * 回看窗口。比「暂无更新」的 7 天判据长一倍，好让停更几天又有新进展的线索**接回原线索**
 * 而不是另起一条。
 */
export const CLUSTER_LOOKBACK_DAYS = 14;

export interface ClusterAssignmentStats {
  /** 进了简报、参与归并的 story 数 */
  briefed: number;
  joined: number;
  created: number;
  /** 未入选但成功并入已有线索的（详情页的存疑条目） */
  attachedCandidates: number;
}

/**
 * 只要能 execute 就行，不绑死 drizzle 的具体类型（工作流走 Hyperdrive、回填脚本走本地连接）。
 * query 放 any 而不是 unknown：drizzle 的 execute 收 `string | SQLWrapper`，
 * 参数逆变会让 unknown 版本对不上它的签名。
 */
interface Db {
  execute: (query: any) => Promise<unknown>;
}

/**
 * 补算 brief_stories.centroid（成员文章 embedding 的均值）。
 *
 * 落库而不是每次现算：匹配要拿历史故事的向量比对，现算得把全部 story-article 链路重 join 一遍。
 * 只补 centroid IS NULL 的行，可反复跑。
 */
export async function backfillStoryCentroids(db: Db, workflowId?: string): Promise<number> {
  const rows = (await db.execute(sql`
    WITH centroids AS (
      SELECT bs.id, avg(a.embedding)::vector(384) AS centroid
      FROM brief_stories bs
      CROSS JOIN LATERAL jsonb_array_elements_text(bs.article_ids) aid
      JOIN articles a ON a.id = aid::int
      WHERE bs.centroid IS NULL
        AND jsonb_typeof(bs.article_ids) = 'array'
        AND a.embedding IS NOT NULL
        ${workflowId === undefined ? sql`` : sql`AND bs.workflow_id = ${workflowId}`}
      GROUP BY bs.id
    )
    UPDATE brief_stories bs
    SET centroid = c.centroid
    FROM centroids c
    WHERE bs.id = c.id
    RETURNING bs.id
  `)) as unknown as { id: number }[];

  return rows.length;
}

/**
 * 给每条 story 选一篇「代表文章」= 离该故事 centroid 最近的成员文章。
 *
 * 读者端的线索概要与时间线描述都取这篇文章的 event_summary_points。
 * ⚠️ 不能图省事拿 article_ids[0]：上游聚类会把无关文章混进故事，而数组顺序是任意的。
 * 实证（story 1076「Europe — Wildfires rage across multiple countries」）：数组第一篇是
 * 「智力障碍人群预期寿命少 24 年」，按质心距离排它是倒数第二；第一名才是
 * 「比利时消防员扑救大火」。取错一篇，整条线索的概要就完全跑题。
 *
 * 落库而不是读时现算：读时跑 lateral 实测 1.7 秒，这里一次算好，读时只剩一个 join。
 */
export async function backfillStoryLeadArticles(db: Db, workflowId?: string): Promise<number> {
  const rows = (await db.execute(sql`
    WITH picks AS (
      SELECT bs.id AS story_id, lead_article.id AS article_id
      FROM brief_stories bs
      CROSS JOIN LATERAL (
        SELECT a.id
        FROM jsonb_array_elements_text(bs.article_ids) aid
        JOIN articles a ON a.id = aid::int
        WHERE a.embedding IS NOT NULL
        ORDER BY a.embedding <=> bs.centroid
        LIMIT 1
      ) lead_article
      WHERE bs.lead_article_id IS NULL
        AND bs.centroid IS NOT NULL
        AND jsonb_typeof(bs.article_ids) = 'array'
        ${workflowId === undefined ? sql`` : sql`AND bs.workflow_id = ${workflowId}`}
    )
    UPDATE brief_stories bs
    SET lead_article_id = picks.article_id
    FROM picks
    WHERE bs.id = picks.story_id
    RETURNING bs.id
  `)) as unknown as { id: number }[];

  return rows.length;
}

/**
 * 一条 story 的归并，压成**单条 SQL**。
 *
 * 拆成「查最近邻 → 判阈值 → 建线索 → 回写」四次往返的写法实测跑不动：Neon 在新加坡，
 * 2000 条 story × 3 次往返要跑三个多小时。这里用可写 CTE 一次搞定，往返数降到 1/条。
 *
 * 日期窗口直接用 brief_stories.created_at，不 join brief_runs/reports —— 实测两者
 * 恒为同一天（2000 行最大差 26 分钟、跨日 0 行），省掉热路径上的两个 join。
 */
async function assignOneBriefedStory(
  db: Db,
  story: { id: number; title: string; createdAt: string },
  threshold: number,
  lookbackDays: number
): Promise<'joined' | 'created' | 'skipped'> {
  const [result] = (await db.execute(sql`
    WITH cur AS (
      SELECT id, centroid, created_at FROM brief_stories WHERE id = ${story.id} AND centroid IS NOT NULL
    ),
    best AS (
      SELECT sc.id AS cluster_id,
             1 - (sc.centroid <=> cur.centroid) AS similarity
      FROM cur
      JOIN story_clusters sc
        ON sc.centroid IS NOT NULL
       -- 回看窗口按线索的最近活动算：停更超过窗口的线索不再吸收新故事
       AND sc.last_seen_at <= cur.created_at
       AND sc.last_seen_at >= cur.created_at - ${`${lookbackDays} days`}::interval
      ORDER BY sc.centroid <=> cur.centroid
      LIMIT 1
    ),
    matched AS (SELECT cluster_id FROM best WHERE similarity >= ${threshold}),
    created AS (
      INSERT INTO story_clusters (title, centroid, first_seen_at, last_seen_at)
      SELECT ${story.title}, cur.centroid, cur.created_at, cur.created_at
      FROM cur
      WHERE NOT EXISTS (SELECT 1 FROM matched)
      RETURNING id
    ),
    target AS (
      SELECT cluster_id AS id, 'joined' AS outcome FROM matched
      UNION ALL
      SELECT id, 'created' AS outcome FROM created
    ),
    assigned AS (
      UPDATE brief_stories bs
      SET story_cluster_id = target.id
      FROM target
      WHERE bs.id = ${story.id}
      RETURNING target.id AS cluster_id, target.outcome
    ),
    bumped AS (
      UPDATE story_clusters sc
      SET last_seen_at = GREATEST(sc.last_seen_at, cur.created_at),
          -- 线索标题跟着最新一次并入走：事态演变，说法也该跟着变
          title = CASE WHEN cur.created_at >= sc.last_seen_at THEN ${story.title} ELSE sc.title END,
          -- 质心重算而不是增量加权：成员少，直接 avg 更不容易算错
          centroid = (
            SELECT avg(m.centroid)::vector(384)
            FROM brief_stories m
            WHERE m.story_cluster_id = sc.id AND m.selected_for_intel = true AND m.centroid IS NOT NULL
          )
      FROM assigned, cur
      WHERE sc.id = assigned.cluster_id AND assigned.outcome = 'joined'
      RETURNING sc.id
    )
    SELECT coalesce((SELECT outcome FROM assigned), 'skipped') AS outcome
  `)) as unknown as { outcome: 'joined' | 'created' | 'skipped' }[];

  return result?.outcome ?? 'skipped';
}

/**
 * 把某个 workflow 的 story 归并到线索上。
 *
 * 只有进了简报的 story（selected_for_intel）才允许**新建**线索，否则每天上百条未入选的
 * 候选会各自开一条线索，索引页立刻被垃圾淹没。未入选的 story 只允许**并入**已有线索——
 * 它们正是设计稿里那类「未进入简报」的存疑条目。
 *
 * 已入选的部分必须逐条顺序处理：先处理的 story 立刻成为后续 story 的候选，同一天里被模型
 * 拆成两条的近重复故事因此会落到同一条线索上。未入选的部分没有这个依赖（它们既不建线索
 * 也不改线索状态），所以合并成一次批量写。
 */
export async function assignStoryClustersForWorkflow(
  db: Db,
  workflowId: string,
  opts: { threshold?: number; lookbackDays?: number } = {}
): Promise<ClusterAssignmentStats> {
  const threshold = opts.threshold ?? CLUSTER_SIMILARITY_THRESHOLD;
  const lookbackDays = opts.lookbackDays ?? CLUSTER_LOOKBACK_DAYS;

  await backfillStoryCentroids(db, workflowId);
  // centroid 算完才能挑代表文章
  await backfillStoryLeadArticles(db, workflowId);

  const briefedStories = (await db.execute(sql`
    SELECT id, title, created_at AS "createdAt"
    FROM brief_stories
    WHERE workflow_id = ${workflowId}
      AND story_cluster_id IS NULL
      AND selected_for_intel = true
      AND centroid IS NOT NULL
    ORDER BY importance DESC NULLS LAST, id
  `)) as unknown as { id: number; title: string; createdAt: string }[];

  const stats: ClusterAssignmentStats = { briefed: 0, joined: 0, created: 0, attachedCandidates: 0 };

  for (const story of briefedStories) {
    const outcome = await assignOneBriefedStory(db, story, threshold, lookbackDays);
    stats.briefed += 1;
    if (outcome === 'joined') stats.joined += 1;
    else if (outcome === 'created') stats.created += 1;
  }

  const attached = (await db.execute(sql`
    WITH candidates AS (
      SELECT id, centroid, created_at
      FROM brief_stories
      WHERE workflow_id = ${workflowId}
        AND story_cluster_id IS NULL
        AND selected_for_intel = false
        AND centroid IS NOT NULL
    ),
    best AS (
      SELECT DISTINCT ON (c.id)
             c.id,
             sc.id AS cluster_id,
             1 - (sc.centroid <=> c.centroid) AS similarity
      FROM candidates c
      JOIN story_clusters sc
        ON sc.centroid IS NOT NULL
       AND sc.last_seen_at <= c.created_at
       AND sc.last_seen_at >= c.created_at - ${`${lookbackDays} days`}::interval
      ORDER BY c.id, sc.centroid <=> c.centroid
    )
    UPDATE brief_stories bs
    SET story_cluster_id = best.cluster_id
    FROM best
    WHERE bs.id = best.id AND best.similarity >= ${threshold}
    RETURNING bs.id
  `)) as unknown as { id: number }[];

  stats.attachedCandidates = attached.length;
  return stats;
}
