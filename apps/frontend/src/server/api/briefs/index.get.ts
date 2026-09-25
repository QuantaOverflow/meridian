import { z } from 'zod';
import type { BriefListResponse, BriefSummary } from '~/shared/types';
import { readFromBackend, type BackendBriefList } from '~/server/lib/backend';
import { stripInlineMarkdown } from '~/server/lib/briefContent';
import { ensureDate, formatReportDateCN, formatReportDateShortCN } from '~/server/lib/utils';

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const WORDS_PER_MINUTE = 300;
const EXCERPT_MAX = 160;

/** reports.title 是模型产出的关键词串，逗号切开正好是设计稿要的主题标签 */
function titleToTopics(title: string): string[] {
  return title
    .split(/[,、]/)
    .map(part => part.trim())
    .filter(part => part !== '')
    .slice(0, 6);
}

function toExcerpt(tldrProse: string | null): string | null {
  if (tldrProse === null) return null;
  const text = stripInlineMarkdown(tldrProse).trim();
  return text.length <= EXCERPT_MAX ? text : `${text.slice(0, EXCERPT_MAX)}…`;
}

export default defineEventHandler(async (event): Promise<BriefListResponse> => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' });
  }
  const { q, limit, offset } = parsed.data;

  // 检索（ILIKE 子串匹配）、计数与分页在 backend 的 /reader/briefs，这里只做展示
  const search = q === undefined || q === '' ? '' : `q=${encodeURIComponent(q)}&`;
  const list = await readFromBackend<BackendBriefList>(`/reader/briefs?${search}limit=${limit}&offset=${offset}`);

  const items: BriefSummary[] = list.items.map(row => {
    const createdAt = ensureDate(row.createdAt);
    return {
      id: row.id,
      // 期号而不是日期：同一天可能有多期，日期 slug 会点到别的期上去
      slug: String(row.id),
      title: row.title,
      dateShortCN: formatReportDateShortCN(createdAt),
      excerpt: toExcerpt(row.tldrProse),
      storyCount: row.storyCount,
      readingMinutes: Math.max(1, Math.ceil(row.wordCount / WORDS_PER_MINUTE)),
      topics: titleToTopics(row.title),
    };
  });

  return {
    items,
    matched: list.matched,
    total: list.total,
    earliestDateCN: list.earliest === null ? null : formatReportDateCN(ensureDate(list.earliest)),
  };
});
