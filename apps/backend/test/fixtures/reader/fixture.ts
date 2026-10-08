/**
 * 读者视图与后台源读数的固定 fixture：前端 `/api/*` 快照（apps/frontend/test/reader-api-golden.test.ts）
 * 与 backend `/reader/*`、`/admin/sources*` 快照（apps/backend/test/lib/reader.spec.ts）共用同一份。
 *
 * 所有时间戳 = 锚点日（数据库 CURRENT_DATE，00:00 UTC）+ 偏移，快照里的日期再换成相对记号（见 dates.ts）。
 * 与「当前时间」相关的判定都离边界足够远，一天里任何时刻跑、数据库时区在 ±14h 内都不影响结果：
 * - 线索的 days_since_update 用 CURRENT_DATE 算，而锚点就是 CURRENT_DATE，偏移即天数；
 * - 后台「今日」：startOfToday 取的是 UTC 日期，可能是锚点日 ±1 天，所以「今天」的文章放在 +1 天、
 *   其余文章都在 -2 天及更早；
 * - 后台「近 7 天」：窗口内的在 -2 / -3 天，窗口外的在 -10 天；
 * - 过期源（last_checked < NOW() - N 小时）：过期的在 -5 天，新鲜的在 +3 天（未来，永远不过期）。
 *
 * 覆盖：有 `## top stories` 节的与没有的简报、正文漏出的 prompt 变量、无标题开头与空板块、tldr 为 null /
 * 带行内 markdown；线索 active（升级：连续天数 / 重要度）/ active 不升级 / dormant、只出现一期的簇被门槛挡掉、
 * 没挂 report 的 run 不计；未发布的期（手动触发的调试期，published_at 为 null）在归档、最新一期、单期页、线索里都不出现——
 * 它比最新一期还新、标题命中检索、还给「只出现一期」的簇 5 凑出第二期，漏过滤任何一处快照都会变；article_ids 为 null / 非数组 / 同一篇重复；源的各状态（新鲜 / 过期 / 暂停未初始化 / 无文章）、
 * 文章超过一页（55 篇）、各种 status / completeness / quality。
 *
 * 地图（/reader/briefs/8/map）另用到几个别的读者 golden 都不读的字段（Beta 101 / 105 / 112 的 primary_location 例外，
 * 它只出现在 admin-source-2-details 里）：文章的 content_file_key 与 topic_tags、
 * brief_stories.cluster_id、wf-r8 的 params（时间窗放到 4 天，让第 -3 天的 Alpha 文章落进当期窗口），
 * 以及 R2 里 wf-r8 的 brief-v3 记录（putBrief8Record）。改这些不动其它 golden。
 *
 * 国家页（/reader/countries/:code/blocks）读简报块：第 6–9 期各有几块，经生产的写法（writeBriefBlocks）落库，
 * 落点国家与涉及国家由它按成员文章算。以色列：落点在该国的三块（第 8、7、6 期）、涉及该国的一块（第 7 期的 story 14，
 * 成员没有地点、关键实体里都提到 Israel 与 Iran）；未发布的第 9 期那块不该出现。
 *
 * 实体页（/reader/entities/blocks、/reader/block-entities）读块上的实体，同样由 writeBriefBlocks 按成员文章的 key_entities 算：
 * Benjamin Netanyahu 在已发布的 5 块里都有（恰好过门槛，有实体页）；Hamas 在已发布的 4 块加未发布的第 9 期那块里
 *（把未发布的算进去才够 5 块，不该有页）；Federal Reserve 只在 1 块；Reuters 是媒体名、Iran 与 Israel 是国家，都不是实体。
 * key_entities 只有这几处读，别的 golden 不读。
 */
import { briefV3RecordKey, type BriefBlockDraft, type BriefTier, type BriefV3Record, type BriefV3WrittenBlock } from '@meridian/contracts';
import {
  $articles,
  $brief_runs,
  $brief_stories,
  $reports,
  $sources,
  $story_clusters,
  sql,
  type getDb,
} from '@meridian/database';
import { writeBriefBlocks } from '../../../src/lib/core/brief-blocks';

