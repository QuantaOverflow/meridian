// 编排：拉聚类快照 + 文章 → 产/读语义参考划分 → 算 B-cubed → 报告。
// 当前候选 = 线上 HDBSCAN 快照；后续新算法(entity+Leiden)产出同样形态的 Partition 即可同台比较。
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchClusteringSnapshot, fetchArticles } from './fetch.js';
import { buildReference } from './reference.js';
import { bcubed, snapshotToPartition, referenceToPartition } from './metrics.js';
import type { ClusteringEvalReport } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../../../eval-reports/clustering');

function parseArgs(argv: string[]) {
  const out: { workflowId?: string; model: string; refresh: boolean } = {
    model: 'qwen-max',
    refresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workflow') out.workflowId = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--refresh') out.refresh = true;
  }
  if (!out.workflowId) {
    console.log('Usage: tsx score.ts --workflow <id> [--model qwen-max] [--refresh]');
    process.exit(1);
  }
  return out as { workflowId: string; model: string; refresh: boolean };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[score] workflow=${args.workflowId} model=${args.model}`);

  const snap = await fetchClusteringSnapshot(args.workflowId);
  const allIds = [...new Set(snap.clusters.flatMap(c => c.articleIds))];
  console.log(`[score] 快照: ${snap.clusters.length} 簇, ${allIds.length} 篇`);

  const articleMap = await fetchArticles(allIds);
  const articles = allIds.map(id => articleMap.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  console.log(`[score] 取到 ${articles.length}/${allIds.length} 篇文章信息`);

  const ref = await buildReference(args.workflowId, articles, {
    model: args.model,
    refresh: args.refresh,
  });

  const predicted = snapshotToPartition(snap);
  const reference = referenceToPartition(ref);
  const m = bcubed(predicted, reference);

  const report: ClusteringEvalReport = {
    workflowId: args.workflowId,
    referenceModel: ref.judgeModel,
    referencePromptHash: ref.promptHash,
    timestamp: new Date().toISOString(),
    candidates: [
      {
        name: 'current-hdbscan',
        bcubed: m,
        predictedClusters: snap.clusters.filter(c => c.clusterId !== -1).length,
        referenceStories: ref.stories.length,
      },
    ],
  };

  await mkdir(REPORTS_DIR, { recursive: true });
  const outPath = resolve(REPORTS_DIR, `${args.workflowId}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n===== 聚类语义评估 =====');
  console.log(`参考(${ref.judgeModel}): ${ref.stories.length} 个故事 | 预测(HDBSCAN): ${report.candidates[0].predictedClusters} 簇`);
  console.log(`B-cubed  P=${m.precision.toFixed(3)} (低=conflation揉太多)`);
  console.log(`         R=${m.recall.toFixed(3)} (低=fragmentation拆太碎)`);
  console.log(`         F=${m.f1.toFixed(3)}  (n=${m.nItems})`);
  console.log(`报告 -> ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
