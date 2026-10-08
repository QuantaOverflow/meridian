import type { CountryBlock, CountryBlocksPage, CountrySection } from '@meridian/contracts';
import { $brief_blocks, $reports, and, desc, eq, sql } from '@meridian/database';
import { isPublished } from './briefs';
import type { Db } from './db';
import { PLACE_CODES } from '../core/places';

/**
 * 国家页的一节（响应形状见 @meridian/contracts 的 CountryBlocksPage）：落点在该国的块，或涉及该国的块。
 * 块对国家的归属是写块时算好存在块上的（lib/core/brief-blocks.ts），这里只按那两列过滤，不 join 成员文章。
 * 只含已发布各期的块：可见性跟所属那一期走，靠 join reports 判。
 */

/** 国家页认的代码 = 地点归一表能产出的代码（大写）；不是的返回 null */
export function countryCode(raw: string): string | null {
  const code = raw.toUpperCase();
  return PLACE_CODES.has(code) ? code : null;
}

export async function listCountryBlocks(
  db: Db,
  params: { country: string; section: CountrySection; limit: number; offset: number }
): Promise<CountryBlocksPage> {
  const inSection =
    params.section === 'placement'
      ? eq($brief_blocks.placement_country, params.country)
      : // @> 才走得上 mention_countries 的 GIN 索引（= ANY(...) 走不上）
        sql`${$brief_blocks.mention_countries} @> ARRAY[${params.country}]::text[]`;
  const where = and(isPublished, inSection);

  // 两条查询互不依赖，并行发省一趟往返
  const [rows, [{ total }]] = await Promise.all([
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
      })
      .from($brief_blocks)
      .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
      .where(where)
      .orderBy(desc($reports.createdAt), desc($reports.id), $brief_blocks.position)
      .limit(params.limit)
      .offset(params.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from($brief_blocks)
      .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
      .where(where),
  ]);

  return {
    country: params.country,
    section: params.section,
    total,
    items: rows.map(
      (r): CountryBlock => ({
        id: r.id,
        brief: { id: r.reportId, createdAt: r.reportCreatedAt.toISOString() },
        storyId: r.storyId,
        tier: r.tier,
        position: r.position,
        title: r.title,
        body: r.body,
        countries: { placement: r.placement, mentions: r.mentions },
      })
    ),
  };
}
