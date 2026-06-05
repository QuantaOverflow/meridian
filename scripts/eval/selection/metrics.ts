// 选择层排序质量度量：NDCG@N。
// 我们的选择层是"按分数排候选 → 取 top-N 渲染进 brief"，本质是排序问题；
// NDCG 用"分级相关 + 位置折扣"打分，正合 top-N(漏在后面 = 用户看不到)。
//
// rel  = 人工标的分级相关度(0-3，0=不该上 … 3=必上)
// 排序 = 模型给候选的顺序，relsInRankOrder[i] 即模型排第 (i+1) 名那个候选的 rel
// DCG  = Σ rel_i / log2(i + 2)   (i 从 0 起，位置 rank=i+1，故折扣 = log2(rank+1) = log2(i+2))
// IDCG = 同一批 rel 按降序排的理想 DCG
// NDCG = DCG / IDCG ∈ [0,1]，1 = 排序与人工判断完全一致

export function dcgAtN(relsInRankOrder: number[], n: number): number {
  return relsInRankOrder
    .slice(0, n)
    .reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
}

export function ndcgAtN(relsInRankOrder: number[], n: number): number {
  const ideal = [...relsInRankOrder].sort((a, b) => b - a);
  const idcg = dcgAtN(ideal, n);
  if (idcg === 0) return 0; // 全 0 相关：无理想排序可言，定义为 0
  return dcgAtN(relsInRankOrder, n) / idcg;
}

// 指数增益变体 gain = 2^rel - 1，放大高相关项(TREC 常用)。
// 小刻度(0-3)下 2^3=8 仍安全；标度一大(如 0-10)会指数爆炸，故只配 0-3 用。
export function ndcgAtNExp(relsInRankOrder: number[], n: number): number {
  const gain = (r: number) => Math.pow(2, r) - 1;
  const g = relsInRankOrder.map(gain);
  const idcg = [...g].sort((a, b) => b - a).slice(0, n)
    .reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
  if (idcg === 0) return 0;
  const d = g.slice(0, n).reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
  return d / idcg;
}
