import { sql } from '@meridian/database';
import type { H3Event } from 'h3';
import { getDB } from './utils';

/**
 * 简报级来源清单。
 *
 * 设计稿原本要求每条事件条目下挂自己的来源，但正文里模型自写的条目标题
 * （`h-1b price hike`）和 brief_stories.title（`US — Trump administration proposes
 * $103,265 H-1B visa fee`）词面完全对不上，只能模糊匹配——把错误来源挂到某条事件上
 * 比不挂更糟。所以这里退到简报级：本期全部去重信源与原文，数据 100% 准确、零猜测。
 *
 * 口径取 selected_for_intel = true，即真正拿到情报报告、喂给了简报模型的那批故事，
 * 与 reports.used_articles 同源。
 */

export interface BriefSourceArticle {
  title: string;
  url: string;
}

export interface BriefSource {
  name: string;
  articles: BriefSourceArticle[];
}

export interface BriefSourceList {
  sources: BriefSource[];
  articleCount: number;
}

export async function getBriefSources(event: H3Event, reportId: ReturnType<typeof sql> | number): Promise<BriefSourceList> {
  const rows = (await getDB(event).execute(sql`
    SELECT DISTINCT s.name AS source_name, a.title AS article_title, a.url AS article_url
    FROM brief_runs br
    JOIN brief_stories bs ON bs.workflow_id = br.workflow_id
    CROSS JOIN LATERAL jsonb_array_elements_text(bs.article_ids) AS aid
    JOIN articles a ON a.id = aid::int
    JOIN sources s ON s.id = a.source_id
    WHERE br.report_id = ${reportId}
      AND bs.selected_for_intel = true
      -- article_ids 是 jsonb，历史行里可能是 null 或非数组，直接展开会整条查询报错
      AND jsonb_typeof(bs.article_ids) = 'array'
    ORDER BY s.name, a.title
  `)) as unknown as { source_name: string; article_title: string; article_url: string }[];

  const byName = new Map<string, BriefSource>();
  for (const row of rows) {
    let entry = byName.get(row.source_name);
    if (entry === undefined) {
      entry = { name: row.source_name, articles: [] };
      byName.set(row.source_name, entry);
    }
    entry.articles.push({ title: row.article_title, url: row.article_url });
  }

  return {
    sources: [...byName.values()].sort((a, b) => b.articles.length - a.articles.length),
    articleCount: rows.length,
  };
}
