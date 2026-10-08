import type { BriefBlock } from '@meridian/contracts';
import { renderBlockBody } from '~/server/lib/briefContent';
import { ensureDate, formatReportDate } from '~/server/lib/utils';
import type { BlockItem } from '~/shared/types';

/** backend 的一块 → 页面上列出的一块：正文 markdown → HTML、英文日期、指向阅读页那一块的链接。国家页与搜索页共用 */
export function toBlockItem(block: BriefBlock): BlockItem {
  return {
    id: block.id,
    title: block.title,
    bodyHtml: renderBlockBody(block.body),
    tier: block.tier,
    briefNumber: block.brief.id,
    dateLabel: formatReportDate(ensureDate(block.brief.createdAt)),
    href: `/briefs/${block.brief.id}#story-${block.position + 1}`,
  };
}
