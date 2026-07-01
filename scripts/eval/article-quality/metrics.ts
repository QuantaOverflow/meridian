// ============================================================================
// 指标：多类混淆矩阵 + Cohen's κ + per-class TPR/TNR/precision + balanced acc。
// 数学与 faithfulness/meta-eval.ts 同源（分级一致性任务通用），这里抽出复用。
//
// 为什么不用 accuracy：文章质量分布偏斜（多数文章是 OK / COMPLETE），「全判 OK」
// 也能拿高 accuracy 却完全没拦住脏文章（majority-class artifact）。看 per-class 召回。
// ============================================================================

export interface Pred {
  id: string;
  gold: string;
  pred: string;
  strata?: Record<string, string>;
}

// 混淆矩阵：m[gold][pred] = 计数
export function confusion(preds: Pred[], classes: string[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const g of classes) {
    m[g] = {};
    for (const p of classes) m[g][p] = 0;
  }
  for (const r of preds) {
    if (!(r.gold in m)) continue;
    const p = r.pred in m[r.gold] ? r.pred : r.gold; // pred 落到非法类时记为对角错配兜底
    m[r.gold][p] = (m[r.gold][p] ?? 0) + 1;
  }
  return m;
}

// Cohen's κ（多类）：po=对角/N；pe=Σ(行和/N)(列和/N)；κ=(po-pe)/(1-pe)
export function cohensKappa(m: Record<string, Record<string, number>>, classes: string[]): number {
  let N = 0;
  for (const g of classes) for (const p of classes) N += m[g][p];
  if (N === 0) return NaN;
  let po = 0;
  for (const c of classes) po += m[c][c];
  po /= N;
  let pe = 0;
  for (const c of classes) {
    const rowTotal = classes.reduce((s, p) => s + m[c][p], 0);
    const colTotal = classes.reduce((s, g) => s + m[g][c], 0);
    pe += (rowTotal / N) * (colTotal / N);
  }
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

export interface PerClassStat {
  support: number;
  predicted: number;
  tpr: number | null; // 召回
  tnr: number | null;
  precision: number | null;
}

// per-class TPR(召回)/TNR/precision
export function perClass(
  m: Record<string, Record<string, number>>,
  classes: string[]
): Record<string, PerClassStat> {
  const res: Record<string, PerClassStat> = {};
  let N = 0;
  for (const g of classes) for (const p of classes) N += m[g][p];
  for (const c of classes) {
    const tp = m[c][c];
    const fn = classes.reduce((s, p) => s + (p === c ? 0 : m[c][p]), 0);
    const fp = classes.reduce((s, g) => s + (g === c ? 0 : m[g][c]), 0);
    const support = tp + fn;
    const predicted = tp + fp;
    const negTotal = N - support;
    const tn = negTotal - fp;
    res[c] = {
      support,
      predicted,
      tpr: support > 0 ? tp / support : null,
      tnr: negTotal > 0 ? tn / negTotal : null,
      precision: predicted > 0 ? tp / predicted : null,
    };
  }
  return res;
}

export function balancedAccuracy(pc: Record<string, PerClassStat>, classes: string[]): number {
  const recalls = classes.map((c) => pc[c].tpr).filter((x): x is number => x !== null);
  return recalls.length ? recalls.reduce((s, x) => s + x, 0) / recalls.length : NaN;
}

export function fmt(x: number | null): string {
  return x === null ? ' n/a ' : x.toFixed(3);
}

export function printMatrix(m: Record<string, Record<string, number>>, classes: string[]) {
  const short = (c: string) => c.slice(0, 7).padStart(9);
  console.log(`  gold\\pred ${classes.map(short).join('')}`);
  for (const g of classes) {
    console.log(`  ${g.slice(0, 9).padEnd(9)} ${classes.map((p) => String(m[g][p]).padStart(9)).join('')}`);
  }
}

// 评估一个维度通道（content_quality / completeness / gate），打印 + 返回结构化结果
export function evalChannel(preds: Pred[], classes: string[], label: string) {
  const m = confusion(preds, classes);
  const k = cohensKappa(m, classes);
  const pc = perClass(m, classes);
  const bacc = balancedAccuracy(pc, classes);
  const n = preds.length;

  console.log(`\n=== ${label} 通道 (n=${n}) ===`);
  printMatrix(m, classes);
  console.log(`  Cohen's κ      = ${fmt(k)}`);
  console.log(`  balanced acc   = ${fmt(bacc)}`);
  console.log(`  per-class:`);
  for (const c of classes) {
    console.log(
      `    ${c.padEnd(16)} support=${String(pc[c].support).padStart(3)}  TPR(召回)=${fmt(pc[c].tpr)}  TNR=${fmt(pc[c].tnr)}` +
        `  judge喊=${String(pc[c].predicted).padStart(3)}  precision=${fmt(pc[c].precision)}`
    );
  }
  return { label, n, kappa: k, balancedAcc: bacc, perClass: pc, confusion: m };
}