type Db = ReturnType<typeof getDb>;

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export function buildReaderFixture(anchor: Date) {
  /** 锚点日 + day 天，当天 hour 点（UTC）+ minute 分 */
  const at = (day: number, hour = 12, minute = 0) => new Date(anchor.getTime() + day * 24 * HOUR + hour * HOUR + minute * MINUTE);
  const vec = Array.from({ length: 384 }, () => 0.01);
  /** 第 0 维 a、第 1 维 b、其余维 0.01 的向量（避免零向量），用来摆出离质心近 / 远的成员 */
  const twoDim = (a: number, b: number) => vec.map((x, i) => (i === 0 ? a : i === 1 ? b : x));

  const sources: (typeof $sources.$inferInsert)[] = [
    { id: 1, url: 'https://feeds.example.com/alpha.xml', name: 'Alpha News', category: 'news', scrape_frequency: 1, lastChecked: at(3), do_initialized_at: at(-30) },
    { id: 2, url: 'https://feeds.example.com/beta.xml', name: 'Beta Wire', category: 'world', scrape_frequency: 2, paywall: true, lastChecked: at(-5), do_initialized_at: at(-30) },
    { id: 3, url: 'https://feeds.example.com/gamma.xml', name: 'Gamma Daily', category: 'news', scrape_frequency: 4, lastChecked: null, paused_at: at(-3) },
    { id: 4, url: 'https://feeds.example.com/delta.xml', name: 'Delta Tech', category: 'tech', scrape_frequency: 3, lastChecked: at(-5, 9), do_initialized_at: at(-30) },
  ];

  const articles: (typeof $articles.$inferInsert)[] = [];
  // Alpha：55 篇，超过后台详情的一页（50）
  for (let i = 1; i <= 55; i++) {
    const n = String(i).padStart(2, '0');
    const processed = i % 5 !== 0 && i % 5 !== 1;
    articles.push({
      id: i,
      title: `alpha article ${n}`,
      url: `https://alpha.example.com/${n}`,
      sourceId: 1,
      // 1-3「今天」，4-50 在近 7 天内，51-55 在窗口外
      createdAt: i <= 3 ? at(1, 12, i) : i <= 50 ? at(-2, 12, -i) : at(-10, 12, -i),
      publishDate: at(-3, 12, -i * 13),
      status: i % 5 === 0 ? 'FETCH_FAILED' : i % 5 === 1 ? 'PENDING_FETCH' : 'PROCESSED',
      failReason: i % 5 === 0 ? 'HTTP 403' : null,
      processedAt: processed ? at(-2, 13, i) : null,
      completeness: processed ? (i % 3 === 0 ? 'PARTIAL_USEFUL' : 'COMPLETE') : null,
      content_quality: processed ? (i % 11 === 0 ? 'JUNK' : i % 7 === 0 ? 'LOW_QUALITY' : 'OK') : null,
      language: processed ? 'en' : null,
      primary_location: processed ? (i % 4 === 0 ? 'GB' : 'US') : null,
      embedding: processed && i % 2 === 0 ? vec : null,
      contentFileKey: processed ? `articles/alpha-${n}.txt` : null,
      // 主题标签大小写混着写（生产也是），地图比对前转小写；i % 8 === 0 的多带一个 Crime
      topic_tags: processed
        ? [...(i % 3 === 0 ? ['Economy', 'Business'] : i % 3 === 1 ? ['Politics', 'World Affairs'] : ['Technology', 'politics']), ...(i % 8 === 0 ? ['Crime'] : [])]
        : null,
    });
  }
  // Beta：简报与线索引用的文章，带事件要点
  const points: Record<number, string[] | null> = {
    101: ['Talks resumed in Cairo.', 'Hostage exchange discussed', 'Aid trucks queued.', 'A fourth point is not shown.'],
    102: ['Iran oil exports fell。', 'US Treasury added sanctions.'],
    103: ['Fires spread in Greece.', 'Evacuations ordered'],
    104: null,
    105: ['Fed held rates.'],
    109: ['Smoke reached Italy.'],
  };
  const locations: Record<number, string> = { 101: 'Israel', 112: 'Gaza', 105: 'United States' };
  // 关键实体：国家的那几个给第 7 期 story 14 算「涉及」；其余给实体页（见文件头）
  const entities: Record<number, string[]> = {
    101: ['Benjamin Netanyahu', 'Hamas', 'Reuters'],
    102: ['Iran', 'Israel', 'Benjamin Netanyahu', 'Hamas'],
    111: ['Iran', 'Israel', 'Benjamin Netanyahu'],
    105: [' benjamin netanyahu ', 'Federal Reserve'],
  };
  for (let id = 101; id <= 112; id++) {
    articles.push({
      id,
      title: `beta article ${id}`,
      url: `https://beta.example.com/${id}`,
      sourceId: 2,
      createdAt: at(-3, 12, id - 100),
      publishDate: id === 107 ? null : at(-4, 12, id - 100),
      status: id === 109 ? 'RENDER_FAILED' : 'PROCESSED',
      processedAt: id === 109 ? null : at(-3, 13, id - 100),
      completeness: id === 109 ? null : 'COMPLETE',
      content_quality: id === 109 ? null : id === 110 ? 'LOW_QUALITY' : 'OK',
      event_summary_points: points[id] ?? null,
      topic_tags: id === 101 || id === 112 ? ['Security', 'Conflict', 'World Affairs'] : id === 105 ? ['Economy', 'Politics'] : null,
      // 第 8 期正文故事的成员：story 15 = Israel + Gaza（落在一国、第二国过连线门槛），story 16 = 美国
      primary_location: locations[id] ?? null,
      key_entities: entities[id] ?? null,
    });
  }

  const reports: (typeof $reports.$inferInsert)[] = [
    {
      id: 1,
      createdAt: at(-25),
      title: 'ukraine, energy prices',
      usedArticles: 4,
      usedSources: 2,
      tldr_prose: null,
      content: [
        '## global landscape',
        '',
        '## europe',
        '<u>ukraine peace talks</u>',
        'Negotiators met in Geneva.',
        '',
        'A second round is planned.',
        '<u>energy prices</u>',
        'Gas prices fell 3%.',
      ].join('\n'),
    },
    {
      id: 2,
      createdAt: at(-20),
      title: 'ukraine、sanctions',
      usedArticles: 2,
      usedSources: 1,
      tldr_prose: 'Talks **stalled** as *sanctions* widened and `tariffs` rose.',
      content: [
        'An intro paragraph with no heading.',
        '',
        '<u>sanctions widen</u>',
        'The EU added 12 entities.',
        '',
        'Officials said more would follow.',
        '## noteworthy & under-reported',
        '- There are no clusters related to China in the provided <curated_news_data>.',
        '- A dam report was released.',
      ].join('\n'),
    },
    {
      id: 3,
      createdAt: at(-6),
      title: 'gaza, markets, ai, elections, fires, rates, extra topic',
      usedArticles: 3,
      usedSources: 2,
      tldr_prose: 'A quiet day. Markets beat 100% of the forecast.',
      content: [
        '## top stories',
        '<u>**gaza aid convoy**</u>',
        'Aid convoys entered Gaza.',
        '',
        'UN officials welcomed it.',
        '<u>**market rally**</u>',
        'Stocks rose 100% of the forecast gain.',
        '## more news',
        '<u>**ai chip export rules**</u>',
        'New rules were drafted.',
        '## in brief',
        '<u>**local election**</u>',
        'Turnout was low.',
      ].join('\n'),
    },
    {
      id: 4,
      createdAt: at(-4),
      title: 'iran oil',
      usedArticles: 1,
      usedSources: 1,
      tldr_prose: 'Iran oil exports fell sharply this week, according to shipping data compiled by several independent trackers, and analysts expect further declines as new sanctions take effect and buyers in Asia look elsewhere for supply.',
      content: ['## top stories', '<u>**iran oil exports**</u>', 'Exports fell.', '## more news', '<u>**shipping costs**</u>', 'Costs rose.'].join('\n'),
    },
    {
      id: 5,
      createdAt: at(-3),
      title: 'wildfires, europe',
      usedArticles: 3,
      usedSources: 1,
      tldr_prose: 'Fires spread across southern Europe.',
      content: ['## top stories', '<u>**greek fires**</u>', 'Fires spread.', '## in brief', '<u>**smoke over italy**</u>', 'Smoke drifted west.'].join('\n'),
    },
    {
      id: 6,
      createdAt: at(-2),
      title: 'gaza talks',
      usedArticles: 2,
      usedSources: 2,
      tldr_prose: 'Talks moved to Cairo.',
      content: ['## top stories', '<u>**gaza talks in cairo**</u>', 'Talks resumed.'].join('\n'),
    },
    {
      id: 7,
      createdAt: at(-1),
      title: 'gaza, iran',
      usedArticles: 4,
      usedSources: 1,
      tldr_prose: 'A hostage deal and new sanctions.',
      content: ['## top stories', '<u>**hostage deal**</u>', 'A deal was reached.', '<u>**iran sanctions**</u>', 'New sanctions were announced.'].join('\n'),
    },
    {
      id: 8,
      createdAt: at(0),
      title: 'gaza ceasefire, fed rates',
      usedArticles: 4,
      usedSources: 2,
      tldr_prose: 'The ceasefire held; the Fed *held* rates.',
      content: [
        '## top stories',
        '<u>**gaza ceasefire holds**</u>',
        'The ceasefire held for a third day.',
        '',
        'Aid deliveries rose.',
        '## more news',
        '<u>**fed holds rates**</u>',
        'The Fed held rates at 4.25%.',
      ].join('\n'),
    },
  ];

  // 已发布的期：发布时刻 = 保存时刻（与生产回填口径一致）
  for (const r of reports) r.published_at = r.createdAt;
  // 未发布的期：手动触发的调试期
  reports.push({
    id: 9,
    createdAt: at(0, 18),
    published_at: null,
    title: 'ukraine debug rerun',
    usedArticles: 1,
    usedSources: 1,
    tldr_prose: null,
    content: ['## top stories', '<u>**ukraine debug**</u>', 'A manual debug run.'].join('\n'),
  });

  const briefRuns: (typeof $brief_runs.$inferInsert)[] = [
    ...reports.map(r => ({
      workflow_id: `wf-r${r.id}`,
      status: 'COMPLETED' as const,
      report_id: r.id,
      started_at: r.createdAt,
      params: r.id === 8 ? { timeRangeDays: 4 } : null,
    })),
    // 没挂 report 的 run：它的故事不进任何读者视图
    { workflow_id: 'wf-orphan', status: 'FAILED' as const, report_id: null, started_at: at(0, 6) },
  ];

  const clusters: (typeof $story_clusters.$inferInsert)[] = [
    // 表里的 title 故意和最新成员的标题不同：读者看到的应是最新成员的标题
    { id: 1, title: 'stale title from merge', first_seen_at: at(-2), last_seen_at: at(0) },
    { id: 2, title: 'Iran', first_seen_at: at(-4), last_seen_at: at(-1) },
    { id: 3, title: 'Europe fires', first_seen_at: at(-6), last_seen_at: at(-3) },
    { id: 4, title: 'Ukraine', first_seen_at: at(-25), last_seen_at: at(-20) },
    // 只出现在一期简报里：不到 MIN_BRIEFS，不算线索
    { id: 5, title: 'Fed', first_seen_at: at(0), last_seen_at: at(0) },
    // 标题取法：成员够多（6 条）、最新那条是串进来的离群故事（离线索质心远），次新那条标题只有一个词——
    // 读者应看到「最近几条里不是单词、离质心最近」的那条（story 25），而不是最新那条
    { id: 6, title: 'Avalanche kills two climbers', centroid: twoDim(5, 1), first_seen_at: at(-6), last_seen_at: at(0) },
  ];

  const story = (
    id: number,
    report: number | 'orphan',
    title: string,
    importance: number | null,
    article_ids: unknown,
    selected_for_intel: boolean,
    story_cluster_id: number | null,
    lead_article_id: number | null,
    centroid?: number[]
  ): typeof $brief_stories.$inferInsert => ({
    id,
    workflow_id: `wf-${report === 'orphan' ? 'orphan' : `r${report}`}`,
    title,
    importance,
    article_ids,
    selected_for_intel,
    story_cluster_id,
    lead_article_id,
    centroid,
  });
  const briefStories = [
    story(1, 1, 'Ukraine — peace talks', 0.5, [104, 1], true, 4, 104),
    story(2, 1, 'Energy prices', 0.4, [2, 3], true, null, 2),
    story(3, 2, 'Ukraine — sanctions widen', 0.9, [104, 106], true, 4, 104),
    story(4, 2, 'Unselected candidate', 0.3, [107], false, null, null),
    story(5, 3, 'Europe — wildfires spread', 0.9, [103, 4], true, 3, 103),
    story(6, 3, 'Markets rally', 0.6, null, true, null, null),
    story(7, 4, 'Iran — oil exports', 0.3, [102], true, 2, 102),
    story(8, 4, 'Malformed article ids', 0.2, { bad: true }, true, null, null),
    story(9, 5, 'Europe — Greek fires', 0.5, [103, 108], true, 3, 103),
    story(10, 5, 'Europe — fire smoke', 0.2, [109], false, 3, 109),
    story(11, 5, 'Europe — fire insurance', null, [110], false, 3, null),
    story(12, 6, 'Gaza — talks in Cairo', 0.5, [101, 5], true, 1, 101),
    story(13, 7, 'Gaza — hostage deal', 0.6, [101, 106], true, 1, 101),
    story(14, 7, 'Iran — new sanctions', 0.9, [102, 111], true, 2, 102),
    story(15, 8, 'Gaza — ceasefire holds', 0.4, [101, 112, 112], true, 1, 101),
    story(16, 8, 'Fed holds rates', 0.7, [105], true, 5, 105),
    story(17, 8, 'Fed — dissent', 0.6, [105, 6], true, 5, 105),
    story(18, 'orphan', 'Orphan story', 0.9, [7], true, 1, 101),
    // 未发布的期里的故事：不出现在线索 1 的条目里，也不让簇 5 凑够两期
    story(19, 9, 'Gaza — debug rerun', 0.8, [101], true, 1, 101),
    story(20, 9, 'Fed — debug rerun', 0.8, [105], true, 5, 105),
    story(21, 3, 'Nepal — glacier collapse floods valley', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(22, 4, 'Nepal — death toll passes 500', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(23, 5, 'Nepal — rescuers reach hydropower tunnel', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(24, 6, 'Nepal — rescue of trapped workers', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(25, 7, 'Nepal — survivors found after ten days', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(26, 8, 'Nepal', 0.5, [104], true, 6, 104, twoDim(1, 0)),
    story(27, 8, 'Avalanche kills two climbers', 0.9, [102], true, 6, 102, twoDim(0, 1)),
  ];
  // 聚类时的簇号（brief-v3 记录的块按它对回故事），只有 wf-r8 的几条用得到
  const clusterIds: Record<number, number> = { 15: 0, 16: 1, 17: 2, 26: 3, 27: 4 };
  for (const s of briefStories) s.cluster_id = clusterIds[s.id as number] ?? null;

  // 简报块：期号 → 这期写出来的块（按正文顺序）。标题与正文同该期 reports.content 里的那一块
  const block = (storyId: number, tier: BriefTier, title: string, body: string) => ({ storyId, tier, title, body });
  const briefBlocks: Record<number, Omit<BriefBlockDraft, 'position'>[]> = {
    6: [block(12, 'lead', 'gaza talks in cairo', 'Talks resumed.')],
    7: [block(13, 'lead', 'hostage deal', 'A deal was reached.'), block(14, 'lead', 'iran sanctions', 'New sanctions were announced.')],
    8: [
      block(15, 'lead', 'gaza ceasefire holds', 'The ceasefire held for a third day.\n\nAid deliveries rose.'),
      block(16, 'more', 'fed holds rates', 'The Fed held rates at 4.25%.'),
    ],
    9: [block(19, 'lead', 'ukraine debug', 'A manual debug run.')],
  };

  return { sources, articles, reports, briefRuns, clusters, briefStories, briefBlocks };
}

/** 清空相关表并灌入 fixture（只许对本机测试库调用，调用方负责检查连接串） */
export async function seedReaderFixture(db: Db, anchor: Date) {
  const f = buildReaderFixture(anchor);
  await db.execute(sql`truncate reports, brief_runs, brief_stories, story_clusters, articles, sources restart identity cascade`);
  await db.insert($sources).values(f.sources);
  await db.insert($articles).values(f.articles);
  await db.insert($reports).values(f.reports);
  await db.insert($brief_runs).values(f.briefRuns);
  await db.insert($story_clusters).values(f.clusters);
  await db.insert($brief_stories).values(f.briefStories);
  for (const [reportId, blocks] of Object.entries(f.briefBlocks)) {
    await writeBriefBlocks(db, Number(reportId), blocks.map((b, position) => ({ ...b, position })));
  }
  // 上面按固定 id 插入不会推进自增序列；不同步的话，之后别的测试（同一个库、同一个 worker）
  // 不带 id 插入会从 1 开始撞主键。
  for (const table of ['sources', 'articles', 'reports', 'story_clusters', 'brief_stories', 'brief_runs', 'brief_blocks']) {
    await db.execute(
      sql`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${sql.identifier(table)}), 0) + 1, false)`
    );
  }
}

/** 写出来的块：地图只读 clusterId / title / tier，其余字段填零 */
export function writtenBlock(clusterId: number | null, title: string, tier: BriefTier): BriefV3WrittenBlock {
  return {
    clusterId, storyIdx: 0, title, v6Title: title, tier, articles: 0, tierArticles: 0, sources: 0, score: 0, ok: true,
    text: '', sentences: [], anchors: 0, windows: 0, windowFailures: 0, citationsRepaired: 0, writeRejects: [], llmCalls: 0, neurons: 0,
  };
}

/** 把一期的 brief-v3 记录放进测试环境的 ARTICLES_BUCKET（本地模拟桶），key 与生产同一个 briefV3RecordKey */
export async function putBriefV3Record(bucket: R2Bucket, workflowId: string, blocks: BriefV3Record['blocks']) {
  const record: BriefV3Record = { workflowId, createdAt: '2026-01-01T00:00:00.000Z', title: workflowId, sections: 0, blocks };
  await bucket.put(briefV3RecordKey(workflowId), JSON.stringify(record));
}

/** 第 8 期（最新一期）的 brief-v3 记录：两块与正文一致（lead 是簇 0 = story 15，more 是簇 1 = story 16），外加一个没写出来的块 */
export async function putBrief8Record(bucket: R2Bucket) {
  await putBriefV3Record(bucket, 'wf-r8', [
    writtenBlock(0, 'gaza ceasefire holds', 'lead'),
    writtenBlock(1, 'fed holds rates', 'more'),
    { storyIdx: 2, title: 'fed dissent', ok: false, error: 'write failed' },
  ]);
}

/** 数据库的「今天」，作为 fixture 与快照日期记号的锚点 */
export async function dbToday(db: Db): Promise<string> {
  const [row] = (await db.execute(sql`select current_date::text as today`)) as unknown as { today: string }[];
  return row.today;
}
