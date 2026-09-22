// ============================================================================
// 检测型判官(桶①)共用指标模块 —— 见 docs/adr/0002-detection-judge-metric-unification.md
//
// 多类混淆矩阵 + Cohen's κ + per-class 召回(TPR)/精确率/TNR/FPR/Fβ + balanced acc。
// 类无关:所有函数接受 classes: string[],不写死任何类名,四个判官共用一份。
//
// 为什么不用 accuracy:判官金标普遍偏斜(多数是 supported/OK/covered),"全判多数类"
// 也能拿高 accuracy 却完全没抓住幻觉/脏文章(majority-class artifact)。看 per-class。
//
// 本模块只"测量并报告",不设门:各 harness 的 gate(κ_min + 召回 floor)仍在各自
// meta-eval.ts 里,一字不改。新增的 FPR/Fβ 是 report-only 的多余列(ADR 0002 决策)。
// ============================================================================

export interface Pred {
  id: string;
  gold: string;
  pred: string;
  strata?: Record<string, string>;
}

// 混淆矩阵:m[gold][pred] = 计数
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

// Cohen's κ(多类):po=对角/N;pe=Σ(行和/N)(列和/N);κ=(po-pe)/(1-pe)
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

// Fβ:β>1 偏召回、β<1 偏精确率、β=1 即 F1。任一为 null 或分母 0 → null。
export function fBeta(precision: number | null, recall: number | null, beta = 1): number | null {
  if (precision === null || recall === null) return null;
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  if (denom === 0) return null;
  return ((1 + b2) * precision * recall) / denom;
}

export interface PerClassStat {
  support: number; // gold=c 的样本数
  predicted: number; // judge 喊 c 的次数(tp+fp)
  tpr: number | null; // 召回 = tp/support
  tnr: number | null; // = tn/negTotal
  fpr: number | null; // 误拦率 = fp/negTotal = 1−tnr
  precision: number | null; // tp/predicted
  fbeta: number | null; // Fβ(默认 β=1 即 F1)
}

// per-class 召回(TPR)/TNR/FPR/precision/Fβ。beta 默认 1(F1);按类不同 β 时由调用方传。
export function perClass(
  m: Record<string, Record<string, number>>,
  classes: string[],
  beta = 1
): Record<string, PerClassStat> {
  const res: Record<string, PerClassStat> = {};
  let N = 0;
  for (const g of classes) for (const p of classes) N += m[g][p];
  for (const c of classes) {
    const tp = m[c][c];
    const fn = classes.reduce((s, p) => s + (p === c ? 0 : m[c][p]), 0); // gold=c 判成别的
    const fp = classes.reduce((s, g) => s + (g === c ? 0 : m[g][c]), 0); // gold≠c 判成 c
    const support = tp + fn;
    const predicted = tp + fp;
    const negTotal = N - support;
    const tn = negTotal - fp;
    const tpr = support > 0 ? tp / support : null;
    const tnr = negTotal > 0 ? tn / negTotal : null;
    const precision = predicted > 0 ? tp / predicted : null;
    res[c] = {
      support,
      predicted,
      tpr,
      tnr,
      fpr: negTotal > 0 ? fp / negTotal : null,
      precision,
      fbeta: fBeta(precision, tpr, beta),
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

export interface ChannelResult {
  label: string;
  n: number;
  kappa: number;
  balancedAcc: number;
  perClass: Record<string, PerClassStat>;
  confusion: Record<string, Record<string, number>>;
}

// 评估一个分类通道:打印(含 FPR/Fβ 两列)+ 返回结构化结果。
// 返回结构与旧各 harness 的 evalChannel 一致(kappa/balancedAcc/perClass/confusion/n/label),
// 只在 perClass 各项里多了 fpr/fbeta —— 门逻辑读的字段没变。beta 默认 1(F1)。
export function evalChannel(preds: Pred[], classes: string[], label: string, beta = 1): ChannelResult {
  const m = confusion(preds, classes);
  const k = cohensKappa(m, classes);
  const pc = perClass(m, classes, beta);
  const bacc = balancedAccuracy(pc, classes);
  const n = preds.length;

  console.log(`\n=== ${label} 通道 (n=${n}) ===`);
  printMatrix(m, classes);
  console.log(`  Cohen's κ      = ${fmt(k)}`);
  console.log(`  balanced acc   = ${fmt(bacc)}`);
  console.log(`  per-class (β=${beta}):`);
  for (const c of classes) {
    const r = pc[c];
    console.log(
      `    ${c.padEnd(16)} support=${String(r.support).padStart(3)}  TPR(召回)=${fmt(r.tpr)}` +
        `  precision=${fmt(r.precision)}  FPR(误拦)=${fmt(r.fpr)}  F${beta}=${fmt(r.fbeta)}` +
        `  TNR=${fmt(r.tnr)}  judge喊=${String(r.predicted).padStart(3)}`
    );
  }
  return { label, n, kappa: k, balancedAcc: bacc, perClass: pc, confusion: m };
}
