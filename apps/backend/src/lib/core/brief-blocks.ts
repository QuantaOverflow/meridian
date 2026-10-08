// 简报块的写入（表 brief_blocks，为什么有这张表见 ADR 0014）。写法只有这一份：
// 保存简报（lib/save-brief-report.ts）与往期回填（scripts/backfill-brief-blocks.ts）都只走这里的两个入口。
//
// 每块的落点国家、涉及国家与实体（国家页、实体页按它查）在写入时按成员文章算好存在块上：
// 国家的算法在 block-attribution.ts，实体的在 block-entities.ts，落点规则在 @meridian/contracts 的 placement.ts。
import { blockCountries, type BlockCountries, type BlockEntity, type BriefBlockDraft } from '@meridian/contracts';
import { $articles, $brief_blocks, $brief_stories, eq, inArray } from '@meridian/database';
import type { getDb } from '../database';
import { entityNames, memberIds, mentionsOf, placesOf } from './block-attribution';
import { blockEntities } from './block-entities';

type Db = ReturnType<typeof getDb>;

/** 一个简报块按成员文章算出来、存在块上的归属：对国家的（国家页按它查）与实体（实体页按它查） */
interface BlockAttribution {
  countries: BlockCountries;
  entities: BlockEntity[];
}

/**
 * 一批故事（brief_stories.id）各自的块的归属，按成员文章现算。
 * 没有成员、成员都没有地点与实体的故事是 { countries: { placement: null, mentions: [] }, entities: [] }。
 */
async function loadBlockAttribution(db: Pick<Db, 'select'>, storyIds: number[]): Promise<Map<number, BlockAttribution>> {
  if (storyIds.length === 0) return new Map();
  const stories = await db
    .select({ id: $brief_stories.id, articleIds: $brief_stories.article_ids })
    .from($brief_stories)
    .where(inArray($brief_stories.id, storyIds));
  const allMembers = [...new Set(stories.flatMap(s => memberIds(s.articleIds)))];
  const articles =
    allMembers.length === 0
      ? []
      : await db
          .select({ id: $articles.id, location: $articles.primary_location, entities: $articles.key_entities })
          .from($articles)
          .where(inArray($articles.id, allMembers));
  const locationOf = new Map(articles.map(a => [a.id, a.location]));
  const entitiesOf = new Map(articles.map(a => [a.id, entityNames(a.entities)]));
  return new Map(
    stories.map(s => {
      const members = memberIds(s.articleIds);
      return [
        s.id,
        {
          countries: blockCountries(placesOf(members, locationOf), mentionsOf(members, locationOf, entitiesOf)),
          entities: blockEntities(members, entitiesOf),
        },
      ];
    })
  );
}

/** 存在块上的归属那几列 */
function attributionColumns(a: BlockAttribution | undefined) {
  return {
    placement_country: a?.countries.placement ?? null,
    mention_countries: a?.countries.mentions ?? [],
    entities: a?.entities.map((e) => e.key) ?? [],
    entity_names: a?.entities.map((e) => e.name) ?? [],
  };
}

/**
 * 写一期的块：写完后这一期的块恰好是传进来的这些（已有的先删），所以可重跑。
 * 调用方给事务：保存简报把它与 reports 行放在同一笔里；回填每期一笔。
 */
export async function writeBriefBlocks(
  tx: Pick<Db, 'insert' | 'select' | 'delete'>,
  reportId: number,
  blocks: BriefBlockDraft[]
): Promise<void> {
  await tx.delete($brief_blocks).where(eq($brief_blocks.report_id, reportId));
  if (blocks.length === 0) return;
  const attribution = await loadBlockAttribution(tx, blocks.map((b) => b.storyId));
  await tx.insert($brief_blocks).values(
    blocks.map((b) => ({
      report_id: reportId,
      story_id: b.storyId,
      tier: b.tier,
      position: b.position,
      title: b.title,
      body: b.body,
      ...attributionColumns(attribution.get(b.storyId)),
    }))
  );
}

/**
 * 一期已有的块只重算归属那几列（标题、正文不动），返回块数。回填脚本对补不了的期用它。
 * @internal 只为回填脚本导出
 */
export async function refreshBlockAttribution(db: Db, reportId: number): Promise<number> {
  const blocks = await db
    .select({ id: $brief_blocks.id, storyId: $brief_blocks.story_id })
    .from($brief_blocks)
    .where(eq($brief_blocks.report_id, reportId));
  const attribution = await loadBlockAttribution(db, blocks.map((b) => b.storyId));
  await db.transaction(async (tx) => {
    for (const b of blocks) {
      await tx
        .update($brief_blocks)
        .set(attributionColumns(attribution.get(b.storyId)))
        .where(eq($brief_blocks.id, b.id));
    }
  });
  return blocks.length;
}
