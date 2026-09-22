// 确定性聚类指标 —— 纯函数，零依赖、零 LLM、零网络。这是 eval 的"地面真值打分器"。
import type { Partition, BcubedMetrics, ClusteringSnapshot, ReferencePartition } from './types.js';

// 把聚类快照转成 Partition。噪声点(clusterId=-1)在 toPartition 阶段保留为 -1，
// 由 bcubed 内部展开成独立单例簇(语义：噪声里的每篇都自成一组)。
export function snapshotToPartition(snap: ClusteringSnapshot): Partition {
  const p: Partition = new Map();
  for (const c of snap.clusters) {
    for (const id of c.articleIds) p.set(id, c.clusterId);
  }
  return p;
}

// 把参考划分转成 Partition。unassigned 的文章各自单例(用负的唯一标签)。
export function referenceToPartition(ref: ReferencePartition): Partition {
  const p: Partition = new Map();
  ref.stories.forEach((s, idx) => {
    for (const id of s.articleIds) p.set(id, `S${idx}`);
  });
  (ref.unassigned || []).forEach((id, k) => p.set(id, `U${k}`));
  return p;
}

// 把"噪声 -1"展开成各自独立的单例簇标签，避免所有噪声被当成同一个大簇。
function expandNoise(part: Partition): Map<number, string> {
  const out = new Map<number, string>();
  let noiseSeq = 0;
  for (const [id, label] of part) {
    if (label === -1 || label === '-1') out.set(id, `__noise_${noiseSeq++}`);
    else out.set(id, String(label));
  }
  return out;
}

/**
 * B-cubed precision/recall/F1。
 * - predicted: 被评聚类的划分(item->cluster)
 * - reference: 语义参考划分(item->story)
 * 只在两个划分的 item 交集上计算；调用方应保证覆盖一致(否则按交集并告警)。
 *
 * 对每个 item i:
 *   precision_i = |同预测簇 且 同参考组 的 item| / |同预测簇的 item|
 *   recall_i    = |同预测簇 且 同参考组 的 item| / |同参考组的 item|
 * 取平均。precision 低=把不同故事揉一起(conflation)；recall 低=把一个故事拆散(fragmentation)。
 */
export function bcubed(predicted: Partition, reference: Partition): BcubedMetrics {
  const pred = expandNoise(predicted);
  const ref = expandNoise(reference);

  // 仅在交集上算
  const items = [...pred.keys()].filter(id => ref.has(id));
  const n = items.length;
  if (n === 0) return { precision: 0, recall: 0, f1: 0, nItems: 0 };

  // 预分组：标签 -> item 集合
  const byPred = new Map<string, Set<number>>();
  const byRef = new Map<string, Set<number>>();
  for (const id of items) {
    const pl = pred.get(id)!;
    const rl = ref.get(id)!;
    (byPred.get(pl) ?? byPred.set(pl, new Set()).get(pl)!).add(id);
    (byRef.get(rl) ?? byRef.set(rl, new Set()).get(rl)!).add(id);
  }

  let sumP = 0;
  let sumR = 0;
  for (const id of items) {
    const predSet = byPred.get(pred.get(id)!)!;
    const refSet = byRef.get(ref.get(id)!)!;
    // 同预测簇 且 同参考组 的数量 = 两集合交集大小
    let correct = 0;
    const smaller = predSet.size < refSet.size ? predSet : refSet;
    const larger = smaller === predSet ? refSet : predSet;
    for (const x of smaller) if (larger.has(x)) correct++;
    sumP += correct / predSet.size;
    sumR += correct / refSet.size;
  }

  const precision = sumP / n;
  const recall = sumR / n;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, nItems: n };
}
