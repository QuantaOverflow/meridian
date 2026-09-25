/**
 * 判官 vs 人工:真阳率 / 真阴率 / 逐条分歧。**没对齐过的判官,它报的比例只能当量级参考。**
 *
 * 为什么要有:2026-09-20 那轮三个临时判官在一天的生产数据上判了 51 篇 / 248 句,报出 72 条旗标;
 * 人工复核第二遍发现只有约 22% 是读者可见的错,其余是「出处挂错位置」被判成了编造 ——
 * 也就是判官的真阳率约 0.22 而没人知道。拿这个数去比较两个臂,差异全在判官的偏差里。
 *
 * 所以 CONTRACTS.md §5 写着:判官必须先与人工标注对齐。这个脚本就是那句话的读数。
 * 它**只报事实、不设门**:多少算够由人看,不在这里写死 —— 写死了就又是一条会过期的判据。
 *
 * 唯一的硬提醒是样本量:金标不足 30 条时 TPR/TNR 的置信区间比臂间差异还宽,
 * 此时这两个数不能进对比表。这一条必须打出来,因为「比例算得出来」从不代表「比例能用」。
 *
 * 用法:
 *   node judge-alignment.mjs --axis=citation-support --run=out/<runId>
 *                            [--gold=<file>] [--epoch=N]
 *
 * 退出码: 0 算出了读数(可能带警告);2 环境问题(缺金标 / 缺 run / 无重叠条目)
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AXES, promptId, samplesOf } from './collect-verdicts.mjs';

const HERE = new URL('.', import.meta.url).pathname;

/** 金标条目够不够撑起一个可比的率。低于它,读数只能当量级参考。 */
export const MIN_GOLD = 30;

/**
 * 混淆矩阵。**positive = `fail`**(判官报错为阳性),因为我们真正想量的是
 * 「报出来的错里有多少是真错」和「真错里有多少被报出来」。
 * pairs: [{ key, gold: 'pass'|'fail', judge: 'pass'|'fail', reason }]
 */
export function confusion(pairs) {
  const m = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const disagreements = [];
  for (const p of pairs) {
    if (p.gold === 'fail' && p.judge === 'fail') m.tp++;
    else if (p.gold === 'pass' && p.judge === 'fail') { m.fp++; disagreements.push(p); }
    else if (p.gold === 'pass' && p.judge === 'pass') m.tn++;
    else { m.fn++; disagreements.push(p); }
  }
  // 分母为 0 时给 null,不给 0:「没有正例」和「一条都没抓到」是两回事,混起来会读成判官很差
  m.tpr = m.tp + m.fn ? m.tp / (m.tp + m.fn) : null;
  m.tnr = m.tn + m.fp ? m.tn / (m.tn + m.fp) : null;
  return { ...m, disagreements };
}

const rate = (num, den) => (den ? `${num}/${den} = ${(num / den).toFixed(3)}` : `${num}/0 = n/a(金标里没有这一类)`);

/** 读金标。格式见 gold/README.md。 */
export function loadGold(file, axis) {
  if (!existsSync(file)) throw new Error(`缺人工标注 ${file} —— 先按 eval/_data/README.md 标一批,再谈判官的比例`);
  const g = JSON.parse(readFileSync(file, 'utf8'));
  if (g.axis && g.axis !== axis) throw new Error(`金标的 axis 是 ${g.axis},与 --axis=${axis} 不符`);
  if (!Array.isArray(g.labels)) throw new Error(`${file} 里 labels 不是数组`);
  for (const [i, l] of g.labels.entries()) {
    if (!Number.isInteger(Number(l?.cluster))) throw new Error(`labels[${i}] cluster 缺失`);
    if (typeof l?.ref !== 'string' || !l.ref) throw new Error(`labels[${i}] ref 缺失`);
    if (l?.label !== 'pass' && l?.label !== 'fail') throw new Error(`labels[${i}] label 必须是 pass/fail`);
  }
  return g;
}

