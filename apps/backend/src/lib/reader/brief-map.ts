import {
  briefV3RecordKey,
  type BriefMap,
  type BriefMapCountryCoverage,
  type BriefMapEvent,
  type BriefV3Record,
  type MapTopic,
} from '@meridian/contracts';
import { $articles, $brief_runs, $brief_stories, $reports, $sources, and, desc, eq, inArray } from '@meridian/database';
import { CRON_BRIEF_PARAMS } from '../core/constants';
import { Logger } from '../core/logger';
import { runWindowWhere, type RunWindow } from '../core/run-corpus';
import type { BriefGenerationParams } from '../../workflows/auto-brief-generation';
import { isPublished } from './briefs';
import type { Db } from './db';
import { normalizePlace } from './places';
import { entityNames, memberIds, mentionsOf, placesOf } from './story-countries';
import { threadStatsByIds } from './story-threads';
import { articleTopics, assignTopics, normalizeTags } from './topics';

/**
 * 地图首页的数据（响应形状见 @meridian/contracts 的 BriefMap）。对外只是「期号 → 地图数据」；
 * 正文块 ↔ 故事对应、地点归一化、主题分配、线索关联、当期窗口统计都在这里，调用方看不见。
 * 只读已有数据（文章地点与主题标签、线索、brief-v3 记录），不调模型。
 */
const logger = new Logger({ module: 'reader-brief-map' });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 归一表里没有的地点值（含空值）：文章 id → 原值。按 id 记，同一篇既是故事成员又在当期窗口里也只算一次；
 * 一次请求记一条日志（unmappedSummary），看到再补表（places.ts）
 */
type UnmappedLog = Map<number, string>;

function noteUnmapped(log: UnmappedLog, articleId: number, raw: string | null) {
  log.set(articleId, raw ?? '');
}

/** 日志要扁平（.claude/rules/workers.md §3）：编码成一个字符串 `原值=篇数|…`，篇数多的在前，最多 20 个 */
function unmappedSummary(log: UnmappedLog): string {
  const counts = new Map<string, number>();
  for (const raw of log.values()) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 20)
    .map(([raw, n]) => `${raw}=${n}`)
    .join('|');
}

