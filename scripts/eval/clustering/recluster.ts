// 重聚类：对"某天 gold 覆盖的同一批纯新闻文章"重新跑一次 HDBSCAN(经 ml-service)，
// 产出 predicted 划分，与冻结 gold 算 B-cubed —— 第一个"干净"的聚类质量数字。
//
// 为什么单独写：score.ts 用的是某次 prod run 的快照(含 HN、文章集与 gold 不一致)。
// 这里强制 predicted 与 gold 铺在完全同一批文章上(都来自 reference-{key}.json 的 ids)，
// 且用 prod 同一份 articles.embedding 向量(经 embeddings-{key}.json 缓存)。
//
// 用法:
//   tsx recluster.ts --key news-2026-06-01 [--ml-url http://127.0.0.1:8081] [--token dev-token-123]
//        [--min-cluster-size 5] [--min-samples 3] [--epsilon 0.2] [--n-neighbors 15] [--n-components 10]
//
// 前置:
//   - eval-reports/clustering/reference-{key}.json  (冻结 gold)
//   - eval-reports/clustering/embeddings-{key}.json  ({ "<id>": [..384..], ... }，由 Neon 拉取缓存)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcubed, referenceToPartition } from './metrics.js';
import type { Partition, ReferencePartition } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

// prod 实际下发的聚类参数(apps/backend/src/lib/services/clustering.ts:149-160)。
// 注意 epsilon=0.2 是 prod 的覆盖值，ml-service schema 默认是 0.0 —— 必须显式传，否则不复刻线上。
const PROD_CONFIG = {
  umap_n_components: 10,
  umap_n_neighbors: 15,
  umap_min_dist: 0.0,
  umap_metric: 'cosine' as const,
  hdbscan_min_cluster_size: 5,
  hdbscan_min_samples: 3,
  hdbscan_cluster_selection_epsilon: 0.2,
};

function parseArgs(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  if (!o.key) {
    console.log('Usage: tsx recluster.ts --key news-2026-06-01 [--ml-url ...] [--token ...] [--min-cluster-size N] [--min-samples N] [--epsilon F] [--n-neighbors N] [--n-components N]');
    process.exit(1);
  }
  return o;
}

// ml-service 把原始 id 放在 item.metadata.id（item 形如 {index, text, metadata:{id,...}}）
type MlItem = { id?: number | string; metadata?: { id?: number | string } };
type MlCluster = { cluster_id: number; items: MlItem[] };
type MlResponse = {
  clusters: MlCluster[];
  clustering_stats?: { n_clusters?: number; cluster_sizes?: Record<string, number> };
  config_used?: Record<string, unknown>;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.key;
  const mlUrl = args['ml-url'] || process.env.ML_SERVICE_URL || 'http://127.0.0.1:8081';
  const token = args.token || process.env.ML_API_TOKEN || 'dev-token-123';

  const config = {
    ...PROD_CONFIG,
    ...(args['n-components'] ? { umap_n_components: +args['n-components'] } : {}),
    ...(args['n-neighbors'] ? { umap_n_neighbors: +args['n-neighbors'] } : {}),
    ...(args['min-cluster-size'] ? { hdbscan_min_cluster_size: +args['min-cluster-size'] } : {}),
    ...(args['min-samples'] ? { hdbscan_min_samples: +args['min-samples'] } : {}),
    ...(args.epsilon ? { hdbscan_cluster_selection_epsilon: +args.epsilon } : {}),
    ...(args.prune ? { postprocess_prune_threshold: +args.prune } : {}),
    ...(args.dissolve ? { postprocess_dissolve_threshold: +args.dissolve } : {}),
  };

  // 1) 冻结 gold → 文章 ids + 参考划分
  const gold = JSON.parse(
    await readFile(resolve(CACHE_DIR, `reference-${key}.json`), 'utf8')
  ) as ReferencePartition;
  const goldIds = [
    ...gold.stories.flatMap(s => s.articleIds),
    ...(gold.unassigned || []),
  ];
  console.log(`[recluster] key=${key} gold: ${gold.stories.length} 故事 + ${(gold.unassigned || []).length} 单例 = ${goldIds.length} 篇`);

  // 2) embedding 缓存(id -> 向量)。--emb-key 可指向不同嵌入缓存(同一 gold 比不同嵌入)。
  const embKey = args['emb-key'] || key;
  const embMap = JSON.parse(
    await readFile(resolve(CACHE_DIR, `embeddings-${embKey}.json`), 'utf8')
  ) as Record<string, number[]>;

  // 3) 组装 items(只用 gold ids 中有 embedding 的；告警缺失)
  const items: Array<{ id: number; embedding: number[] }> = [];
  const missing: number[] = [];
  for (const id of goldIds) {
    const v = embMap[String(id)];
    if (Array.isArray(v) && v.length > 0) items.push({ id, embedding: v });
    else missing.push(id);
  }
  if (missing.length) console.warn(`[recluster] ⚠️ ${missing.length} 篇缺 embedding(将不进聚类，导致与 gold 不对齐): ${missing.slice(0, 10).join(',')}${missing.length > 10 ? '…' : ''}`);
  console.log(`[recluster] 送入 ml-service ${items.length} 篇，config=${JSON.stringify(config)}`);

  // 4) 调 ml-service /ai-worker/clustering(复刻 prod 调用形态)
  const resp = await fetch(`${mlUrl}/ai-worker/clustering?return_embeddings=false&return_reduced_embeddings=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({ items, config }),
  });
  if (!resp.ok) {
    throw new Error(`ml-service ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const ml = (await resp.json()) as MlResponse;

  // 5) ml 响应 → predicted Partition(cluster_id 直接当标签；-1 由 bcubed 展开成单例)
  const predicted: Partition = new Map();
  for (const c of ml.clusters) {
    for (const it of c.items) predicted.set(Number(it.metadata?.id ?? it.id), c.cluster_id);
  }
  const nClusters = ml.clusters.filter(c => c.cluster_id !== -1).length;
  const noise = ml.clusters.find(c => c.cluster_id === -1)?.items.length ?? 0;
  const sizes = ml.clusters
    .filter(c => c.cluster_id !== -1)
    .map(c => c.items.length)
    .sort((a, b) => b - a);

  // 6) B-cubed(predicted vs gold)
  const reference = referenceToPartition(gold);
  const m = bcubed(predicted, reference);

  // 7) 报告
  const outPath = resolve(CACHE_DIR, `recluster-${key}.json`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        key,
        timestamp: new Date().toISOString(),
        config_used: ml.config_used ?? config,
        predictedClusters: nClusters,
        noiseCount: noise,
        clusterSizes: sizes,
        referenceStories: gold.stories.length,
        bcubed: m,
        predicted: Object.fromEntries(predicted),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('\n===== 重聚类语义评估(干净) =====');
  console.log(`参考(gold ${gold.judgeModel}): ${gold.stories.length} 故事 | 预测(HDBSCAN): ${nClusters} 簇, 噪声 ${noise} 篇`);
  console.log(`簇大小(降序): [${sizes.join(', ')}]`);
  console.log(`B-cubed  P=${m.precision.toFixed(3)} (低=conflation揉太多)`);
  console.log(`         R=${m.recall.toFixed(3)} (低=fragmentation拆太碎)`);
  console.log(`         F=${m.f1.toFixed(3)}  (n=${m.nItems})`);
  console.log(`报告 -> ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
