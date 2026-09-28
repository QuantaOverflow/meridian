/**
 * 事件追踪的线索归并（src/lib/story-clusters.ts）：哪些期参与归并、回看窗口怎么算。
 * 走本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」），不 mock。
 *
 * 文章 embedding 用单位向量：同一个轴上的故事相似度 1，不同轴上的相似度 0，
 * 所以「并入 / 新建」只由被测的窗口规则决定，不受阈值附近的数值影响。
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { $articles, $brief_runs, $brief_stories, $reports, $sources, $story_clusters, eq, sql } from '@meridian/database';
import { EMBEDDING_DIM } from '@meridian/contracts';
import { getDb } from '../../src/lib/database';
import { assignStoryClustersForWorkflow } from '../../src/lib/story-clusters';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date('2026-01-01T12:00:00Z').getTime();
const day = (n: number) => new Date(BASE + n * DAY);
const axis = (k: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === k ? 1 : 0));

let nextArticle = 1;
let nextReport = 1;

beforeEach(async () => {
  await db.execute(sql`truncate reports, brief_runs, brief_stories, story_clusters, articles, sources restart identity cascade`);
  await db.insert($sources).values({ id: 1, url: 'https://feeds.example.com/clusters.xml', name: 'Cluster Test', category: 'news' });
  nextArticle = 1;
  nextReport = 1;
});

/** 一期简报：一条 run、一份 report、若干入选故事（每个故事一篇文章，落在给定的轴上） */
async function brief(wf: string, at: Date, published: boolean, storyAxes: number[]) {
  const reportId = nextReport++;
  await db.insert($reports).values({
    id: reportId,
    title: wf,
    content: 'body',
    usedArticles: storyAxes.length,
    usedSources: 1,
    createdAt: at,
    published_at: published ? at : null,
  });
  await db.insert($brief_runs).values({ workflow_id: wf, status: 'COMPLETED', started_at: at, report_id: reportId });
  const storyIds: number[] = [];
  for (const k of storyAxes) {
    const articleId = nextArticle++;
    await db.insert($articles).values({
      id: articleId,
      title: `${wf} article ${articleId}`,
      url: `https://example.com/${wf}/${articleId}`,
      sourceId: 1,
      embedding: axis(k),
    });
    const [row] = await db
      .insert($brief_stories)
      .values({ workflow_id: wf, title: `${wf} axis ${k}`, article_ids: [articleId], selected_for_intel: true, created_at: at })
      .returning({ id: $brief_stories.id });
    storyIds.push(row.id);
  }
  return storyIds;
}

async function clusterOf(storyId: number) {
  const [row] = await db
    .select({ cluster: $brief_stories.story_cluster_id })
    .from($brief_stories)
    .where(eq($brief_stories.id, storyId));
  return row.cluster;
}

describe('assignStoryClustersForWorkflow', () => {
  it('未发布的期（手动触发的调试期）不参与归并：不建线索、不并入、不动已有线索', async () => {
    const [published] = await brief('wf-cron', day(0), true, [1]);
    await assignStoryClustersForWorkflow(db, 'wf-cron');
    const cluster = await clusterOf(published);
    expect(cluster).not.toBeNull();
    const [before] = await db.select().from($story_clusters).where(eq($story_clusters.id, cluster!));

    const [sameEvent, newEvent] = await brief('wf-manual', day(1), false, [1, 2]);
    const stats = await assignStoryClustersForWorkflow(db, 'wf-manual');

    expect(stats).toEqual({ briefed: 0, joined: 0, created: 0, attachedCandidates: 0 });
    expect(await clusterOf(sameEvent)).toBeNull();
    expect(await clusterOf(newEvent)).toBeNull();
    expect(await db.select().from($story_clusters)).toEqual([before]);
  });

  it('回看按已发布的期数算，不按日历天：停跑 40 天、中间只有未发布的期，同一件事仍接回原线索', async () => {
    const [first] = await brief('wf-before-pause', day(0), true, [3]);
    await assignStoryClustersForWorkflow(db, 'wf-before-pause');
    // 停跑期间只有手动调试期，它们不算进回看的期数
    for (let i = 1; i <= 20; i++) await brief(`wf-debug-${i}`, day(i), false, [4]);

    const [after] = await brief('wf-after-pause', day(40), true, [3]);
    const stats = await assignStoryClustersForWorkflow(db, 'wf-after-pause');

    expect(stats.joined).toBe(1);
    expect(await clusterOf(after)).toBe(await clusterOf(first));
  });

  it('最近 N 期都没出现过的线索不再吸收新故事', async () => {
    const [first] = await brief('wf-1', day(0), true, [5]);
    await assignStoryClustersForWorkflow(db, 'wf-1', { lookbackBriefs: 2 });
    await brief('wf-2', day(1), true, [6]);
    await assignStoryClustersForWorkflow(db, 'wf-2', { lookbackBriefs: 2 });
    await brief('wf-3', day(2), true, [6]);
    await assignStoryClustersForWorkflow(db, 'wf-3', { lookbackBriefs: 2 });

    // 第 4 期回看 2 期 = 第 3、4 期；轴 5 的线索最后出现在第 1 期，已在窗口外
    const [late] = await brief('wf-4', day(3), true, [5]);
    const stats = await assignStoryClustersForWorkflow(db, 'wf-4', { lookbackBriefs: 2 });

    expect(stats.created).toBe(1);
    expect(await clusterOf(late)).not.toBe(await clusterOf(first));
  });
});
