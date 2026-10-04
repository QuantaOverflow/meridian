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
import { runWindowWhere } from '../core/run-corpus';
import { isPublished } from './briefs';
import type { Db } from './db';
import { normalizePlace } from './places';
import { threadStatsByIds } from './story-threads';
import { articleTopics, assignTopics, normalizeTags } from './topics';

/**
 * 地图首页的数据（响应形状见 @meridian/contracts 的 BriefMap）。对外只是「期号 → 地图数据」；
 * 正文块 ↔ 故事对应、地点归一化、主题分配、线索关联、当期窗口统计都在这里，调用方看不见。
 * 只读已有数据（文章地点与主题标签、线索、brief-v3 记录），不调模型。
 */
const logger = new Logger({ module: 'reader-brief-map' });

const DAY_MS = 24 * 60 * 60 * 1000;

/** article_ids 是 jsonb，历史行里可能是 null、非数组或有重复：只取去重后的整数 id */
function memberIds(articleIds: unknown): number[] {
  if (!Array.isArray(articleIds)) return [];
  return [...new Set(articleIds.filter((id): id is number => Number.isInteger(id)))];
}

/** 归一表里没有的原值（含空值）→ 篇数，一次请求记一条日志，看到再补表（places.ts） */
type UnmappedLog = Map<string, number>;

function noteUnmapped(log: UnmappedLog, raw: string | null) {
  const key = raw ?? '';
  log.set(key, (log.get(key) ?? 0) + 1);
}

/** 成员按国家的占比，分母是全部成员（只写了地区、空值、表里没有的成员不进分子）；降序，同占比按代码 */
function placesOf(members: number[], locationOf: Map<number, string | null>, unmapped: UnmappedLog): BriefMapEvent['places'] {
  const counts = new Map<string, number>();
  for (const id of members) {
    const raw = locationOf.get(id) ?? null;
    const place = normalizePlace(raw);
    if (place.kind === 'country') counts.set(place.country, (counts.get(place.country) ?? 0) + 1);
    else if (place.kind === 'unmapped') noteUnmapped(unmapped, raw);
  }
  return [...counts]
    .map(([country, n]) => ({ country, share: Math.round((n / members.length) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share || a.country.localeCompare(b.country));
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
 * 正文里的故事：brief-v3 记录里写出来的块按顺序，按 clusterId 对回同一 run 的 brief_stories。
 * 不靠标题对：正文标题是 v6 写作层起的，可以和聚类阶段的 brief_stories.title 不同。
 * 记录缺失或块对不上故事都记 error 日志（记录的字段布局由生成链路决定，那边改了这里要能在日志里看到）。
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
  const obj = await bucket.get(briefV3RecordKey(workflowId));
  if (obj === null) {
    logger.error('地图：这期没有 brief-v3 记录，事件为空', { report_id: reportId, workflow_id: workflowId });
    return { events, members };
  }
  const record = (await obj.json()) as BriefV3Record;
  const stories = await db
    .select({
      id: $brief_stories.id,
      clusterId: $brief_stories.cluster_id,
      articleIds: $brief_stories.article_ids,
      threadId: $brief_stories.story_cluster_id,
    })
    .from($brief_stories)
    .where(eq($brief_stories.workflow_id, workflowId));
  const allMembers = [...new Set(stories.flatMap(s => memberIds(s.articleIds)))];
  const threadIds = [...new Set(stories.flatMap(s => (s.threadId === null ? [] : [s.threadId])))];
  // 两条查询互不依赖，并行发省一趟往返
  const [memberRows, threads] = await Promise.all([
    allMembers.length === 0
      ? []
      : db
          .select({ id: $articles.id, location: $articles.primary_location, tags: $articles.topic_tags })
          .from($articles)
          .where(inArray($articles.id, allMembers)),
    threadStatsByIds(db, threadIds),
  ]);
  const locationOf = new Map(memberRows.map(a => [a.id, a.location]));
  const tagsOf = new Map(memberRows.map(a => [a.id, normalizeTags(a.tags)]));
  const byCluster = new Map(stories.filter(s => s.clusterId !== null).map(s => [s.clusterId as number, s]));

  // blockIndex = 在写出来的块里的位置（= 正文里的位置，阅读页锚点 story-{n+1}），对不上故事的块也占位
  const written = record.blocks.filter(b => b.ok);
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
      places: placesOf(ids, locationOf, unmapped),
      topics: topicsOf(ids, tagsOf),
      thread: stats === undefined ? null : { id: story.threadId as number, ...stats },
    });
  });
  return { events, members };
}

/**
 * 当期窗口的文章：run 开始时刻往回 params.timeRangeDays 天（没记就是 cron 默认值），条件与 run 取数同一个 runWindowWhere。
 * 事后重查，不保证等于当时的实际输入（之后补算了 embedding、文章状态变了都会让它不同；也不按 articleLimit 截断）。
 * 按发布时间新的在前，同时刻按 id。
 */
async function loadWindowArticles(db: Db, startedAt: Date, params: unknown) {
  const days = (params as { timeRangeDays?: unknown } | null)?.timeRangeDays;
  const timeRangeDays = typeof days === 'number' && days > 0 ? days : CRON_BRIEF_PARAMS.TIME_RANGE_DAYS;
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
    // limit 只给 run 取数截断用，不进 WHERE
    .where(runWindowWhere({ articleIds: [], dateFrom: new Date(startedAt.getTime() - timeRangeDays * DAY_MS), dateTo: startedAt, limit: 0 }, 'present'))
    .orderBy(desc($articles.publishDate), $articles.id);
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
      noteUnmapped(unmapped, a.location);
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
      unmapped_locations: Object.fromEntries(unmapped),
    });
  }
  return { brief, events, coverage };
}
