import { blockCountries, type BlockCountries, type BlockEntity, type BriefMapEvent } from '@meridian/contracts';
import { $articles, $brief_stories, inArray } from '@meridian/database';
import type { Db } from './db';
import { countryOfEntity, normalizePlace } from './places';
import { blockEntities } from './story-entities';

/**
 * 一个故事的成员文章在各国的占比，与由它定出的「块对国家的归属」。只有这一份：
 * 地图接口（brief-map.ts）给前端的 places / mentions、写简报块时存在块上的落点国家与涉及国家（loadBlockAttribution）都从这里算。
 * 落点规则本身在 @meridian/contracts 的 placement.ts。
 */

/** article_ids 是 jsonb，历史行里可能是 null、非数组或有重复：只取去重后的整数 id */
export function memberIds(articleIds: unknown): number[] {
  if (!Array.isArray(articleIds)) return [];
  return [...new Set(articleIds.filter((id): id is number => Number.isInteger(id)))];
}

/** key_entities 是 jsonb，只取字符串项 */
export function entityNames(entities: unknown): string[] {
  return Array.isArray(entities) ? entities.filter((e): e is string => typeof e === 'string') : [];
}

/**
 * 成员按国家的占比；降序，同占比按代码。与原型 build.py / places.py 的 place() 同口径：
 * 分母是地点非空的成员数（只写了地区、表里没有的值在分母里、不进分子），空值成员不进分母；没有非空地点时为 []。
 * 归一表里没有的地点值（含空值）经 onUnmapped 报给调用方。
 */
export function placesOf(
  members: number[],
  locationOf: Map<number, string | null>,
  onUnmapped?: (articleId: number, raw: string | null) => void
): BriefMapEvent['places'] {
  const counts = new Map<string, number>();
  let located = 0;
  for (const id of members) {
    const raw = locationOf.get(id) ?? null;
    if (raw !== null && raw.trim() !== '') located++;
    const place = normalizePlace(raw);
    if (place.kind === 'country') counts.set(place.country, (counts.get(place.country) ?? 0) + 1);
    else if (place.kind === 'unmapped') onUnmapped?.(id, raw);
  }
  return [...counts]
    .map(([country, n]) => ({ country, share: Math.round((n / located) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share || a.country.localeCompare(b.country));
}

/**
 * 成员文章提到各国的比例：每篇的地点与关键实体里能归一成国家的各算一次，分母是全部成员；降序（同占比按代码），至多 5 个。
 * 一事的报道几乎都填同一个地点（115 期 21 个故事里 20 个地点 100% 同一国），第二个国家只出现在关键实体里。
 */
export function mentionsOf(
  members: number[],
  locationOf: Map<number, string | null>,
  entitiesOf: Map<number, string[]>
): BriefMapEvent['mentions'] {
  const counts = new Map<string, number>();
  for (const id of members) {
    const located = normalizePlace(locationOf.get(id) ?? null);
    const countries = new Set(located.kind === 'country' ? [located.country] : []);
    for (const entity of entitiesOf.get(id) ?? []) {
      const country = countryOfEntity(entity);
      if (country !== null) countries.add(country);
    }
    for (const country of countries) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts]
    .map(([country, n]) => ({ country, share: Math.round((n / members.length) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share || a.country.localeCompare(b.country))
    .slice(0, 5);
}

/** 一个简报块按成员文章算出来、存在块上的归属：对国家的（国家页按它查）与实体（实体页按它查，算法在 story-entities.ts） */
export interface BlockAttribution {
  countries: BlockCountries;
  entities: BlockEntity[];
}

/**
 * 一批故事（brief_stories.id）各自的块的归属，按成员文章现算。写简报块时调用（lib/save-brief-report.ts），
 * 结果存在块上；没有成员、成员都没有地点与实体的故事是 { countries: { placement: null, mentions: [] }, entities: [] }。
 */
export async function loadBlockAttribution(db: Pick<Db, 'select'>, storyIds: number[]): Promise<Map<number, BlockAttribution>> {
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
