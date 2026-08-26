import { $reports, and, desc, eq, gte, lte, sql } from '@meridian/database';
import type { H3Event } from 'h3';
import type { BriefDetail } from '~/shared/types';
import { getBriefSources } from './briefSources';
import { parseBriefContent, stripInlineMarkdown } from './briefContent';
import { ensureDate, formatReportDate, formatReportDateCN, getDB } from './utils';

const BRIEF_COLUMNS = {
  id: true,
  createdAt: true,
  title: true,
  content: true,
  tldr_prose: true,
  model_author: true,
  totalArticles: true,
  totalSources: true,
  usedSources: true,
  usedArticles: true,
} as const;

/**
 * 一期简报的读者视图。被 /api/briefs/:slug 与 /api/briefs/latest 共用——
 * 首页只发一次请求就能拿到正文，不必先问「最新是第几期」再取一次。
 */
export async function loadBriefDetail(
  event: H3Event,
  target: { kind: 'id'; id: number } | { kind: 'date'; date: Date } | { kind: 'latest' }
): Promise<BriefDetail | null> {
  let where;
  // 同一个定位条件写两遍：一遍给 drizzle 查询构造器取报告本体，一遍作为 SQL 子查询喂给
  // 来源清单——这样两条查询能并行发，不必等报告回来拿到 id 再去取来源。
  // 到 Neon（新加坡）单程就要几百毫秒，省下这一趟是实打实的。
  let reportIdExpr;
  if (target.kind === 'id') {
    where = eq($reports.id, target.id);
    reportIdExpr = sql`${target.id}`;
  } else if (target.kind === 'date') {
    const { date } = target;
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    where = and(gte($reports.createdAt, startOfDay), lte($reports.createdAt, endOfDay));
    reportIdExpr = sql`(SELECT id FROM reports WHERE created_at >= ${startOfDay} AND created_at <= ${endOfDay} ORDER BY created_at DESC LIMIT 1)`;
  } else {
    reportIdExpr = sql`(SELECT id FROM reports ORDER BY created_at DESC LIMIT 1)`;
  }

  const [report, sourceList] = await Promise.all([
    getDB(event).query.$reports.findFirst({
      where,
      // 日期形态可能命中同一天的多期，取最新的一期，至少让结果确定
      orderBy: desc($reports.createdAt),
      columns: BRIEF_COLUMNS,
    }),
    getBriefSources(event, reportIdExpr),
  ]);
  if (report === undefined) return null;

  const createdAt = ensureDate(report.createdAt);
  const parsed = parseBriefContent(report.content);

  return {
    id: report.id,
    // 恒返回期号形态：调用方据此拼链接，就不会再退回有歧义的日期 slug
    slug: String(report.id),
    title: report.title,
    createdAt,
    date: formatReportDate(createdAt),
    dateCN: formatReportDateCN(createdAt),
    tldrProse: report.tldr_prose === null ? null : stripInlineMarkdown(report.tldr_prose),
    sections: parsed.sections,
    storyCount: parsed.storyCount,
    readingMinutes: parsed.readingMinutes,
    modelAuthor: report.model_author,
    totalArticles: report.totalArticles,
    totalSources: report.totalSources,
    usedArticles: report.usedArticles,
    usedSources: report.usedSources,
    sources: sourceList.sources,
    sourceArticleCount: sourceList.articleCount,
  };
}
