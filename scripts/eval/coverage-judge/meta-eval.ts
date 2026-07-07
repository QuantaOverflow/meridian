// ============================================================================
// meta-eval —— 验「覆盖对账判官」这把尺本身（是否可信到能据它说"合成漏报 68%"）
//
// 在人裁 gold 上跑判官，算 judge↔人 一致性（协议见 docs/eval-playbook.md §2）：
//   - 三分类(headline/noteworthy/dropped)：Cohen's κ + per-class TPR/TNR/precision
//   - 二分类(covered vs dropped)：决策级读数——"合成漏报"只关心 dropped 判得准不准
//     · dropped precision = 判官喊 dropped 里真为 dropped 的占比 = 1−误拦率（判官兜底默认 dropped
//       → 偏向多报漏报 → precision 是头号看点：会不会把其实覆盖了的 story 误判 dropped，虚增漏报）
//     · dropped recall = 真 dropped 里被判官抓住的占比
// gate：κ_3class ≥ KAPPA_MIN 且 dropped precision ≥ DROPPED_PREC_MIN。不过 → exit 1。
//
// 指标函数移植自 faithfulness/meta-eval.ts（单一实现口径）。
// 用法：tsx meta-eval.ts [gold.jsonl]   env: KAPPA_MIN(0.6) DROPPED_PREC_MIN(0.8)
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Disposition } from './align.js';

const KAPPA_MIN = Number(process.env.KAPPA_MIN ?? '0.6');
const DROPPED_PREC_MIN = Number(process.env.DROPPED_PREC_MIN ?? '0.8');
const CLASSES_3: Disposition[] = ['headline', 'noteworthy', 'dropped'];
const CLASSES_2 = ['covered', 'dropped'];
const toBin = (d: string) => (d === 'dropped' ? 'dropped' : 'covered');

interface Pred { id: string; gold: string; pred: string }

function loadJsonl(path: string): any[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => JSON.parse(l));
}

// ---- 指标（移植 faithfulness/meta-eval.ts）----
function confusion(preds: Pred[], classes: string[]) {
  const m: Record<string, Record<string, number>> = {};
  for (const g of classes) { m[g] = {}; for (const p of classes) m[g][p] = 0; }
  for (const r of preds) {
    if (!(r.gold in m)) continue;
    const p = r.pred in m[r.gold] ? r.pred : r.gold;
    m[r.gold][p] = (m[r.gold][p] ?? 0) + 1;
  }
  return m;
}
function cohensKappa(m: Record<string, Record<string, number>>, classes: string[]): number {
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
function perClass(m: Record<string, Record<string, number>>, classes: string[]) {
  const res: Record<string, { support: number; predicted: number; tpr: number | null; tnr: number | null; precision: number | null }> = {};
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
      support, predicted,
      tpr: support > 0 ? tp / support : null,
      tnr: negTotal > 0 ? tn / negTotal : null,
      precision: predicted > 0 ? tp / predicted : null,
    };
  }
  return res;
}
function balancedAccuracy(pc: ReturnType<typeof perClass>, classes: string[]): number {
  const rs = classes.map((c) => pc[c].tpr).filter((x): x is number => x !== null);
  return rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : NaN;
}
const fmt = (x: number | null) => (x === null ? ' n/a ' : x.toFixed(3));
function printMatrix(m: Record<string, Record<string, number>>, classes: string[]) {
  console.log(`  gold\\pred ${classes.map((c) => c.slice(0, 7).padStart(8)).join('')}`);
  for (const g of classes) {
    console.log(`  ${g.slice(0, 9).padEnd(9)} ${classes.map((p) => String(m[g][p]).padStart(8)).join('')}`);
  }
}
function evalChannel(preds: Pred[], classes: string[], label: string) {
  const m = confusion(preds, classes);
  const k = cohensKappa(m, classes);
  const pc = perClass(m, classes);
  const bacc = balancedAccuracy(pc, classes);
  console.log(`\n=== ${label} 通道 (n=${preds.length}) ===`);
  printMatrix(m, classes);
  console.log(`  Cohen's κ    = ${fmt(k)}`);
  console.log(`  balanced acc = ${fmt(bacc)}`);
  for (const c of classes) {
    const r = pc[c];
    console.log(`    ${c.padEnd(11)} support=${String(r.support).padStart(3)}  TPR(召回)=${fmt(r.tpr)}  TNR=${fmt(r.tnr)}  judge喊=${String(r.predicted).padStart(3)}  precision=${fmt(r.precision)}`);
  }
  return { label, n: preds.length, kappa: k, balancedAcc: bacc, perClass: pc, confusion: m };
}

