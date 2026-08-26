import { boolean, index, integer, jsonb, pgEnum, pgTable, real, serial, text, timestamp, vector } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    used_browser: boolean('used_browser'),
    event_summary_points: jsonb('event_summary_points'),
    thematic_keywords: jsonb('thematic_keywords'),
    topic_tags: jsonb('topic_tags'),
    key_entities: jsonb('key_entities'),
    content_focus: jsonb('content_focus'),
    embedding: vector('embedding', { dimensions: 384 }),

    failReason: text('fail_reason'),

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

  totalArticles: integer('total_articles').notNull(),
  totalSources: integer('total_sources').notNull(),

  // 进入简报的去重文章数。
  // ⚠️ 语义在 2026-08-17 修正过：第 51-59 期存的是**故事数**（旧代码错写成
  // intelligenceReports.length，与 brief_runs.intelligence_analyses 同值），第 60 期起
  // 才是真正的文章数。跨期比较务必注意；旧期真值可由 brief_stories.article_ids 反算。
  usedArticles: integer('used_articles').notNull(),
  // 覆盖到的去重信源数。注意与 usedArticles 取自管线不同阶段：它按**全部已识别故事**算，
  // 而 usedArticles 按拿到情报报告的故事算。
  usedSources: integer('used_sources').notNull(),

  // ⚠️ 面向机器，不是面向读者的摘要。由 tldrGeneration prompt 产出，格式是每行
  // `故事标识 | 状态 | 关键实体 | 5-10 词要点`，供**次日**的简报模型读取当天覆盖了什么。
  // 读者端要展示的摘要请用 tldr_prose，别把这一列渲染给人看。
  tldr: text('tldr'),
  // 面向读者的散文摘要（2-3 句），读者端简报页头部展示。与 tldr 分开存是因为 tldr 被
  // 次日管线消费，格式不能动。
  tldr_prose: text('tldr_prose'),

  clustering_params: jsonb('clustering_params'),

  model_author: text('model_author'),

  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const $newsletter = pgTable('newsletter', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
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
    trace_id: text('trace_id').notNull(),
    status: briefRunStatusEnum().notNull().default('RUNNING'),
    triggered_by: text('triggered_by'),
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
  },
  table => [index('brief_runs_workflow_id_idx').on(table.workflow_id)]
);

// 跨期线索（读者端「事件追踪」）。一条线索 = 若干天里被判为同一条持续事件的 brief_stories。
//
// 归并靠 e5-small embedding 的余弦相似度，不调 LLM：文章 embedding 库里本来就有，
// 判据确定、可复现、零成本。阈值与回看窗口标定见 apps/backend/scripts/assign-story-clusters.js。
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
  centroid: vector('centroid', { dimensions: 384 }),
  first_seen_at: timestamp('first_seen_at', { mode: 'date' }).notNull(),
  last_seen_at: timestamp('last_seen_at', { mode: 'date' }).notNull(),
  created_at: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
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
    intel_report_r2_key: text('intel_report_r2_key'),
    // 跨期线索聚合（读者端「事件追踪」）。centroid = 本故事成员文章 embedding 的均值，
    // 落库而不是每次现算：匹配要拿历史故事的向量比对，现算得 join 全部 story-article 链路。
    centroid: vector('centroid', { dimensions: 384 }),
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

// 观测性：每次 workflow 中被拒绝的聚类与拒因
export const $cluster_rejections = pgTable(
  'cluster_rejections',
  {
    id: serial('id').primaryKey(),
    workflow_id: text('workflow_id')
      .notNull()
      .references(() => $brief_runs.workflow_id),
    cluster_id: integer('cluster_id'),
    reason: text('reason'),
    article_count: integer('article_count'),
    // 被拒绝聚类的成员文章 id。此前只存 count，导致"哪些文章从未进入任何故事"无法从库里查——
    // 而 -1 噪声桶已占窗口文章的约 70%(2026-08-18 实测 515/745)，是最需要复盘的一批。
    // 数据一直采集着（RejectedCluster.originalArticleIds），只是落库前被丢弃，这里补上。
    article_ids: jsonb('article_ids'),
    created_at: timestamp('created_at', { mode: 'date' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  table => [index('cluster_rejections_workflow_id_idx').on(table.workflow_id)]
);
