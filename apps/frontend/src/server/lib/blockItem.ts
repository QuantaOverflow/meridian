import type { BlockEntitiesList, BriefBlock } from '@meridian/contracts';
import { entityHref } from '~/lib/entities';
import { readFromBackend } from '~/server/lib/backend';
import { renderBlockBody } from '~/server/lib/briefContent';
import { ensureDate, formatReportDate } from '~/server/lib/utils';
import type { BlockItem } from '~/shared/types';

/** 块号 → 这一块的实体链接 */
type EntityLinks = Map<number, BlockItem['entities']>;

/**
 * 一批块各自的实体链接（只有有实体页的实体），从 backend 的 /reader/block-entities 取。
 * 块号去重、排序后再转发：同一批块不论顺序都是同一条请求。没有块时不去问 backend。
 */
export async function loadEntityLinks(blocks: BriefBlock[]): Promise<EntityLinks> {
  const ids = [...new Set(blocks.map(b => b.id))].sort((a, b) => a - b);
  if (ids.length === 0) return new Map();
  const list = await readFromBackend<BlockEntitiesList>(`/reader/block-entities?ids=${ids.join(',')}`);
  return new Map(list.items.map(item => [item.blockId, item.entities.map(e => ({ name: e.name, href: entityHref(e.key) }))]));
}

/** backend 的一块 → 页面上列出的一块：正文 markdown → HTML、英文日期、指向阅读页那一块的链接、实体链接。各列块的页面共用 */
export function toBlockItem(block: BriefBlock, entityLinks: EntityLinks): BlockItem {
  return {
    id: block.id,
    title: block.title,
    bodyHtml: renderBlockBody(block.body),
    tier: block.tier,
    briefNumber: block.brief.id,
    dateLabel: formatReportDate(ensureDate(block.brief.createdAt)),
    href: `/briefs/${block.brief.id}#story-${block.position + 1}`,
    entities: entityLinks.get(block.id) ?? [],
  };
}
