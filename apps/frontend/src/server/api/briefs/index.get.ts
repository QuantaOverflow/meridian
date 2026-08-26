import { sql } from '@meridian/database';
import { z } from 'zod';
import type { BriefListResponse, BriefSummary } from '~/shared/types';
import { stripInlineMarkdown } from '~/server/lib/briefContent';
import {
  ensureDate,
  formatReportDate,
  formatReportDateCN,
  formatReportDateShortCN,
  getDB,
} from '~/server/lib/utils';

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ListRow {
  id: number;
  created_at: string | Date;
  title: string;
  tldr_prose: string | null;
  story_count: number | string | null;
  word_count: number | string | null;
}

const WORDS_PER_MINUTE = 300;
const EXCERPT_MAX = 160;

/**
 * 检索走 ILIKE 子串匹配，不是 Postgres 全文检索。
 *
 * 语料只有几十期、每天 +1，seq scan 的代价可以忽略；而 ILIKE 不吃分词配置，
 * 对「搜半个词」「搜专名的一部分」比 english 词干化更宽容——正文是英文、界面和
 * 使用者是中文，宽容比排序更重要。等语料涨到几千期再换 GIN 索引不迟。
 */
function buildSearchFilter(q: string | undefined) {
  if (q === undefined || q === '') return sql`TRUE`;
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  return sql`(title ILIKE ${like} OR content ILIKE ${like} OR coalesce(tldr_prose, '') ILIKE ${like})`;
}

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

  const db = getDB(event);
  const filter = buildSearchFilter(q);

  // 三条查询互不依赖。到 Neon（新加坡）单程就要几百毫秒，串行发等于白付三倍往返。
  const [rows, [{ matched }], [overall]] = (await Promise.all([
    db.execute(sql`
    SELECT
      id,
      created_at,
      title,
      tldr_prose,
      -- 事件条目数 = 正文里 <u> 标记的出现次数；比把整篇拉回来解析便宜得多
      (length(content) - length(replace(content, '<u>', ''))) / 3 AS story_count,
      array_length(regexp_split_to_array(btrim(content), '\\s+'), 1) AS word_count
    FROM reports
    WHERE ${filter}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `),
    db.execute(sql`SELECT count(*)::int AS matched FROM reports WHERE ${filter}`),
    db.execute(sql`SELECT count(*)::int AS total, min(created_at) AS earliest FROM reports`),
  ])) as unknown as [ListRow[], { matched: number }[], { total: number; earliest: string | Date | null }[]];

  const items: BriefSummary[] = rows.map(row => {
    const createdAt = ensureDate(row.created_at);
    const words = Number(row.word_count ?? 0);
    return {
      id: row.id,
      // 期号而不是日期：同一天可能有多期，日期 slug 会点到别的期上去
      slug: String(row.id),
      title: row.title,
      createdAt,
      date: formatReportDate(createdAt),
      dateShortCN: formatReportDateShortCN(createdAt),
      excerpt: toExcerpt(row.tldr_prose),
      storyCount: Number(row.story_count ?? 0),
      readingMinutes: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
      topics: titleToTopics(row.title),
    };
  });

  return {
    items,
    matched,
    hasMore: offset + items.length < matched,
    total: overall.total,
    earliestDateCN: overall.earliest === null ? null : formatReportDateCN(ensureDate(overall.earliest)),
  };
});
