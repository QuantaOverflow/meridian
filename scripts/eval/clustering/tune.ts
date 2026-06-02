// HDBSCAN 参数调优 harness：在多个 2 天窗口上扫参，对 B-cubed 取平均(抗单窗口噪声)。
//
// 为什么 2 天窗口：匹配 prod 实际聚类批量(rolling limit 500 ≈ 累积 ~2 天)；单日 news ~200 偏小、
// 4 天合池又会滚出 prod 见不到的超大 saga。2 天 ~320-480 篇落在 HDBSCAN 甜区且忠实于部署尺度。
// 为什么多窗口取平均：单个 2 天窗口仍有偶然性；跨 3 个重叠窗口平均 = 交叉验证，参数排名才可信。
//
// gold 切片技巧：bcubed 只在 predicted∩reference 的交集上算，所以直接传"完整合池 gold"作参考、
// "窗口内文章"作 predicted，bcubed 自动把 gold 限制到窗口(跨天 saga 的 recall 只按窗口内成员算)。
//
// 用法: tsx tune.ts --days 2026-05-29,2026-05-30,2026-05-31,2026-06-01 \
//          --pool-key news-pool-0529-0601 [--ml-url ...] [--token ...]
//          [--mcs 3,5,8,12] [--eps 0.0,0.1,0.2] [--nn 10,15]
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcubed, referenceToPartition } from './metrics.js';
import type { Partition, ReferencePartition, BcubedMetrics } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../../../eval-reports/clustering');

function parseArgs(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  if (!o.days || !o['pool-key']) {
    console.log('Usage: tsx tune.ts --days d1,d2,d3,d4 --pool-key <k> [--mcs 3,5,8] [--eps 0.0,0.1,0.2] [--nn 10,15]');
    process.exit(1);
  }
  return o;
}

const PROD = { umap_n_components: 10, umap_n_neighbors: 15, umap_min_dist: 0.0, umap_metric: 'cosine', hdbscan_min_cluster_size: 5, hdbscan_min_samples: 3, hdbscan_cluster_selection_epsilon: 0.2 };

type Cfg = { mcs: number; eps: number; nn: number; ms: number; prune: number | null };
type MlItem = { id?: number | string; metadata?: { id?: number | string } };

async function cluster(mlUrl: string, token: string, items: Array<{ id: number; embedding: number[] }>, cfg: Cfg): Promise<Partition> {
  const config = {
    ...PROD, umap_n_neighbors: cfg.nn, hdbscan_min_cluster_size: cfg.mcs,
    hdbscan_min_samples: cfg.ms, hdbscan_cluster_selection_epsilon: cfg.eps,
    ...(cfg.prune != null ? { postprocess_prune_threshold: cfg.prune } : {}),
  };
  const resp = await fetch(`${mlUrl}/ai-worker/clustering?return_embeddings=false&return_reduced_embeddings=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({ items, config }),
  });
  if (!resp.ok) throw new Error(`ml ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const ml = (await resp.json()) as { clusters: Array<{ cluster_id: number; items: MlItem[] }> };
  const p: Partition = new Map();
  for (const c of ml.clusters) for (const it of c.items) p.set(Number(it.metadata?.id ?? it.id), c.cluster_id);
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = args.days.split(',');
  const mlUrl = args['ml-url'] || 'http://127.0.0.1:8081';
  const token = args.token || 'dev-token-123';
  const mcsList = (args.mcs || '3,5,8,12').split(',').map(Number);
  const epsList = (args.eps || '0.0,0.1,0.2').split(',').map(Number);
  const nnList = (args.nn || '10,15').split(',').map(Number);
  const msList = (args.ms || '3').split(',').map(Number);
  const pruneList: Array<number | null> = args.prune ? args.prune.split(',').map(Number) : [null];

  // 完整合池 gold(作参考；bcubed 自动按窗口取交集)
  const gold = JSON.parse(await readFile(resolve(CACHE_DIR, `reference-${args['pool-key']}.json`), 'utf8')) as ReferencePartition;
  const reference = referenceToPartition(gold);

  // embedding(全 634);--emb-key 可指向不同嵌入缓存
  const embKey = args['emb-key'] || args['pool-key'];
  const embMap = JSON.parse(await readFile(resolve(CACHE_DIR, `embeddings-${embKey}.json`), 'utf8')) as Record<string, number[]>;

  // 每天的文章 ids(从 per-day gold)
  const dayIds: Record<string, number[]> = {};
  for (const d of days) {
    const r = JSON.parse(await readFile(resolve(CACHE_DIR, `reference-news-${d}.json`), 'utf8')) as ReferencePartition;
    dayIds[d] = [...new Set([...r.stories.flatMap(s => s.articleIds), ...(r.unassigned || [])])];
  }
  // 连续 2 天滑动窗口
  const windows = days.slice(0, -1).map((d, i) => [d, days[i + 1]] as [string, string]);
  console.log(`[tune] ${windows.length} 个 2 天窗口: ${windows.map(w => w.join('+')).join(', ')}`);
  const winItems = windows.map(([a, b]) => {
    const ids = [...new Set([...dayIds[a], ...dayIds[b]])];
    return { name: `${a.slice(5)}+${b.slice(5)}`, items: ids.map(id => ({ id, embedding: embMap[String(id)] })).filter(x => x.embedding) };
  });
  winItems.forEach(w => console.log(`   窗口 ${w.name}: ${w.items.length} 篇`));

  // 扫参
  const grid: Cfg[] = [];
  for (const mcs of mcsList) for (const eps of epsList) for (const nn of nnList) for (const ms of msList) for (const prune of pruneList) grid.push({ mcs, eps, nn, ms, prune });
  console.log(`[tune] 网格 ${grid.length} 组 × ${windows.length} 窗口 = ${grid.length * windows.length} 次聚类\n`);

  const rows: Array<{ cfg: Cfg; meanP: number; meanR: number; meanF: number; per: BcubedMetrics[] }> = [];
  for (const cfg of grid) {
    const per: BcubedMetrics[] = [];
    for (const w of winItems) {
      const pred = await cluster(mlUrl, token, w.items, cfg);
      per.push(bcubed(pred, reference));
    }
    const mean = (f: (m: BcubedMetrics) => number) => per.reduce((s, m) => s + f(m), 0) / per.length;
    rows.push({ cfg, meanP: mean(m => m.precision), meanR: mean(m => m.recall), meanF: mean(m => m.f1), per });
  }

  rows.sort((a, b) => b.meanF - a.meanF);
  const isBaseline = (c: Cfg) => c.mcs === 5 && c.eps === 0.2 && c.nn === 15;
  console.log('mcs  ms   eps   nn   prune  meanP   meanR   meanF    (P per window)');
  console.log('──────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    const tag = isBaseline(r.cfg) ? '  ← prod baseline' : '';
    const perP = r.per.map(m => m.precision.toFixed(2)).join('/');
    const pr = r.cfg.prune == null ? '-' : r.cfg.prune.toFixed(2);
    console.log(`${String(r.cfg.mcs).padEnd(4)} ${String(r.cfg.ms).padEnd(4)} ${r.cfg.eps.toFixed(1).padEnd(5)} ${String(r.cfg.nn).padEnd(4)} ${pr.padEnd(6)} ${r.meanP.toFixed(3)}  ${r.meanR.toFixed(3)}  ${r.meanF.toFixed(3)}  [${perP}]${tag}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
