import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EMBEDDING_DIM, type BriefTier, type RunOpsSummary } from '@meridian/contracts';

/**
 * Note: We use $ to denote the table objects
 * This frees up the uses of sources, articles, reports, etc as variables in the codebase
 **/

export const articleStatusEnum = pgEnum('article_status', [
  'PENDING_FETCH',
  'CONTENT_FETCHED',
  'PROCESSED',
  'SKIPPED_PDF',

  'FETCH_FAILED',
  'RENDER_FAILED',
  'AI_ANALYSIS_FAILED',
  'EMBEDDING_FAILED',
  'R2_UPLOAD_FAILED',
  'SKIPPED_TOO_OLD',
]);
export const articleCompletenessEnum = pgEnum('article_completeness', [
  'COMPLETE',
  'PARTIAL_USEFUL',
  'PARTIAL_USELESS',
]);
export const articleContentQualityEnum = pgEnum('article_content_quality', ['OK', 'LOW_QUALITY', 'JUNK']);

export const $sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  url: text('url').notNull().unique(),
  name: text('name').notNull(),
  scrape_frequency: integer('scrape_frequency').notNull().default(2), // 1=hourly, 2=4hrs, 3=6hrs, 4=daily
  paywall: boolean('paywall').notNull().default(false),
  category: text('category').notNull(),
  lastChecked: timestamp('last_checked', { mode: 'date' }),
  do_initialized_at: timestamp('do_initialized_at', { mode: 'date' }),
  // 暂停自动抓取的时间；非空时 DO 不抓、批量初始化跳过，恢复时清空（源与已有文章都保留）
  paused_at: timestamp('paused_at', { mode: 'date' }),
  // 抓取程序最近一轮的结局（每轮都写，成功失败都算）：最近一次尝试的时间，和失败时的原因（成功时清空）。
  // lastChecked 只在整轮成功时前进，光看它分不出「没去检查」和「去了但失败」；运维台靠这两列说明为什么没检查成
  last_attempt_at: timestamp('last_attempt_at', { mode: 'date' }),
  last_error: text('last_error'),
});

