import { $articles, $brief_runs, $brief_stories, $reports, $sources, desc, eq, sql } from '@meridian/database';
import type { Db } from './db';

/**
 * 简报的读者视图数据（原在前端 server/api/briefs/* 直连库）。
 * 这里只出领域数据；markdown → HTML、剥行内 markdown、中文日期等展示在前端做。
 */

/**
 * 检索走 ILIKE 子串匹配，不是 Postgres 全文检索。
 *
 * 语料只有几十期、每天 +1，seq scan 的代价可以忽略；而 ILIKE 不吃分词配置，
 * 对「搜半个词」「搜专名的一部分」比 english 词干化更宽容——正文是英文、界面和
 * 使用者是中文，宽容比排序更重要。等语料涨到几千期再换 GIN 索引不迟。
 */
function buildSearchFilter(q: string | undefined) {
  if (q === undefined || q === '') return undefined;
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  return sql`(${$reports.title} ILIKE ${like} OR ${$reports.content} ILIKE ${like} OR coalesce(${$reports.tldr_prose}, '') ILIKE ${like})`;
}

export interface BriefListItem {
  id: number;
  createdAt: Date;
  title: string;
  tldrProse: string | null;
  storyCount: number;
  wordCount: number;
}

export interface BriefList {
  items: BriefListItem[];
  /** 命中当前检索条件的期数 */
  matched: number;
  /** 全部期数，与检索条件无关 */
  total: number;
  /** 最早一期的时间 */
  earliest: Date | null;
}

export async function listBriefs(db: Db, params: { q?: string; limit: number; offset: number }): Promise<BriefList> {
  const filter = buildSearchFilter(params.q);

  // 三条查询互不依赖。到 Neon（新加坡）单程就要几百毫秒，串行发等于白付三倍往返。
  const [rows, [{ matched }], [overall]] = await Promise.all([
    db
      .select({
        id: $reports.id,
        createdAt: $reports.createdAt,
        title: $reports.title,
        tldrProse: $reports.tldr_prose,
        // 事件条目数 = 正文里 <u> 标记的出现次数；比把整篇拉回来解析便宜得多
        storyCount: sql<number | null>`(length(${$reports.content}) - length(replace(${$reports.content}, '<u>', ''))) / 3`,
        wordCount: sql<number | null>`array_length(regexp_split_to_array(btrim(${$reports.content}), '\\s+'), 1)`,
      })
      .from($reports)
      .where(filter)
      .orderBy(desc($reports.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ matched: sql<number>`count(*)::int` }).from($reports).where(filter),
    db
      .select({
        total: sql<number>`count(*)::int`,
        earliest: sql<Date | null>`min(${$reports.createdAt})`.mapWith($reports.createdAt),
      })
      .from($reports),
  ]);

  return {
    items: rows.map(row => ({
      id: row.id,
      createdAt: row.createdAt,
      title: row.title,
      tldrProse: row.tldrProse,
      storyCount: Number(row.storyCount ?? 0),
      wordCount: Number(row.wordCount ?? 0),
    })),
    matched,
    total: overall.total,
    earliest: overall.earliest,
  };
}

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

async function getBriefSources(db: Db, reportId: ReturnType<typeof sql>): Promise<BriefSourceList> {
  // LATERAL 展开 jsonb 数组，查询构造器写不了，保留原生 SQL；列名一律走 drizzle 的列对象，改列名时 typecheck 能拦住
  const rows = (await db.execute(sql`
    SELECT DISTINCT ${$sources.name} AS source_name, ${$articles.title} AS article_title, ${$articles.url} AS article_url
    FROM ${$brief_runs}
    JOIN ${$brief_stories} ON ${$brief_stories.workflow_id} = ${$brief_runs.workflow_id}
    CROSS JOIN LATERAL jsonb_array_elements_text(${$brief_stories.article_ids}) AS aid
    JOIN ${$articles} ON ${$articles.id} = aid::int
    JOIN ${$sources} ON ${$sources.id} = ${$articles.sourceId}
    WHERE ${$brief_runs.report_id} = ${reportId}
      AND ${$brief_stories.selected_for_intel} = true
      -- article_ids 是 jsonb，历史行里可能是 null 或非数组，直接展开会整条查询报错
      AND jsonb_typeof(${$brief_stories.article_ids}) = 'array'
    ORDER BY ${$sources.name}, ${$articles.title}
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

export interface BriefDetailData {
  id: number;
  createdAt: Date;
  title: string;
  /** 正文 markdown 原文，解析成板块 / 条目在前端做 */
  content: string;
  tldrProse: string | null;
  usedArticles: number;
  usedSources: number;
  sources: BriefSource[];
  sourceArticleCount: number;
}

/**
 * 一期简报。被 /reader/briefs/:id 与 /reader/briefs/latest 共用——
 * 首页只发一次请求就能拿到正文，不必先问「最新是第几期」再取一次。
 */
export async function loadBrief(
  db: Db,
  target: { kind: 'id'; id: number } | { kind: 'latest' }
): Promise<BriefDetailData | null> {
  let where;
  // 同一个定位条件写两遍：一遍给 drizzle 查询构造器取报告本体，一遍作为 SQL 子查询喂给
  // 来源清单——这样两条查询能并行发，不必等报告回来拿到 id 再去取来源。
  // 到 Neon（新加坡）单程就要几百毫秒，省下这一趟是实打实的。
  let reportIdExpr;
  if (target.kind === 'id') {
    where = eq($reports.id, target.id);
    reportIdExpr = sql`${target.id}`;
  } else {
    reportIdExpr = sql`${db.select({ id: $reports.id }).from($reports).orderBy(desc($reports.createdAt)).limit(1)}`;
  }

  const [report, sourceList] = await Promise.all([
    db.query.$reports.findFirst({
      where,
      // latest 不带 where，靠排序取最新一期
      orderBy: desc($reports.createdAt),
      columns: {
        id: true,
        createdAt: true,
        title: true,
        content: true,
        tldr_prose: true,
        usedSources: true,
        usedArticles: true,
      },
    }),
    getBriefSources(db, reportIdExpr),
  ]);
  if (report === undefined) return null;

  return {
    id: report.id,
    createdAt: report.createdAt,
    title: report.title,
    content: report.content,
    tldrProse: report.tldr_prose,
    usedArticles: report.usedArticles,
    usedSources: report.usedSources,
    sources: sourceList.sources,
    sourceArticleCount: sourceList.articleCount,
  };
}