function main() {
  const goldPath = process.argv[2] || 'gold.jsonl';
  if (!existsSync(goldPath)) {
    console.error(`✗ 无 ${goldPath}——先人裁 disagreements.md 并把裁定 + provisional-gold.jsonl 合并成 gold.jsonl`);
    process.exit(1);
  }
  const gold = new Map(loadJsonl(goldPath).map((r) => [r.id, r.gold as string]));
  const judge = loadJsonl('judge-labels.jsonl');

  const preds3: Pred[] = [];
  const missing: string[] = [];
  for (const j of judge) {
    const g = gold.get(j.id);
    if (!g) { missing.push(j.id); continue; }
    preds3.push({ id: j.id, gold: g, pred: j.judge_disposition });
  }
  console.log(`[coverage-meta-eval] gold=${goldPath} · 对上 ${preds3.length}/${judge.length} judge 判定${missing.length ? `（${missing.length} 条无 gold 跳过）` : ''}`);
  if (!preds3.length) { console.error('✗ 无对齐样本'); process.exit(1); }

  const res3 = evalChannel(preds3, CLASSES_3, '三分类 headline/noteworthy/dropped');
  const preds2: Pred[] = preds3.map((p) => ({ id: p.id, gold: toBin(p.gold), pred: toBin(p.pred) }));
  const res2 = evalChannel(preds2, CLASSES_2, '二分类 covered/dropped（决策级=合成漏报）');

  const droppedPrec = res2.perClass['dropped'].precision;
  const droppedRec = res2.perClass['dropped'].tpr;

  // ---- gate ----
  const fails: string[] = [];
  if (!(res3.kappa >= KAPPA_MIN)) fails.push(`三分类 κ=${fmt(res3.kappa)} < ${KAPPA_MIN}`);
  if (droppedPrec === null) fails.push('dropped precision 无定义（判官从未喊 dropped？金标需补）');
  else if (!(droppedPrec >= DROPPED_PREC_MIN)) fails.push(`dropped precision=${fmt(droppedPrec)} < ${DROPPED_PREC_MIN}（误拦：把覆盖了的误判 dropped，虚增漏报）`);
  const pass = fails.length === 0;

  // ---- 错配明细 ----
  const mism = preds3.filter((r) => r.gold !== r.pred);
  if (mism.length) {
    console.log(`\n=== 错配 ${mism.length}/${preds3.length}（judge ≠ 人）===`);
    for (const r of mism) console.log(`  [${r.id}] gold=${r.gold} judge=${r.pred}`);
  }

  const report = {
    checked_at: new Date().toISOString(),
    gold_path: goldPath,
    judge_model: process.env.JUDGE_MODEL || 'qwen-long',
    gate: { kappa_min: KAPPA_MIN, dropped_prec_min: DROPPED_PREC_MIN, pass, fail_reasons: fails },
    decision_level: { dropped_precision: droppedPrec, dropped_recall: droppedRec },
    three_class: res3,
    binary: res2,
    mismatches: mism,
  };
  mkdirSync('eval-reports', { recursive: true });
  const out = `eval-reports/coverage-meta-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[coverage-meta-eval] 报告 → ${out}`);
  console.log(`\ndropped precision=${fmt(droppedPrec)} recall=${fmt(droppedRec)}（"合成漏报"计数的可信度）`);
  console.log(`${pass ? '✅ PASS —— 覆盖对账判官可信，可据 dropped 读数说合成漏报' : '❌ FAIL: ' + fails.join('; ')}`);
  process.exit(pass ? 0 : 1);
}

main();
