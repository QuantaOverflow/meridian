import { z } from 'zod';
import type { SearchPage } from '@meridian/contracts';
import { readFromBackend } from '~/server/lib/backend';
import { loadEntityLinks, toBlockItem } from '~/server/lib/blockItem';
import type { SearchResponse } from '~/shared/types';

const querySchema = z.object({
  // 空查询与超过 200 字的查询直接 400，不转发（搜索页自己先判，不会带着这两种来）。
  // 带 NUL 字符的查询与过大的 offset 同样不转发：backend 也回 400（到了 Postgres 都是报错）
  q: z.string().trim().min(1).max(200).refine(q => !q.includes('\0')),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * 搜索简报块。检索、按线索折叠与分页在 backend 的 /reader/search，
 * 这里只做展示：正文 markdown → HTML、英文日期、指向阅读页那一块与线索页的链接。
 */
export default defineEventHandler(async (event): Promise<SearchResponse> => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' });
  }
  const { q, limit, offset } = parsed.data;

  const page = await readFromBackend<SearchPage>(`/reader/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`);
  const entityLinks = await loadEntityLinks(page.items.flatMap(group => group.blocks));

  return {
    query: page.query,
    total: page.total,
    totalBlocks: page.totalBlocks,
    items: page.items.map(group => ({
      thread: group.thread === null ? null : { ...group.thread, href: `/stories/${group.thread.id}` },
      blockCount: group.blockCount,
      blocks: group.blocks.map(block => toBlockItem(block, entityLinks)),
    })),
  };
});
