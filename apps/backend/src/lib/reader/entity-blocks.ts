import type { BlockEntitiesList, BlockEntity, CountryBlock, EntityBlocksPage } from '@meridian/contracts';
import { $brief_blocks, $reports, and, desc, eq, inArray, sql } from '@meridian/database';
import { isPublished } from './briefs';
import type { Db } from './db';
import { countryOfEntity } from './places';
import { entityKey } from './story-entities';

/**
 * 实体页与块下的实体链接（响应形状见 @meridian/contracts 的 EntityBlocksPage、BlockEntitiesList）。
 * 块的实体是写块时算好存在块上的（lib/save-brief-report.ts，算法在 story-entities.ts），这里只按那一列过滤，不 join 成员文章。
 * 只含已发布各期的块，门槛也只数已发布的：可见性跟所属那一期走，撤一期可能让一个实体掉到门槛以下。
 */

/**
 * 实体出现在至少这么多已发布的简报块里才有实体页。2026-10-08 在 staging 的读数与取这个数的理由见 ADR 0014「实体页」。
 */
const ENTITY_PAGE_MIN_BLOCKS = 5;

/** @> 才走得上 entities 的 GIN 索引（= ANY(...) 走不上） */
const hasEntity = (key: string) => sql`${$brief_blocks.entities} @> ARRAY[${key}]::text[]`;

/** 实体页的一页；没过门槛（含根本没有这个实体）时为 null */
export async function listEntityBlocks(
  db: Db,
  params: { name: string; limit: number; offset: number }
): Promise<EntityBlocksPage | null> {
  const key = entityKey(params.name);
  // 能归成国家的写法不是实体（写块时就没存），它的块在国家页
  const country = countryOfEntity(key);
  if (country !== null) return { kind: 'country', country };

  const where = and(isPublished, hasEntity(key));
  // 三条查询互不依赖，并行发省往返
  const [rows, [{ total }], names] = await Promise.all([
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
    // 显示写法：各块存的写法里最常见的那种（一样多取字典序小的）
    db
      .select({ name: sql<string>`${$brief_blocks.entity_names}[array_position(${$brief_blocks.entities}, ${key})]` })
      .from($brief_blocks)
      .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) desc`, sql`1`)
      .limit(1),
  ]);
  if (total < ENTITY_PAGE_MIN_BLOCKS) return null;

  return {
    kind: 'entity',
    entity: { key, name: names[0]?.name ?? key },
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

/**
 * 一批块各自的相关实体，按请求里的块号顺序；只列有实体页的实体，一个都没有的块、未发布的期的块、不存在的块不在结果里。
 * 显示写法同实体页：各块存的写法里最常见的那种，同一个实体在各块下写法一致。
 */
export async function listBlockEntities(db: Db, blockIds: number[]): Promise<BlockEntitiesList> {
  if (blockIds.length === 0) return { items: [] };
  const blocks = await db
    .select({ id: $brief_blocks.id, entities: $brief_blocks.entities })
    .from($brief_blocks)
    .innerJoin($reports, eq($reports.id, $brief_blocks.report_id))
    .where(and(isPublished, inArray($brief_blocks.id, blockIds)));
  const keys = [...new Set(blocks.flatMap(b => b.entities))];
  if (keys.length === 0) return { items: [] };

  // 这些写法里哪些过了门槛：在已发布的全部块上数（&& 走 entities 的 GIN 索引）
  const list = sql`ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}]::text[]`;
  // mode() 在一样多时取排序靠前的，与实体页的取法一致
  const paged = (await db.execute(sql`
    SELECT e.key, mode() WITHIN GROUP (ORDER BY e.name) AS name
    FROM ${$brief_blocks}
    JOIN ${$reports} ON ${$reports.id} = ${$brief_blocks.report_id}
    CROSS JOIN LATERAL unnest(${$brief_blocks.entities}, ${$brief_blocks.entity_names}) AS e(key, name)
    WHERE ${$reports.published_at} IS NOT NULL
      AND ${$brief_blocks.entities} && ${list}
      AND e.key = ANY(${list})
    GROUP BY e.key
    HAVING count(*) >= ${ENTITY_PAGE_MIN_BLOCKS}
  `)) as unknown as { key: string; name: string | null }[];
  const nameOf = new Map(paged.map(r => [r.key, r.name ?? r.key]));

  const byId = new Map(blocks.map(b => [b.id, b]));
  return {
    items: [...new Set(blockIds)].flatMap(blockId => {
      const block = byId.get(blockId);
      const entities = (block?.entities ?? []).flatMap((key): BlockEntity[] => {
        const name = nameOf.get(key);
        return name === undefined ? [] : [{ key, name }];
      });
      return entities.length === 0 ? [] : [{ blockId, entities }];
    }),
  };
}
