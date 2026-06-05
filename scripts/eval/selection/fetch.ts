// 拉某 run 的候选 story：/observability/runs/:workflowId 返回 {success, run, stories}，
// 其中 stories 即 $brief_stories 行(带 article_ids)。这些都是被接受的候选(拒绝聚类不在此表)。
import type { Candidate } from './types.js';

const BACKEND_URL =
  process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';

interface BriefStoryRow {
  cluster_id: number;
  title: string;
  importance: number;
  article_count: number;
  article_ids: number[];
  selected_for_intel: boolean;
}

// 拉 article_id → source_id 映射(/admin/articles/by-ids 现含 sourceId),用于算独立源数。
export async function fetchSources(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  // 分批避免单请求过大
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const resp = await fetch(`${BACKEND_URL}/admin/articles/by-ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: batch }),
    });
    if (!resp.ok) throw new Error(`/admin/articles/by-ids 失败 ${resp.status}`);
    const data = (await resp.json()) as { articles: Array<{ id: number; sourceId: number | null }> };
    for (const a of data.articles) if (a.sourceId != null) map.set(a.id, a.sourceId);
  }
  return map;
}

export async function fetchCandidates(workflowId: string): Promise<Candidate[]> {
  const resp = await fetch(`${BACKEND_URL}/observability/runs/${workflowId}`);
  if (!resp.ok) {
    throw new Error(`/observability/runs/${workflowId} 失败 ${resp.status}（run 可能不存在或早于 brief_stories 落库）`);
  }
  const data = (await resp.json()) as { success: boolean; stories?: BriefStoryRow[] };
  const stories = data.stories ?? [];
  return stories.map(s => ({
    clusterId: s.cluster_id,
    title: s.title,
    importance: s.importance,
    articleCount: s.article_count,
    articleIds: Array.isArray(s.article_ids) ? s.article_ids : [],
  }));
}