/** 故事的主题：按成员逐个标签计数后交给 assignTopics */
function topicsOf(members: number[], tagsOf: Map<number, Set<string>>): BriefMapEvent['topics'] {
  const tagCounts = new Map<string, number>();
  for (const id of members) {
    for (const tag of tagsOf.get(id) ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  return assignTopics(tagCounts, members.length);
}

/**
 * 读这期的 brief-v3 记录。没有、读取或解析失败、形状不对（blocks 不是数组）都记 error 日志并返回 null，
 * 调用方一律按「没有记录」处理：事件为空，当期统计照算。
 */
async function readRecord(bucket: R2Bucket, reportId: number, workflowId: string): Promise<BriefV3Record | null> {
  const context = { report_id: reportId, workflow_id: workflowId };
  let record: unknown;
  try {
    const obj = await bucket.get(briefV3RecordKey(workflowId));
    if (obj === null) {
      logger.error('地图：这期没有 brief-v3 记录，事件为空', context);
      return null;
    }
    record = await obj.json();
  } catch (error) {
    logger.error('地图：brief-v3 记录读取或解析失败，事件为空', context, error);
    return null;
  }
  if (!Array.isArray((record as { blocks?: unknown } | null)?.blocks)) {
    logger.error('地图：brief-v3 记录形状不对（blocks 不是数组），事件为空', context);
    return null;
  }
  return record as BriefV3Record;
}

/**
 * 正文里的故事：brief-v3 记录里写出来的块按顺序，按 clusterId 对回同一 run 的 brief_stories。
 * 不靠标题对：正文标题是 v6 写作层起的，可以和聚类阶段的 brief_stories.title 不同。
 * 记录有问题或块对不上故事都记 error 日志（记录的字段布局由生成链路决定，那边改了这里要能在日志里看到）。
 */
async function loadEvents(
  db: Db,
  bucket: R2Bucket,
  reportId: number,
  workflowId: string,
  unmapped: UnmappedLog
): Promise<{ events: BriefMapEvent[]; members: Set<number> }> {
  const events: BriefMapEvent[] = [];
  const members = new Set<number>();
  // R2 与数据库互不依赖，并行发：到 Neon 一趟就要几百毫秒
  const [record, stories] = await Promise.all([
    readRecord(bucket, reportId, workflowId),
    db
      .select({
        id: $brief_stories.id,
        clusterId: $brief_stories.cluster_id,
        articleIds: $brief_stories.article_ids,
        threadId: $brief_stories.story_cluster_id,
      })
      .from($brief_stories)
      .where(eq($brief_stories.workflow_id, workflowId)),
  ]);
  if (record === null) return { events, members };
  const allMembers = [...new Set(stories.flatMap(s => memberIds(s.articleIds)))];
  const threadIds = [...new Set(stories.flatMap(s => (s.threadId === null ? [] : [s.threadId])))];
  // 两条查询互不依赖，并行发省一趟往返
  const [memberRows, threads] = await Promise.all([
    allMembers.length === 0
      ? []
      : db
          .select({ id: $articles.id, location: $articles.primary_location, tags: $articles.topic_tags, entities: $articles.key_entities })
          .from($articles)
          .where(inArray($articles.id, allMembers)),
    threadStatsByIds(db, threadIds),
  ]);
  const locationOf = new Map(memberRows.map(a => [a.id, a.location]));
  const tagsOf = new Map(memberRows.map(a => [a.id, normalizeTags(a.tags)]));
  const entitiesOf = new Map(memberRows.map(a => [a.id, entityNames(a.entities)]));
  const byCluster = new Map(stories.filter(s => s.clusterId !== null).map(s => [s.clusterId as number, s]));

  // blockIndex = 在写出来的块里的位置（= 正文里的位置，阅读页锚点 story-{n+1}），对不上故事的块也占位
  const written = record.blocks.filter(b => b?.ok === true);
  written.forEach((block, blockIndex) => {
    const story = block.clusterId === null ? undefined : byCluster.get(block.clusterId);
    if (story === undefined) {
      logger.error('地图：正文块对不上故事，已丢掉', {
        report_id: reportId,
        workflow_id: workflowId,
        block_index: blockIndex,
        cluster_id: block.clusterId,
      });
      return;
    }
    const ids = memberIds(story.articleIds);
    for (const id of ids) members.add(id);
    // 没过线索门槛（只出现在一期）的不在 threads 里，给 null，与线索列表页一致
    const stats = story.threadId === null ? undefined : threads.get(story.threadId);
    events.push({
      storyId: story.id,
      blockIndex,
      tier: block.tier,
      title: block.title,
      articleCount: ids.length,
      places: placesOf(ids, locationOf, (id, raw) => noteUnmapped(unmapped, id, raw)),
      mentions: mentionsOf(ids, locationOf, entitiesOf),
      topics: topicsOf(ids, tagsOf),
      thread: stats === undefined ? null : { id: story.threadId as number, briefCount: stats.briefCount, durationDays: stats.durationDays },
    });
  });
  return { events, members };
}

/**
 * 按 brief_runs.params（= workflow 的 event.payload）重建这期 run 的 RunWindow。照抄 workflow 的做法，改那边要同步改这里：
 * apps/backend/src/workflows/auto-brief-generation.ts 的 `run()` 开头解构 payload（article_ids 默认 []，
 * articleLimit / timeRangeDays 没传时回落到 CRON_BRIEF_PARAMS）与「本期候选文章的窗口」那段 runWindow。
 * 唯一的不同：runWindowWhere 按 timeRangeDays 往回推时用的是 Date.now()（= run 当时），事后重查要换成 run 开始时刻，
 * 所以只走时间窗的 run 改成等价的 dateFrom / dateTo（上界取开始时刻：run 当时也看不到之后发布的文章）。
 */
function runWindowOf(startedAt: Date, params: unknown): RunWindow {
  const {
    article_ids = [],
    dateFrom,
    dateTo,
    articleLimit = CRON_BRIEF_PARAMS.ARTICLE_LIMIT,
    timeRangeDays = CRON_BRIEF_PARAMS.TIME_RANGE_DAYS,
  } = (params ?? {}) as BriefGenerationParams;
  const articleIds = Array.isArray(article_ids) ? article_ids : [];
  if (articleIds.length === 0 && !dateFrom && !dateTo && timeRangeDays && timeRangeDays > 0) {
    return { articleIds, dateFrom: new Date(startedAt.getTime() - timeRangeDays * DAY_MS), dateTo: startedAt, limit: articleLimit };
  }
  // 显式文章 id 或日期区间：runWindowWhere 不碰 Date.now()，原样传
  return { articleIds, dateFrom, dateTo, timeRangeDays, limit: articleLimit };
}

/**
 * 当期窗口的文章：条件与 run 取数同一个 runWindowWhere，同样按发布时间倒序取前 limit 篇（同时刻再按 id，结果稳定）。
 * 事后重查，不保证等于当时的实际输入（之后补算了 embedding、文章状态变了都会让它不同）。
 */
async function loadWindowArticles(db: Db, startedAt: Date, params: unknown) {
  const window = runWindowOf(startedAt, params);
  return db
    .select({
      id: $articles.id,
      title: $articles.title,
      url: $articles.url,
      location: $articles.primary_location,
      tags: $articles.topic_tags,
      source: $sources.name,
    })
    .from($articles)
    .innerJoin($sources, eq($articles.sourceId, $sources.id))
    .where(runWindowWhere(window, 'present'))
    .orderBy(desc($articles.publishDate), $articles.id)
    .limit(window.limit);
}

/** 按国家计数；没进任何正文故事的文章进 others，并按篇计主题（一篇可计入多个主题），取前 3 */
function buildCoverage(
  articles: Awaited<ReturnType<typeof loadWindowArticles>>,
  eventMembers: Set<number>,
  unmapped: UnmappedLog
): BriefMap['coverage'] {
  let regional = 0;
  let unmappedCount = 0;
  const byCountry = new Map<string, BriefMapCountryCoverage & { topicCounts: Map<MapTopic, number> }>();
  for (const a of articles) {
    const place = normalizePlace(a.location);
    if (place.kind === 'regional') {
      regional++;
      continue;
    }
    if (place.kind === 'unmapped') {
      unmappedCount++;
      noteUnmapped(unmapped, a.id, a.location);
      continue;
    }
    let entry = byCountry.get(place.country);
    if (entry === undefined) {
      entry = { country: place.country, count: 0, others: [], otherTopics: [], topicCounts: new Map() };
      byCountry.set(place.country, entry);
    }
    entry.count++;
    if (eventMembers.has(a.id)) continue;
    entry.others.push({ title: a.title, url: a.url, source: a.source });
    for (const topic of articleTopics(normalizeTags(a.tags))) entry.topicCounts.set(topic, (entry.topicCounts.get(topic) ?? 0) + 1);
  }
  return {
    total: articles.length,
    regional,
    unmapped: unmappedCount,
    byCountry: [...byCountry.values()]
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
      .map(({ topicCounts, ...entry }) => ({
        ...entry,
        otherTopics: [...topicCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3),
      })),
  };
}

/** 一期的地图数据；期不存在或未发布时为 null（与单期页同一可见性） */
export async function loadBriefMap(db: Db, bucket: R2Bucket, id: number): Promise<BriefMap | null> {
  const [row] = await db
    .select({
      id: $reports.id,
      createdAt: $reports.createdAt,
      workflowId: $brief_runs.workflow_id,
      startedAt: $brief_runs.started_at,
      params: $brief_runs.params,
    })
    .from($reports)
    .leftJoin($brief_runs, eq($brief_runs.report_id, $reports.id))
    .where(and(eq($reports.id, id), isPublished))
    .orderBy(desc($brief_runs.started_at))
    .limit(1);
  if (row === undefined) return null;

  const brief = { id: row.id, createdAt: row.createdAt.toISOString() };
  if (row.workflowId === null || row.startedAt === null) {
    logger.error('地图：这期没有 run，事件为空、当期统计全零', { report_id: row.id });
    return { brief, events: [], coverage: { total: 0, regional: 0, unmapped: 0, byCountry: [] } };
  }

  const unmapped: UnmappedLog = new Map();
  // 正文故事与当期窗口互不依赖，并行查
  const [{ events, members }, articles] = await Promise.all([
    loadEvents(db, bucket, row.id, row.workflowId, unmapped),
    loadWindowArticles(db, row.startedAt, row.params),
  ]);
  const coverage = buildCoverage(articles, members, unmapped);
  if (unmapped.size > 0) {
    logger.warn('地图：地点值不在归一表里（含空值），已计入 unmapped', {
      report_id: row.id,
      workflow_id: row.workflowId,
      unmapped_locations: unmappedSummary(unmapped),
    });
  }
  return { brief, events, coverage };
}
