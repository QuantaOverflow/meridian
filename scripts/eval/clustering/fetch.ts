// 拉数据：聚类快照(/runs/:id/clustering) + 文章标题摘要(/admin/articles/by-ids)。
import type { ArticleInfo, ClusteringSnapshot } from './types.js';

const BACKEND_URL =
  process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';

export async function fetchClusteringSnapshot(workflowId: string): Promise<ClusteringSnapshot> {
  const resp = await fetch(`${BACKEND_URL}/observability/runs/${workflowId}/clustering`);
  if (!resp.ok) {
    throw new Error(
      `clustering 快照拉取失败 ${resp.status}（该 run 可能早于快照功能上线，需重跑一个 brief）`
    );
  }
  return (await resp.json()) as ClusteringSnapshot;
}

export async function fetchArticles(ids: number[]): Promise<Map<number, ArticleInfo>> {
  if (ids.length === 0) return new Map();
  const resp = await fetch(`${BACKEND_URL}/admin/articles/by-ids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) throw new Error(`/admin/articles/by-ids 失败 ${resp.status}`);
  const data = (await resp.json()) as { articles: ArticleInfo[] };
  return new Map(data.articles.map(a => [a.id, a]));
}
