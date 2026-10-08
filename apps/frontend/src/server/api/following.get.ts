import { z } from 'zod';
import { MAX_FOLLOWS_PER_KIND, type FollowingPage } from '@meridian/contracts';
import { countryName } from '~/lib/briefMap';
import { readFromBackend } from '~/server/lib/backend';
import { toBlockItem } from '~/server/lib/blockItem';
import type { FollowingResponse } from '~/shared/types';

/** 逗号分隔的列表；空串是空列表 */
const csv = (value: string) => (value === '' ? [] : value.split(','));
const querySchema = z.object({
  countries: z.string().default('').transform(csv).pipe(z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(MAX_FOLLOWS_PER_KIND)),
  threads: z.string().default('').transform(csv).pipe(z.array(z.string().regex(/^\d{1,9}$/).transform(Number)).max(MAX_FOLLOWS_PER_KIND)),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Following 页的一页：命中任一关注项的块，最新的在前。关注项记在读者的浏览器里，由页面带上来（`countries`、`threads`，逗号分隔）。
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
  // 没有关注项：不去问 backend
  if (countries.length === 0 && threads.length === 0) return { total: 0, items: [], threads: [] };

  const page = await readFromBackend<FollowingPage>(
    `/reader/following?countries=${countries.join(',')}&threads=${threads.join(',')}&limit=${limit}&offset=${offset}`
  );
  const threadTitles = new Map(page.threads.map(t => [t.id, t.title]));

  return {
    total: page.total,
    items: page.items.map(block => ({
      ...toBlockItem(block),
      briefCreatedAt: block.brief.createdAt,
      matches: block.matches.map(match =>
        match.kind === 'country'
          ? { kind: match.kind, label: countryName(match.code), href: `/countries/${match.code}`, involved: match.via === 'mention' }
          : {
              kind: match.kind,
              // 没过线索门槛的没有线索页，也就没有标题与链接
              label: threadTitles.get(match.id) ?? 'A story thread you follow',
              href: threadTitles.has(match.id) ? `/stories/${match.id}` : null,
              involved: false,
            }
      ),
    })),
    threads: page.threads.map(t => ({ id: t.id, title: t.title })),
  };
});
