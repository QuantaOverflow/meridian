import type { FollowMatch, FollowingBlock, FollowingPage } from '@meridian/contracts';
import { $brief_blocks, $brief_stories, $reports, and, desc, eq, inArray, sql } from '@meridian/database';
import { isPublished } from './briefs';
import type { Db } from './db';
import { threadStatsByIds } from './story-threads';

/**
 * Following 页（响应形状见 @meridian/contracts 的 FollowingPage）：命中任一关注项的块，最新的在前。
 * 关注一个国家 = 落点在该国的块 + 涉及该国的块；关注一条线索 = 所属故事并进这条线索的块。
 * 国家归属是写块时存在块上的两列（同国家页），线索靠 join brief_stories 判。只含已发布各期的块：可见性跟所属那一期走。
 */
export async function listFollowingBlocks(
  db: Db,
  params: { countries: string[]; threads: number[]; limit: number; offset: number }
): Promise<FollowingPage> {
  const { countries, threads } = params;
  if (countries.length === 0 && threads.length === 0) return { total: 0, items: [], threads: [] };

  const hits = [];
  if (countries.length > 0) {
    const list = sql`ARRAY[${sql.join(countries.map(c => sql`${c}`), sql`, `)}]::text[]`;
    hits.push(inArray($brief_blocks.placement_country, countries));
    // && 才走得上 mention_countries 的 GIN 索引
    hits.push(sql`${$brief_blocks.mention_countries} && ${list}`);
  }
  if (threads.length > 0) hits.push(inArray($brief_stories.story_cluster_id, threads));
  const where = and(isPublished, sql`(${sql.join(hits, sql` OR `)})`);

  // 三条查询互不依赖，并行发省往返
  const [rows, [{ total }], threadStats] = await Promise.all([
    db
      .select({
        id: $brief_blocks.id,
        reportId: $reports.id,
        reportCreatedAt: $reports.createdAt,
        storyId: $brief_blocks.story_id,
        tier: $brief_blocks.tier,
        position: $brief_blocks.position,
        title: $brief_blocks.title,
        body: $brief_blocks.body,
        placement: $brief_blocks.placement_country,
        mentions: $brief_blocks.mention_countries,
        threadId: $brief_stories.story_cluster_id,
      })
      .from($brief_blocks)
      .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
      .innerJoin($brief_stories, eq($brief_stories.id, $brief_blocks.story_id))
      .where(where)
      .orderBy(desc($reports.createdAt), desc($reports.id), $brief_blocks.position)
      .limit(params.limit)
      .offset(params.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from($brief_blocks)
      .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
      .innerJoin($brief_stories, eq($brief_stories.id, $brief_blocks.story_id))
      .where(where),
    // 线索的标题与期数同线索页一个口径；没过线索门槛的不在结果里
    threadStatsByIds(db, threads),
  ]);

  const followedThreads = new Set(threads);
  return {
    total,
    items: rows.map((r): FollowingBlock => {
      const matches: FollowMatch[] = [];
      for (const code of countries) {
        if (r.placement === code) matches.push({ kind: 'country', code, via: 'placement' });
        else if (r.mentions.includes(code)) matches.push({ kind: 'country', code, via: 'mention' });
      }
      if (r.threadId !== null && followedThreads.has(r.threadId)) matches.push({ kind: 'thread', id: r.threadId });
      return {
        id: r.id,
        brief: { id: r.reportId, createdAt: r.reportCreatedAt.toISOString() },
        storyId: r.storyId,
        tier: r.tier,
        position: r.position,
        title: r.title,
        body: r.body,
        countries: { placement: r.placement, mentions: r.mentions },
        matches,
      };
    }),
    threads: threads.flatMap(id => {
      const t = threadStats.get(id);
      return t === undefined ? [] : [{ id, title: t.title, briefCount: t.briefCount }];
    }),
  };
}
