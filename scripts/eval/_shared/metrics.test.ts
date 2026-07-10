// 确定性自测(不碰 LLM):喂写死的 (gold, pred),断言指标 = 手算已知值。
// 跑法:npx tsx scripts/eval/_shared/metrics.test.ts   —— 见 ADR 0002 的验证策略。
import { confusion, cohensKappa, perClass, balancedAccuracy, fBeta, type Pred } from './metrics.js';

let failures = 0;
function ok(name: string, got: number | null, want: number | null, tol = 1e-9) {
  const pass =
    (got === null && want === null) ||
    (got !== null && want !== null && Math.abs(got - want) <= tol);
  if (!pass) {
    failures++;
    console.error(`  ✗ ${name}: got ${got}, want ${want}`);
  } else {
    console.log(`  ✓ ${name} = ${got === null ? 'null' : got.toFixed(6)}`);
  }
}

// 固定金标(手算基准),混淆矩阵:
//   gold\pred  A  B  C
//   A          3  1  0   (support 4)
//   B          1  2  0   (support 3)
//   C          0  1  2   (support 3)   N=10
const CLASSES = ['A', 'B', 'C'];
const preds: Pred[] = [
  ...Array(3).fill({ gold: 'A', pred: 'A' }),
  { gold: 'A', pred: 'B' },
  { gold: 'B', pred: 'A' },
  ...Array(2).fill({ gold: 'B', pred: 'B' }),
  { gold: 'C', pred: 'B' },
  ...Array(2).fill({ gold: 'C', pred: 'C' }),
].map((x, i) => ({ id: `t${i}`, ...x }));

const m = confusion(preds, CLASSES);
const pc = perClass(m, CLASSES); // β=1

console.log('== Cohen κ ==');
ok('kappa', cohensKappa(m, CLASSES), 0.36 / 0.66); // (po-pe)/(1-pe)=(0.7-0.34)/0.66

console.log('== per-class 召回/精确率/FPR/F1 ==');
ok('A.tpr', pc['A'].tpr, 0.75);
ok('A.precision', pc['A'].precision, 0.75);
ok('A.fpr', pc['A'].fpr, 1 / 6);
ok('A.fbeta(F1)', pc['A'].fbeta, 0.75);
ok('B.tpr', pc['B'].tpr, 2 / 3);
ok('B.precision', pc['B'].precision, 0.5);
ok('B.fpr', pc['B'].fpr, 2 / 7);
ok('B.fbeta(F1)', pc['B'].fbeta, (2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3));
ok('C.tpr', pc['C'].tpr, 2 / 3);
ok('C.precision', pc['C'].precision, 1.0);
ok('C.fpr', pc['C'].fpr, 0);
ok('C.fbeta(F1)', pc['C'].fbeta, (2 * 1 * (2 / 3)) / (1 + 2 / 3));

console.log('== balanced acc ==');
ok('balancedAcc', balancedAccuracy(pc, CLASSES), (0.75 + 2 / 3 + 2 / 3) / 3);

console.log('== Fβ 偏召回(β=2) ==');
ok('fBeta(0.5,2/3,β=2)', fBeta(0.5, 2 / 3, 2), (5 * 0.5 * (2 / 3)) / (4 * 0.5 + 2 / 3));
ok('fBeta with null → null', fBeta(null, 0.5), null);

console.log('== 边界:某类 0 样本 → 召回 null ==');
const pc2 = perClass(confusion(preds, ['A', 'B', 'C', 'Z']), ['A', 'B', 'C', 'Z']);
ok('Z.support(0).tpr', pc2['Z'].tpr, null);

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
