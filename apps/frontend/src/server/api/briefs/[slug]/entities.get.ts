import type { BriefBlockEntities } from '@meridian/contracts';
import { entityHref } from '~/lib/entities';
import { readFromBackend } from '~/server/lib/backend';
import { briefIdFromSlug } from '~/server/lib/briefSlug';
import type { BriefEntityLinks } from '~/shared/types';

/**
 * 阅读页每块下的实体链接：条目的锚点 id → 这一块有实体页的实体。
 * 锚点按块在正文里的顺序编号（`story-1` 起，与 server/lib/blockItem.ts 拼「读这一块」链接的写法一致）。
 * 没有简报块的期（回填范围之外的往期）是空对象。
 */
export default defineEventHandler(async (event): Promise<BriefEntityLinks> => {
  const list = await readFromBackend<BriefBlockEntities>(`/reader/briefs/${briefIdFromSlug(event)}/block-entities`);
  return Object.fromEntries(
    list.items.map(item => [`story-${item.position + 1}`, item.entities.map(e => ({ name: e.name, href: entityHref(e.key) }))])
  );
});
