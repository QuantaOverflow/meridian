import { z } from 'zod';
import { MAX_FOLLOWS_PER_KIND, type FollowingPage } from '@meridian/contracts';
import { countryName } from '~/lib/briefMap';
import { readFromBackend } from '~/server/lib/backend';
import { entityHref } from '~/lib/entities';
import { loadEntityLinks, toBlockItem } from '~/server/lib/blockItem';
import type { FollowingResponse } from '~/shared/types';

/** 逗号分隔的列表；空串是空列表 */
const csv = (value: string) => (value === '' ? [] : value.split(','));
const querySchema = z.object({
  countries: z.string().default('').transform(csv).pipe(z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(MAX_FOLLOWS_PER_KIND)),
  threads: z.string().default('').transform(csv).pipe(z.array(z.string().regex(/^\d{1,9}$/).transform(Number)).max(MAX_FOLLOWS_PER_KIND)),
  // 实体的写法里可以有逗号：一个实体一个 entities= 参数（只带一个时是字符串，几个时是数组）
  entities: z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform(value => [value].flat())
    .pipe(z.array(z.string().trim().min(1).max(200).refine(name => !name.includes('\0'))).max(MAX_FOLLOWS_PER_KIND)),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Following 页的一页：命中任一关注项的块，最新的在前。关注项记在读者的浏览器里，由页面带上来（`countries`、`threads`，逗号分隔；`entities` 一个实体一个参数）。
 * 查询与分页在 backend 的 /reader/following，这里只做展示：正文 markdown → HTML、英文日期、每个命中的关注项的名字与链接。
 * 关注项去重、排序后再转发：同一组关注项不论顺序都是同一条请求。
 */
export default defineEventHandler(async (event): Promise<FollowingResponse> => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' });
  }
  const { limit, offset } = parsed.data;
  const countries = [...new Set(parsed.data.countries.map(c => c.toUpperCase()))].sort();
  const threads = [...new Set(parsed.data.threads)].sort((a, b) => a - b);
  const entities = [...new Set(parsed.data.entities.map(e => e.toLowerCase()))].sort();
  // 没有关注项：不去问 backend
  if (countries.length === 0 && threads.length === 0 && entities.length === 0) return { total: 0, items: [], threads: [] };

  const page = await readFromBackend<FollowingPage>(
    // 没关注实体时不带 entities 参数
    `/reader/following?countries=${countries.join(',')}&threads=${threads.join(',')}${entities.map(e => `&entities=${encodeURIComponent(e)}`).join('')}&limit=${limit}&offset=${offset}`
  );
  const entityLinks = await loadEntityLinks(page.items);
  const threadTitles = new Map(page.threads.map(t => [t.id, t.title]));

  return {
    total: page.total,
    items: page.items.map(block => ({
      ...toBlockItem(block, entityLinks),
      briefCreatedAt: block.brief.createdAt,
      matches: block.matches.map(match => {
        if (match.kind === 'country') {
          return { kind: match.kind, label: countryName(match.code), href: `/countries/${match.code}`, involved: match.via === 'mention' };
        }
        if (match.kind === 'entity') {
          const href = entityHref(match.key);
          // 没过实体门槛的没有实体页：这一块的实体链接里没有它，就不给链接
          const link = entityLinks.get(block.id)?.find(e => e.href === href);
          return { kind: match.kind, label: link?.name ?? match.name, href: link?.href ?? null, involved: false };
        }
        return {
          kind: match.kind,
          // 没过线索门槛的没有线索页，也就没有标题与链接
          label: threadTitles.get(match.id) ?? 'A story thread you follow',
          href: threadTitles.has(match.id) ? `/stories/${match.id}` : null,
          involved: false,
        };
      }),
    })),
    threads: page.threads.map(t => ({ id: t.id, title: t.title })),
  };
});
