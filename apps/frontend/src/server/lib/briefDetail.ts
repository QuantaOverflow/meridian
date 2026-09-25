import type { BriefDetail } from '~/shared/types';
import { readFromBackend, type BackendBriefDetail } from './backend';
import { parseBriefContent, stripInlineMarkdown } from './briefContent';
import { ensureDate, formatReportDateCN } from './utils';

/**
 * 一期简报的读者视图。被 /api/briefs/:slug 与 /api/briefs/latest 共用——
 * 首页只发一次请求就能拿到正文，不必先问「最新是第几期」再取一次。
 * 数据（报告本体 + 来源清单）来自 backend 的 /reader/briefs/*，这里只做展示：正文解析成板块 / 条目、中文日期。
 */
export async function loadBriefDetail(
  target: { kind: 'id'; id: number } | { kind: 'latest' },
  notFoundMessage: string
): Promise<BriefDetail> {
  const report = await readFromBackend<BackendBriefDetail>(
    `/reader/briefs/${target.kind === 'id' ? target.id : 'latest'}`,
    notFoundMessage
  );

  const createdAt = ensureDate(report.createdAt);
  const parsed = parseBriefContent(report.content);

  return {
    id: report.id,
    // 恒返回期号形态：调用方据此拼链接，就不会再退回有歧义的日期 slug
    slug: String(report.id),
    title: report.title,
    createdAt,
    dateCN: formatReportDateCN(createdAt),
    tldrProse: report.tldrProse === null ? null : stripInlineMarkdown(report.tldrProse),
    sections: parsed.sections,
    storyCount: parsed.storyCount,
    readingMinutes: parsed.readingMinutes,
    usedArticles: report.usedArticles,
    usedSources: report.usedSources,
    sources: report.sources,
    sourceArticleCount: report.sourceArticleCount,
  };
}
