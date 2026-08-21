/**
 * 簇内候选分组（几何、零 LLM、确定性）。
 *
 * 为什么需要这一层：此前 story-validation 是「整簇送 LLM，让它自己划出所有子故事」。
 * 2026-08-20/21 实测这个任务模型做不了——不是 prompt 问题也不是模型档次问题：
 *   - 七个 prompt 变体（含加穷尽契约、加 unassigned 出口）召回全落在 16-23/31，无一超过不改
 *   - gpt-oss-120b / deepseek-v4-pro / kimi-k2.6 三个高档模型硬配对全中，deepseek 最严重(52%)
 *   - 一手来源调研（docs/engineering-notes/exhaustive-assignment-and-singleton-events.md）：
 *     BERTopic / TopicGPT / ClusterLLM / Event Registry / TDT 没有一个让 LLM 去切分集合，
 *     几何负责分配、LLM 只做逐条判定
 * 改成「几何出候选 + LLM 逐组判断」后，人工严口径精度 41.7% → 89-92%（两天复验一致）。
 *
 * 算法选全链(complete-linkage)不选单链：单链任意一对超阈值就并，会串联成巨团；
 * 全链要求组内**所有**对都超阈值，不串联。实测在 0.90 上组中位数 2 篇、最大 16 篇。
 */

/** 候选组：簇内的一个几何子集，是 story-validation 的判定单位（取代原来的「整簇」） */
export interface CandidateGroup {
  clusterId: number;
  /** `${clusterId}-${序号}`，用于日志与观测对账 */
  groupId: string;
  articleIds: number[];
}

/**
 * 簇内全链凝聚。贪心：每次合并「合并后组内最小相似度仍 ≥ thr」的一对，
 * 以组间最小相似度作合并优先级（最保守的那对先并）。
 *
 * 只返回 ≥2 篇的组：单篇不可能构成故事（rubric 定义：故事成立 = 有 ≥2 篇报道同一个具体发生）。
 * 落单的文章不进判官，也就不会成故事——2026-08-20 全量实测 1254 篇里 592 篇落单，
 * 但在人工核过的 7 个最大簇上，落单没有丢失任何一个人工确认的真事件（85/85 全捕获）。
 */
function completeLinkage(ids: number[], unit: Map<number, Float64Array>, thr: number): number[][] {
  const n = ids.length;
  if (n < 2) return [];

  // 预算相似度矩阵：向量已归一化，余弦=点积
  const sim = Array.from({ length: n }, () => new Float64Array(n));
  for (let a = 0; a < n; a++) {
    const va = unit.get(ids[a])!;
    for (let b = a + 1; b < n; b++) {
      const vb = unit.get(ids[b])!;
      let s = 0;
      for (let k = 0; k < va.length; k++) s += va[k] * vb[k];
      sim[a][b] = s;
      sim[b][a] = s;
    }
  }

  let groups: number[][] = Array.from({ length: n }, (_, i) => [i]);
  for (;;) {
    let best: [number, number] | null = null;
    let bestSim = -Infinity;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        // 组间最小相似度；一旦低于阈值立即剪枝（全链的合并条件就是最小值 ≥ thr）
        let mn = 1;
        outer: for (const x of groups[a]) {
          for (const y of groups[b]) {
            const s = sim[x][y];
            if (s < mn) mn = s;
            if (mn < thr) break outer;
          }
        }
        if (mn >= thr && mn > bestSim) {
          bestSim = mn;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    const [a, b] = best;
    groups[a] = groups[a].concat(groups[b]);
    groups.splice(b, 1);
  }

  return groups.filter(g => g.length >= 2).map(g => g.map(i => ids[i]));
}

/**
 * 为所有簇生成候选组。
 *
 * 复杂度是 O(n³) 级的贪心，但实测不构成问题：2026-08-20 全量 57 簇 1254 篇（最大簇 135 篇）
 * 单线程 28ms，最慢的单簇 14ms。所以这一步放 backend 直接算，不必绕 ml-service。
 *
 * @param embeddings 文章向量。缺向量的文章直接跳过（不进任何组），并计入返回的 skipped。
 */
export function buildCandidateGroups(
  clusters: Array<{ clusterId: number; articleIds: number[] }>,
  embeddings: Array<{ articleId: number; embedding: number[] }>,
  threshold: number
): { groups: CandidateGroup[]; skippedNoEmbedding: number[] } {
  // 归一化一次，后续全用点积
  const unit = new Map<number, Float64Array>();
  for (const e of embeddings) {
    if (!Array.isArray(e.embedding) || e.embedding.length === 0) continue;
    let norm = 0;
    for (const x of e.embedding) norm += x * x;
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm === 0) continue;
    unit.set(e.articleId, Float64Array.from(e.embedding, x => x / norm));
  }

  const groups: CandidateGroup[] = [];
  const skippedNoEmbedding: number[] = [];

  for (const c of clusters) {
    const ids = c.articleIds.filter(id => {
      if (unit.has(id)) return true;
      skippedNoEmbedding.push(id);
      return false;
    });
    completeLinkage(ids, unit, threshold).forEach((g, k) => {
      groups.push({
        clusterId: c.clusterId,
        groupId: `${c.clusterId}-${k + 1}`,
        articleIds: g.slice().sort((x, y) => x - y),
      });
    });
  }

  return { groups, skippedNoEmbedding };
}
