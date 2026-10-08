import type { BriefBlock, BriefTier, SearchGroup, SearchPage } from '@meridian/contracts';
import { $brief_blocks, $brief_stories, $reports, sql } from '@meridian/database';
import { isPublished } from './briefs';
import { pgTimestamp, type Db } from './db';
import { threadStatsByIds } from './story-threads';

/**
 * 搜索简报块（响应形状见 @meridian/contracts 的 SearchPage）：Postgres 英文全文检索，搜块的标题与正文
 * （brief_blocks.search，标题权重 A、正文 B，GIN 索引）。只含已发布各期的块：可见性跟所属那一期走，靠 join reports 判。
 *
 * 查询串交给 websearch_to_tsquery：多个词是「都要有」、引号是短语、`-词` 是排除、`or` 是或；它不会因为语法符号报错，
 * 只有停用词的查询得到空的 tsquery，什么都不命中。词形还原由 english 配置做（holding → hold）。
 *
 * 按线索折叠：同一线索（brief_stories.story_cluster_id）的块归成一组，分页按组数——在前端按页折的话，
 * 同一线索会被页边界切开。组的先后按组内最高的相关度，相同则最新的在前。
 */

/** 一组里最多带回几块（最新的在前）；总数另给，见 SearchGroup.blockCount。一条线索可以跨几十期，不设上限的话一页的响应没有上界 */
const BLOCKS_PER_GROUP = 10;

interface Row {
  total: number;
  total_blocks: number;
  group_key: string | null;
  cluster_id: number | null;
  block_count: number | null;
  id: number;
  report_id: number;
  report_created_at: string | Date;
  story_id: number;
  tier: BriefTier;
  position: number;
  title: string;
  body: string;
}

export async function searchBlocks(db: Db, params: { q: string; limit: number; offset: number }): Promise<SearchPage> {
  // CTE 与 LATERAL 查询构造器写不了，保留原生 SQL；表名与列名走 drizzle 的表 / 列对象，只有 CTE 自己产出的列是字面量
  const rows = (await db.execute(sql`
    WITH hits AS (
      SELECT ${$brief_blocks.id} AS id,
             ${$reports.id} AS report_id,
             ${$reports.createdAt} AS report_created_at,
             ${$brief_blocks.story_id} AS story_id,
             ${$brief_blocks.tier} AS tier,
             ${$brief_blocks.position} AS position,
             ${$brief_blocks.title} AS title,
             ${$brief_blocks.body} AS body,
             ${$brief_stories.story_cluster_id} AS cluster_id,
             -- 没并进任何线索的故事，它的块自成一组
             coalesce('t' || ${$brief_stories.story_cluster_id}, 'b' || ${$brief_blocks.id}) AS group_key,
             ts_rank_cd(${$brief_blocks.search}, query) AS rank
      FROM ${$brief_blocks}
      JOIN ${$reports} ON ${$reports.id} = ${$brief_blocks.report_id}
      JOIN ${$brief_stories} ON ${$brief_stories.id} = ${$brief_blocks.story_id}
      CROSS JOIN websearch_to_tsquery('english', ${params.q}) AS query
      WHERE ${isPublished}
        AND ${$brief_blocks.search} @@ query
    ),
    groups AS (
      SELECT group_key,
             min(cluster_id) AS cluster_id,
             count(*)::int AS block_count,
             max(rank) AS best_rank,
             max(report_created_at) AS newest
      FROM hits
      GROUP BY group_key
    ),
    totals AS (
      SELECT count(*)::int AS total, coalesce(sum(block_count), 0)::int AS total_blocks FROM groups
    ),
    page AS (
      SELECT * FROM groups
      ORDER BY best_rank DESC, newest DESC, group_key
      LIMIT ${params.limit} OFFSET ${params.offset}
    )
    -- 从 totals 起 LEFT JOIN：这一页是空的（没命中或翻过头）也要带回总数
    SELECT totals.total, totals.total_blocks,
           page.group_key, page.cluster_id, page.block_count,
           h.id, h.report_id, h.report_created_at, h.story_id, h.tier, h.position, h.title, h.body
    FROM totals
    LEFT JOIN page ON true
    LEFT JOIN LATERAL (
      SELECT * FROM hits
      WHERE hits.group_key = page.group_key
      ORDER BY hits.report_created_at DESC, hits.report_id DESC, hits.position
      LIMIT ${BLOCKS_PER_GROUP}
    ) h ON true
    ORDER BY page.best_rank DESC, page.newest DESC, page.group_key,
             h.report_created_at DESC, h.report_id DESC, h.position
  `)) as unknown as Row[];

  const grouped = new Map<string, { clusterId: number | null; blockCount: number; blocks: BriefBlock[] }>();
  for (const r of rows) {
    if (r.group_key === null) continue;
    let group = grouped.get(r.group_key);
    if (group === undefined) {
      group = { clusterId: r.cluster_id, blockCount: Number(r.block_count), blocks: [] };
      grouped.set(r.group_key, group);
    }
    group.blocks.push({
      id: r.id,
      brief: { id: r.report_id, createdAt: pgTimestamp(r.report_created_at).toISOString() },
      storyId: r.story_id,
      tier: r.tier,
      position: r.position,
      title: r.title,
      body: r.body,
    });
  }

  // 线索的标题与期数同线索页一个口径（threadStatsQuery）；没过线索门槛的簇不在结果里，那一组不带线索
  const clusterIds = [...grouped.values()].map(g => g.clusterId).filter((id): id is number => id !== null);
  const threads = await threadStatsByIds(db, clusterIds);

  return {
    query: params.q,
    total: Number(rows[0]?.total ?? 0),
    totalBlocks: Number(rows[0]?.total_blocks ?? 0),
    items: [...grouped.values()].map((g): SearchGroup => {
      const thread = g.clusterId === null ? undefined : threads.get(g.clusterId);
      return {
        thread: thread === undefined ? null : { id: g.clusterId!, title: thread.title, briefCount: thread.briefCount },
        blockCount: g.blockCount,
        blocks: g.blocks,
      };
    }),
  };
}