/** 判官这一轴在这个 run 里的全部判定,摊平成 key → { label, reason }。 */
export function loadVerdicts(runDir, axis) {
  const dir = String(runDir).replace(/\/$/, '');
  const { samples } = samplesOf(dir);
  const map = new Map();
  const missingFiles = [];
  for (const s of samples) {
    const f = `${dir}/verdicts/${axis}-c${s.cluster}.json`;
    if (!existsSync(f)) { if (s.refs.length) missingFiles.push(f); continue; }
    const v = JSON.parse(readFileSync(f, 'utf8'));
    for (const j of Array.isArray(v.judgements) ? v.judgements : []) {
      map.set(`c${s.cluster}|${j.ref}`, { label: j.label, reason: j.reason ?? '', promptId: v.promptId });
    }
  }
  return { map, missingFiles };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  }));
  const axis = args.axis ? String(args.axis) : '';
  if (!axis || !AXES[axis] || !args.run) {
    console.error('用法: node judge-alignment.mjs --axis=<axis> --run=out/<runId> [--gold=<file>] [--epoch=N]');
    console.error(`axis 可选: ${Object.keys(AXES).join(' ')}`);
    process.exit(2);
  }
  const runDir = String(args.run).replace(/\/$/, '');
  // `--gold=` 只为自测换路径用:自测要喂伪造的金标,而它**不能写进真金标目录**
  const goldF = args.gold ? String(args.gold) : `${HERE}../_data/ctb-${axis}-v1/labels.json`;

  let gold, verdicts, curPromptId;
  try {
    curPromptId = promptId(axis);
    gold = loadGold(goldF, axis);
    verdicts = loadVerdicts(runDir, axis);
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }

  // epoch:金标条目标的是「哪一次重复跑出来的稿」。传了 --epoch 就按它筛,
  // 否则不筛并说明 —— 悄悄跨 epoch 比对会把另一稿的标注算进来,而这不报错。
  const epoch = args.epoch !== undefined ? Number(args.epoch) : null;
  const all = gold.labels;
  const used = epoch === null ? all : all.filter(l => l.run === undefined || Number(l.run) === epoch);
  const skippedEpoch = all.length - used.length;

  const pairs = [];
  const unjudged = [];
  for (const l of used) {
    const key = `c${l.cluster}|${l.ref}`;
    const v = verdicts.map.get(key);
    if (!v) { unjudged.push({ key, gold: l.label, note: l.note ?? '' }); continue; }
    pairs.push({ key, gold: l.label, judge: v.label, reason: v.reason, note: l.note ?? '', promptId: v.promptId });
  }

  console.log(`axis=${axis}  run=${runDir}  gold=${goldF}`);
  console.log(`judges/${axis}.md promptId=${curPromptId}` +
    (epoch === null ? '  epoch=未知(金标未按 epoch 筛)' : `  epoch=${epoch}`));
  const stale = [...new Set(pairs.filter(p => p.promptId && p.promptId !== curPromptId).map(p => p.promptId))];
  if (stale.length) {
    // 不在这里 exit:对齐率本身仍算得出来,但它量的是旧那把尺 —— 说清楚,别让人当成当前判官的读数
    console.log(`⚠️ 有判定的 promptId 与当前规格不符(${stale.join(' ')})—— 下面的率是旧尺的,别当当前判官的读数;跑 collect-verdicts.mjs 会拦住它`);
  }
  console.log(`金标 ${all.length} 条` + (skippedEpoch ? `(按 epoch 筛掉 ${skippedEpoch} 条)` : '') +
    ` · 有判官判定 ${pairs.length} 条 · 判官未判 ${unjudged.length} 条`);

  if (!pairs.length) {
    console.error('\n✗ 金标与判定没有一条重叠 —— 先确认判官判的是同一个 run 的同一批簇');
    if (unjudged.length) console.error(`  金标指向的条目一条都没找到判定,例如 ${unjudged.slice(0, 3).map(u => u.key).join(' ')}`);
    if (verdicts.missingFiles.length) console.error(`  缺判定文件 ${verdicts.missingFiles.length} 个,例如 ${verdicts.missingFiles[0]}`);
    process.exit(2);
  }

  const m = confusion(pairs);
  console.log('');
  console.log('混淆矩阵(positive = fail,即判官报错):');
  console.log('                判官 fail    判官 pass');
  console.log(`  人工 fail       TP ${String(m.tp).padStart(4)}    FN ${String(m.fn).padStart(4)}`);
  console.log(`  人工 pass       FP ${String(m.fp).padStart(4)}    TN ${String(m.tn).padStart(4)}`);
  console.log('');
  console.log(`真阳率 TPR = ${rate(m.tp, m.tp + m.fn)}   (人工认定是错的,判官抓到的比例)`);
  console.log(`真阴率 TNR = ${rate(m.tn, m.tn + m.fp)}   (人工认定没错的,判官放过的比例)`);

  if (m.disagreements.length) {
    console.log(`\n分歧 ${m.disagreements.length} 条(人工复核用):`);
    for (const d of m.disagreements) {
      const [c, ref] = d.key.split('|');
      console.log(`  ${c} ${ref}  人工 ${d.gold} / 判官 ${d.judge}`);
      console.log(`      判官理由: ${d.reason?.trim() ? d.reason.trim() : '(判官未给理由)'}`);
      if (d.note?.trim()) console.log(`      人工备注: ${d.note.trim()}`);
    }
  } else {
    console.log('\n分歧 0 条。');
  }

  if (unjudged.length) {
    // 金标有、判官没判 —— 这会让分母悄悄缩小,和漏判是同一种失效,所以必须逐条列出来
    console.log(`\n金标有标注、判官没判 ${unjudged.length} 条(未计入上面任何率):`);
    for (const u of unjudged) console.log(`  ${u.key}  人工 ${u.gold}`);
  }

  if (used.length < MIN_GOLD) {
    console.log(`\n⚠️ 金标只有 ${used.length} 条(< ${MIN_GOLD})—— 这个 TPR/TNR 的置信区间比臂间差异还宽,`);
    console.log('   只能当量级参考,**不能用来比较臂**。要进对比表先把金标标到 30 条以上。');
  }
  process.exit(0);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === realpathSync(fileURLToPath(import.meta.url))) main();
