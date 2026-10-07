import { z } from 'zod';
import type { EntityBlocksPage } from '@meridian/contracts';
import { countryName } from '~/lib/briefMap';
import { readFromBackend } from '~/server/lib/backend';
import { entityHref } from '~/lib/entities';
import { loadEntityLinks, toBlockItem } from '~/server/lib/blockItem';
import type { EntityBlocksResponse } from '~/shared/types';

const querySchema = z.object({
  // 空写法、超过 200 字、带 NUL 的写法不转发，直接 400（backend 也回 400）
  name: z.string().trim().min(1).max(200).refine(name => !name.includes('\0')),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * 实体页的一页：挂着这个实体的块，最新的在前。查询、门槛与分页在 backend 的 /reader/entities/blocks，
 * 这里只做展示：正文 markdown → HTML、英文日期、国家英文名、指向阅读页那一块与别的实体页的链接。
 * 查的写法能归成国家时不开页，回国家页的地址，页面跳过去。
 */
export default defineEventHandler(async (event): Promise<EntityBlocksResponse> => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' });
  }
  const { limit, offset } = parsed.data;
  // 写法归一（小写、去首尾空白）后再转发：同一个实体不论怎么写都是同一条请求
  const name = parsed.data.name.toLowerCase();

  const page = await readFromBackend<EntityBlocksPage>(
    `/reader/entities/blocks?name=${encodeURIComponent(name)}&limit=${limit}&offset=${offset}`,
    'Entity not found'
  );
  if (page.kind === 'country') return { kind: 'country', href: `/countries/${page.country}` };

  const entityLinks = await loadEntityLinks(page.items);
  const self = entityHref(page.entity.key);
  return {
    kind: 'entity',
    key: page.entity.key,
    name: page.entity.name,
    total: page.total,
    items: page.items.map(block => ({
      ...toBlockItem(block, entityLinks),
      // 本页的实体不用再列一遍
      entities: (entityLinks.get(block.id) ?? []).filter(e => e.href !== self),
      placedIn: block.countries.placement === null ? null : countryName(block.countries.placement),
      alsoInvolves: block.countries.mentions.map(countryName),
    })),
  };
});
