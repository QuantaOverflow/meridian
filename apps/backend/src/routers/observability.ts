import { Hono } from 'hono';
import type { Env } from '../index';
import { getDb } from '../lib/database';
import { $reports, $brief_runs, $brief_stories, $articles, eq, desc, gte, sql } from '@meridian/database';
import { clusteringSnapshotKey, LLM_CALLS_ROOT, llmCallsPrefix, workflowObservabilityKey } from '@meridian/contracts';
import { Logger } from '../lib/core/logger';

const logger = new Logger({ router: 'observability' });

const app = new Hono<{ Bindings: Env }>();

// ========== 新观测性聚合查询（Phase 3） ==========

/**
 * 一次拉到 brief workflow 的完整链路：brief_runs + stories + 可观测性快照（brief_runs.report_id 指向报告）
 */
app.get('/runs/:workflowId', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const db = getDb(c.env.HYPERDRIVE);

    const runs = await db
      .select()
      .from($brief_runs)
      .where(eq($brief_runs.workflow_id, workflowId))
      .limit(1);

    if (runs.length === 0) {
      return c.json({ success: false, error: 'workflow not found' }, 404);
    }
    const run = runs[0];

    const stories = await db
      .select()
      .from($brief_stories)
      .where(eq($brief_stories.workflow_id, workflowId))
      .orderBy(desc($brief_stories.importance));

    // R2 可观测性快照（Phase 1 起以稳定 key 存储）
    let observabilitySnapshot: any = null;
    try {
      const obj = await c.env.ARTICLES_BUCKET.get(workflowObservabilityKey(workflowId));
      if (obj) observabilitySnapshot = JSON.parse(await obj.text());
    } catch (e) {
      // 静默：观测性数据缺失不影响其他链路
    }

    return c.json({
      success: true,
      run,
      stories,
      observability: observabilitySnapshot,
    });
  } catch (error) {
    logger.error('/observability/runs/:workflowId 失败:', undefined, error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 取某次 run 的 cluster_id → article_ids 映射（聚类步骤落的 R2 快照）。
 * story-validation eval 用它按 cluster_id 取回被拒簇的文章做二审。
 */
app.get('/runs/:workflowId/clustering', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const obj = await c.env.ARTICLES_BUCKET.get(clusteringSnapshotKey(workflowId));
    if (!obj) {
      return c.json({ success: false, error: 'clustering snapshot not found' }, 404);
    }
    return new Response(obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('/observability/runs/:workflowId/clustering 失败:', undefined, error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

/**
 * 业务质量趋势：按天聚合最近 N 天的 brief_runs / brief_stories 指标
 */
app.get('/trends', async (c) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(c.req.query('days') || '14', 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const db = getDb(c.env.HYPERDRIVE);

    // 按天聚合 run 级指标
    const runTrends = await db
      .select({
        day: sql<string>`date_trunc('day', ${$brief_runs.started_at})::date::text`,
        total_runs: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'COMPLETED')::int`,
        failed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'FAILED')::int`,
        terminated: sql<number>`count(*) filter (where ${$brief_runs.status} = 'TERMINATED_NO_STORIES')::int`,
        avg_articles: sql<number>`avg(${$brief_runs.total_articles})::real`,
        avg_clusters: sql<number>`avg(${$brief_runs.clusters_found})::real`,
        avg_stories: sql<number>`avg(${$brief_runs.stories_identified})::real`,
        avg_brief_len: sql<number>`avg(${$brief_runs.brief_content_length})::real`,
      })
      .from($brief_runs)
      .where(gte($brief_runs.started_at, since))
      .groupBy(sql`date_trunc('day', ${$brief_runs.started_at})`)
      .orderBy(sql`date_trunc('day', ${$brief_runs.started_at}) desc`);

    // story-level 指标：平均 importance、validation rate
    const storyTrends = await db
      .select({
        day: sql<string>`date_trunc('day', ${$brief_runs.started_at})::date::text`,
        avg_importance: sql<number>`avg(${$brief_stories.importance})::real`,
        total_stories: sql<number>`count(${$brief_stories.id})::int`,
      })
      .from($brief_stories)
      .innerJoin($brief_runs, eq($brief_stories.workflow_id, $brief_runs.workflow_id))
      .where(gte($brief_runs.started_at, since))
      .groupBy(sql`date_trunc('day', ${$brief_runs.started_at})`)
      .orderBy(sql`date_trunc('day', ${$brief_runs.started_at}) desc`);

    return c.json({
      success: true,
      days,
      runTrends,
      storyTrends,
    });
  } catch (error) {
    logger.error('/observability/trends 失败:', undefined, error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 健康度一眼可见：当日运行状态 + 文章数 + 最后成功 brief 时间
 */
app.get('/health/summary', async (c) => {
  try {
    const db = getDb(c.env.HYPERDRIVE);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [runStats, lastBrief, articleStats, recentRuns] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'COMPLETED')::int`,
          failed: sql<number>`count(*) filter (where ${$brief_runs.status} = 'FAILED')::int`,
          terminated: sql<number>`count(*) filter (where ${$brief_runs.status} = 'TERMINATED_NO_STORIES')::int`,
          running: sql<number>`count(*) filter (where ${$brief_runs.status} = 'RUNNING')::int`,
        })
        .from($brief_runs)
        .where(gte($brief_runs.started_at, last24h)),
      db
        .select({
          id: $reports.id,
          title: $reports.title,
          createdAt: $reports.createdAt,
        })
        .from($reports)
        .orderBy(desc($reports.createdAt))
        .limit(1),
      db
        .select({
          status: $articles.status,
          count: sql<number>`count(*)::int`,
        })
        .from($articles)
        .where(gte($articles.createdAt, last24h))
        .groupBy($articles.status),
      db
        .select({
          workflow_id: $brief_runs.workflow_id,
          status: $brief_runs.status,
          started_at: $brief_runs.started_at,
          finished_at: $brief_runs.finished_at,
          stories_identified: $brief_runs.stories_identified,
          error: $brief_runs.error,
        })
        .from($brief_runs)
        .orderBy(desc($brief_runs.started_at))
        .limit(10),
    ]);

    const lastBriefAgeHours = lastBrief[0]?.createdAt
      ? (Date.now() - lastBrief[0].createdAt.getTime()) / 3600000
      : null;

    return c.json({
      success: true,
      generated_at: new Date().toISOString(),
      runs_24h: runStats[0] ?? { total: 0, completed: 0, failed: 0, terminated: 0, running: 0 },
      last_brief: lastBrief[0]
        ? {
            id: lastBrief[0].id,
            title: lastBrief[0].title,
            created_at: lastBrief[0].createdAt,
            age_hours: lastBriefAgeHours != null ? Number(lastBriefAgeHours.toFixed(2)) : null,
          }
        : null,
      articles_24h_by_status: articleStats.reduce<Record<string, number>>((acc, row) => {
        if (row.status) acc[row.status] = row.count;
        return acc;
      }, {}),
      recent_runs: recentRuns.map((r) => ({
        workflow_id: r.workflow_id,
        status: r.status,
        started_at: r.started_at,
        duration_sec:
          r.finished_at && r.started_at
            ? Math.round((r.finished_at.getTime() - r.started_at.getTime()) / 1000)
            : null,
        stories_identified: r.stories_identified,
        error: r.error,
      })),
    });
  } catch (error) {
    logger.error('/observability/health/summary 失败:', undefined, error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 列出某次 workflow 全部 LLM 调用（每条 raw input + raw output 存在 R2 llm-calls/{workflow_id}/*.json）
 * 不内联文件内容（可能很大），只返回 key + uploaded + size + 简要 metadata
 */
app.get('/runs/:workflowId/llm-calls', async (c) => {
  try {
    const workflowId = c.req.param('workflowId');
    const list = await c.env.ARTICLES_BUCKET.list({ prefix: llmCallsPrefix(workflowId) });

    // 拉每个对象的简要 metadata（解析 R2 头）。如果想看全文走 /llm-calls/:key
    const calls = await Promise.all(
      list.objects.map(async (obj) => {
        try {
          const o = await c.env.ARTICLES_BUCKET.get(obj.key);
          if (!o) return null;
          const data: any = JSON.parse(await o.text());
          return {
            key: obj.key,
            uploaded: obj.uploaded,
            size: obj.size,
            phase: data.phase,
            call_index: data.call_index,
            provider: data.request?.provider,
            model: data.request?.model,
            tokens: data.response?.usage,
            latency_ms: data.latency_ms,
            error: data.error || null,
          };
        } catch {
          return { key: obj.key, uploaded: obj.uploaded, size: obj.size, error: 'parse_failed' };
        }
      })
    );

    return c.json({ success: true, total: list.objects.length, calls: calls.filter(Boolean) });
  } catch (error) {
    logger.error('/observability/runs/:workflowId/llm-calls 失败:', undefined, error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * 拿单条 LLM 调用的完整 raw input/output JSON（直接从 R2 流式返回）
 */
app.get('/llm-calls/*', async (c) => {
  try {
    const fullPath = c.req.path; // 形如 /observability/llm-calls/llm-calls/xxx/yyy.json
    const idx = fullPath.indexOf('/llm-calls/') + '/llm-calls/'.length;
    const key = decodeURIComponent(fullPath.slice(idx));
    if (!key.startsWith(LLM_CALLS_ROOT)) {
      return c.json({ success: false, error: 'invalid key' }, 400);
    }
    const obj = await c.env.ARTICLES_BUCKET.get(key);
    if (!obj) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    return new Response(obj.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('/observability/llm-calls/* 失败:', undefined, error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