export const $articles = pgTable(
  'articles',
  {
    id: serial('id').primaryKey(),

    title: text('title').notNull(),
    url: text('url').notNull().unique(),
    publishDate: timestamp('publish_date', { mode: 'date' }),
    status: articleStatusEnum().default('PENDING_FETCH'),
    contentFileKey: text('content_file_key'),

    language: text('language'),
    primary_location: text('primary_location'),
    completeness: articleCompletenessEnum(),
    content_quality: articleContentQualityEnum(),
    // 正文是不是浏览器渲染抓回来的（fetch 失败后降级）。平时没人读，排查抓取问题时要用：
    // 2026-09-24 按「只写不读」删过一次，次日排查浏览器渲染 401 / 人机验证页时分不出走的哪条路，加回
    used_browser: boolean('used_browser'),
    event_summary_points: jsonb('event_summary_points'),
    thematic_keywords: jsonb('thematic_keywords'),
    topic_tags: jsonb('topic_tags'),
    key_entities: jsonb('key_entities'),
    content_focus: jsonb('content_focus'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),

    failReason: text('fail_reason'),
    // 抽出的正文有几行非空行（抓取成功时记）。1 = 段落黏成一行；null = 加这列之前的旧文章或没抓到正文。运维台按它算「黏成一行」的占比
    body_lines: integer('body_lines'),

    sourceId: integer('source_id')
      .references(() => $sources.id)
      .notNull(),

    processedAt: timestamp('processed_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
  },
  table => [index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops'))]
);

export const $reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),

  // 进入简报的去重文章数。
  // ⚠️ 语义在 2026-08-17 修正过：第 51-59 期存的是**故事数**（旧代码错写成
  // intelligenceReports.length，与 brief_runs.intelligence_analyses 同值），第 60 期起
  // 才是真正的文章数。跨期比较务必注意；旧期真值可由 brief_stories.article_ids 反算。
  usedArticles: integer('used_articles').notNull(),
  // 覆盖到的去重信源数。注意与 usedArticles 取自管线不同阶段：它按**全部已识别故事**算，
  // 而 usedArticles 按拿到情报报告的故事算。
  usedSources: integer('used_sources').notNull(),

  // 面向读者的散文摘要（2-3 句），读者端简报页头部展示。
  tldr_prose: text('tldr_prose'),

  // 读者能看到这一期的时刻；null = 读者看不到（归档、今日简报、单期页、事件追踪都只认非 null 的期）。
  // 定时（cron）跑出的期保存时写入；手动触发的期是调试用的，留空（规则在 save-brief-report.ts）。
  // 撤回一期 = 置空；手动期要给读者看 = 手动写入。
  published_at: timestamp('published_at', { mode: 'date' }),

  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// 观测性：brief 生成工作流的运行级记录
export const briefRunStatusEnum = pgEnum('brief_run_status', [
  'RUNNING',
  'COMPLETED',
  'DEGRADED', // 完成但有可对账的局部失败（如选中 N story 只产出 M<N 份情报报告）——见 auto-brief intel 步失败对账
  'FAILED',
  'BLOCKED_FAITHFULNESS', // 忠实度门 enforce 拦截（枚举先备好，enforce 上线翻开关即用；见 auto-brief ~1406）
  'TERMINATED_NO_STORIES',
]);

export const $brief_runs = pgTable(
  'brief_runs',
  {
    id: serial('id').primaryKey(),
    workflow_id: text('workflow_id').notNull().unique(),
    status: briefRunStatusEnum().notNull().default('RUNNING'),
    params: jsonb('params'),

    started_at: timestamp('started_at', { mode: 'date' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    finished_at: timestamp('finished_at', { mode: 'date' }),

    total_articles: integer('total_articles'),
    clusters_found: integer('clusters_found'),
    stories_identified: integer('stories_identified'),
    intelligence_analyses: integer('intelligence_analyses'),
    brief_content_length: integer('brief_content_length'),

    report_id: integer('report_id').references(() => $reports.id),
    error: text('error'),
    // run 结束时写下的汇总（调用数、neurons、各步耗时、降级原因），形状是 @meridian/contracts 的 RunOpsSummary。
    // null = 没记下（加这列之前的 run，或写汇总那一步失败）
    ops_summary: jsonb('ops_summary').$type<RunOpsSummary>(),
  }
);

// 跨期线索（读者端「事件追踪」）。一条线索 = 若干天里被判为同一条持续事件的 brief_stories。
//
// 归并靠 e5-small embedding 的余弦相似度，不调 LLM：文章 embedding 库里本来就有，
// 判据确定、可复现、零成本。阈值与回看窗口标定见 apps/backend/scripts/assign-story-clusters.ts。
//
// 表本身只存无法从成员推导的东西（首末出现时间、展示标题）；持续天数、期数、进行中与否
// 一律读时按成员算——数据量只有几千行，冗余字段带来的不一致风险远大于那点查询开销。
export const $story_clusters = pgTable('story_clusters', {
  id: serial('id').primaryKey(),
  // 展示标题，取最近一次并入的 story 标题（线索的说法会随事态演变）
  title: text('title').notNull(),
  // 线索质心 = 全部已进简报成员 centroid 的均值。
  // ⚠️ 必须比对质心而不是「最相似的那个成员」：单链归并会串线——实测一条线索从
  // 「以色列在黎巴嫩的军事行动」经由中东主题的中间故事一路并到「G7 埃维昂峰会」
  // 和「安卡拉北约峰会对乌援助」，77 个成员跨 52 天。质心链接要求新故事像这条线索的
  // **整体**，而不是像其中任意一个成员。
  centroid: vector('centroid', { dimensions: EMBEDDING_DIM }),
  first_seen_at: timestamp('first_seen_at', { mode: 'date' }).notNull(),
  last_seen_at: timestamp('last_seen_at', { mode: 'date' }).notNull(),
});

// 观测性：每次 workflow 验证通过的 story 元数据
export const $brief_stories = pgTable(
  'brief_stories',
  {
    id: serial('id').primaryKey(),
    workflow_id: text('workflow_id')
      .notNull()
      .references(() => $brief_runs.workflow_id),
    cluster_id: integer('cluster_id'),
    title: text('title'),
    importance: real('importance'),
    article_count: integer('article_count'),
    article_ids: jsonb('article_ids'),
    selected_for_intel: boolean('selected_for_intel').notNull().default(false),
    // 跨期线索聚合（读者端「事件追踪」）。centroid = 本故事成员文章 embedding 的均值，
    // 落库而不是每次现算：匹配要拿历史故事的向量比对，现算得 join 全部 story-article 链路。
    centroid: vector('centroid', { dimensions: EMBEDDING_DIM }),
    story_cluster_id: integer('story_cluster_id').references(() => $story_clusters.id),
    // 最能代表这个故事的那篇文章 = 离 centroid 最近的成员。
    // ⚠️ 不能拿 article_ids[0]：聚类会把无关文章混进故事，而数组顺序是任意的。
    // 实证（story 1076「Europe — Wildfires」）：数组第一篇是「智力障碍人群预期寿命」，
    // 按质心距离排它是倒数第二，第一名才是「比利时消防员扑救大火」。
    // 落库而不是读时现算：读时跑 lateral 实测 1.7s，这里一次算好读时只剩一个 join。
    lead_article_id: integer('lead_article_id').references(() => $articles.id),
    created_at: timestamp('created_at', { mode: 'date' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  table => [
    index('brief_stories_workflow_id_idx').on(table.workflow_id),
    index('brief_stories_cluster_id_idx').on(table.story_cluster_id),
  ]
);


const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

// 简报块：每个写出来的块一行（为什么另存一张表而不是每次从 reports.content 里切，见 ADR 0014）。
// 保存简报时与 reports 行同事务写入（backend lib/save-brief-report.ts）；往期由 apps/backend/scripts/backfill-brief-blocks.ts 回填。
// 对读者可见与否跟所属那一期走（reports.published_at），靠 join 判，这里不另存状态。
export const $brief_blocks = pgTable(
  'brief_blocks',
  {
    id: serial('id').primaryKey(),
    report_id: integer('report_id')
      .notNull()
      .references(() => $reports.id, { onDelete: 'cascade' }),
    // 一个故事至多一块
    story_id: integer('story_id')
      .notNull()
      .references(() => $brief_stories.id)
      .unique(),
    tier: text('tier').$type<BriefTier>().notNull(),
    // 期内第几块（0 起，只数写出来的块），阅读页锚点 story-{position + 1}
    position: integer('position').notNull(),
    // 与读者页上那一块一致：标题是写作层起的（不是 brief_stories.title），正文是 reports.content 里那一段
    title: text('title').notNull(),
    body: text('body').notNull(),
    // 这一块对国家的归属，写块时按成员文章算好（规则在 @meridian/contracts 的 blockCountries，算法在 backend lib/reader/story-countries.ts）；
    // 国家页按这两列查。代码是 ISO 3166-1 alpha-2（联合国 UN）。回填脚本重跑即刷新
    placement_country: text('placement_country'),
    // 涉及的国家：不含落点国家
    mention_countries: text('mention_countries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // 全文检索（英文）：标题权重 A、正文权重 B。生成列，写入方不管它
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', "body"), 'B')`
      ),
    created_at: timestamp('created_at', { mode: 'date' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  table => [
    unique('brief_blocks_report_position_unique').on(table.report_id, table.position),
    index('brief_blocks_search_idx').using('gin', table.search),
    index('brief_blocks_placement_country_idx').on(table.placement_country),
    index('brief_blocks_mention_countries_idx').using('gin', table.mention_countries),
  ]
);
