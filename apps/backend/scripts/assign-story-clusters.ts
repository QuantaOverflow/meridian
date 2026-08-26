#!/usr/bin/env node
/**
 * 把历史 brief_stories 归并成跨期线索（story_clusters）。
 *
 * 归并逻辑不在这里，在 apps/backend/src/lib/story-clusters.ts —— 生产工作流跑的是同一份实现，
 * 两边共用一套判据，不会漂移。这个脚本只负责按时间顺序把历史 workflow 喂进去。
 *
 * 不调 LLM，只用库里已有的文章 embedding，可以放心反复跑。
 *
 * 用法（在仓库根目录）：
 *   DATABASE_URL=... pnpm -C packages/database exec tsx ../../apps/backend/scripts/assign-story-clusters.ts
 *   ... --reset                 先清空所有线索再重跑（改阈值后用）
 *   ... --threshold 0.96        覆盖相似度阈值
 *   ... --lookback 21           覆盖回看天数
 */

import { getDb, sql } from '@meridian/database';
import {
  assignStoryClustersForWorkflow,
  backfillStoryCentroids,
  backfillStoryLeadArticles,
  CLUSTER_LOOKBACK_DAYS,
  CLUSTER_SIMILARITY_THRESHOLD,
} from '../src/lib/story-clusters';

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NUXT_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL（或 NUXT_DATABASE_URL）');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const reset = args.includes('--reset');
const threshold = flag('threshold') === undefined ? CLUSTER_SIMILARITY_THRESHOLD : Number(flag('threshold'));
const lookbackDays = flag('lookback') === undefined ? CLUSTER_LOOKBACK_DAYS : Number(flag('lookback'));

const db = getDb(DATABASE_URL);

async function main() {
  // 只补「代表文章」，不动归并结果。新增 lead_article_id 列后给历史行回填用；
  // 也可在换了挑选口径后重跑（配合先把该列置空）。
  if (args.includes('--lead-articles')) {
    const centroids = await backfillStoryCentroids(db);
    const leads = await backfillStoryLeadArticles(db);
    console.log(`补 centroid ${centroids} 条 · 补代表文章 ${leads} 条`);
    await db.$client.end();
    return;
  }

  console.log(`阈值 ${threshold} · 回看 ${lookbackDays} 天${reset ? ' · 先清空重建' : ''}`);

  if (reset) {
    await db.execute(sql`UPDATE brief_stories SET story_cluster_id = NULL`);
    await db.execute(sql`DELETE FROM story_clusters`);
    console.log('已清空既有线索');
  }

  // 必须按时间正序：归并是增量的，后一天要能看到前一天已经建好的线索
  const runs = (await db.execute(sql`
    SELECT br.workflow_id, r.created_at::date AS day, count(bs.id)::int AS stories
    FROM brief_runs br
    JOIN reports r ON r.id = br.report_id
    JOIN brief_stories bs ON bs.workflow_id = br.workflow_id
    WHERE bs.story_cluster_id IS NULL
    GROUP BY br.workflow_id, r.created_at
    ORDER BY r.created_at ASC
  `)) as unknown as { workflow_id: string; day: Date; stories: number }[];

  console.log(`待处理 ${runs.length} 个 workflow`);

  const total = { briefed: 0, joined: 0, created: 0, attachedCandidates: 0 };
  for (const run of runs) {
    const stats = await assignStoryClustersForWorkflow(db, run.workflow_id, { threshold, lookbackDays });
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += stats[k];
    console.log(
      `${run.day.toISOString?.().slice(0, 10) ?? run.day}  入选 ${String(stats.briefed).padStart(3)} 条 → ` +
        `并入 ${String(stats.joined).padStart(3)} · 新建 ${String(stats.created).padStart(3)} · 候选挂靠 ${stats.attachedCandidates}`
    );
  }

  console.log(`\n合计: ${JSON.stringify(total)}`);

  const [summary] = await db.execute(sql`
    SELECT count(*)::int AS clusters,
           count(*) FILTER (WHERE last_seen_at >= now() - interval '7 days')::int AS active,
           max(last_seen_at - first_seen_at) AS longest_span
    FROM story_clusters
  `);
  console.log(`线索总数 ${summary.clusters} · 近 7 天有更新 ${summary.active} · 最长跨度 ${summary.longest_span}`);

  await db.$client.end();
}

main().catch(async (err: unknown) => {
  console.error(err);
  try {
    await db.$client.end();
  } catch {}
  process.exit(1);
});
