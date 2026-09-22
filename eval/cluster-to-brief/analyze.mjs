/**
 * 多 epoch 汇总 —— 零 LLM、只读、不判定。
 *
 * 为什么要它:单次运行的读数只能当假设(CONTRACTS.md §6)。同一臂跑 k=3 次,同一簇同一轴的读数会飘;
 * 只报一次的数字看着精确,其实分不清「改动有效」和「这次运气好」。所以这里只报**均值与极差**,
 * 不报单点、也不给结论。
 *
 * 它读的是 verify.mjs 已经落盘的 out/verify-<epoch>-<split>.json —— 评分与生成分离(CONTRACTS.md §4),
 * 所以随时能重跑,不用重新生成简报,也不花一分钱。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   node analyze.mjs --arm=out/dr-write-mech --epochs=out/dr-write-mech-run1,out/dr-write-mech-run2,out/dr-write-mech-run3
 *   node analyze.mjs --arm=out/dr-write-mech-run1              # 只有一个 epoch 也能跑,会标 epochs=1
 *   node analyze.mjs --arm=... --epochs=... --split=all
 *
 *   --arm    臂的名字(给表头用)。省略 --epochs 时它同时当唯一一个 epoch 目录。
 *   --epochs 逗号分隔的 epoch 目录;每个目录要先跑过 verify.mjs,否则这里报缺哪一份。
 *
 * ── 三条不许破的规矩 ────────────────────────────────────────────────────
 *   1. 失败样本是一等状态:status=error(环境问题)与 missing(这个 epoch 根本没有这簇)
 *      **单独计数并列出**,绝不并进分母、也绝不悄悄少一个样本(CONTRACTS.md §2)。
 *   2. 读数为 null(例:verdict=not_a_single_event 时没有杂质率)算 n/a,不当 0。
 *   3. 不同 policyVersion 的 pass 不能混着数 —— 检测到就在表头喊出来。读数本身与 policy 无关,照常汇总。
 *
 * 退出码:0 正常出表;2 缺文件或参数不对(不是质量问题)。**本脚本永不因质量不合格而 exit 1** ——
 * 它只出事实,判定在 verify.mjs + policy.json。
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { OUT_ROOT } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  })
);
if (!args.arm) {
  console.error('用法: node analyze.mjs --arm=<臂目录或名字> [--epochs=<dirA,dirB,dirC>] [--split=dev|heldout|all]');
  process.exit(2);
}
const ARM = String(args.arm).replace(/\/$/, '');
const SPLIT = String(args.split ?? 'dev');
const EPOCH_DIRS = (args.epochs ? String(args.epochs).split(',') : [ARM])
  .map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

// 汇总的轴:**产出侧**的读数。input* 是输入事实(同一簇每个 epoch 都一样),放进来只是噪声。
// 顺序固定,方便两次出表逐行对照。
const AXES = [
  ['blocks', 0], ['sentences', 0],
  ['unresolvedSources', 0], ['sentencesWithoutSource', 0], ['markerLeaks', 0],
  ['truncatedSentences', 0], ['sourceQuoteMismatches', 0], ['sourceQuotesChecked', 0],
  ['mixedBlocks', 0],
  ['impureSentences', 0], ['impurityRate', 3], ['citedImpurityArticles', 0],
  ['sentencesWithUncitedNumbers', 0], ['sentencesWithUncitedQuotes', 0],
  ['redundantSentences', 0], ['redundancyRate', 3],
];

// ── 载入每个 epoch 的读数 ───────────────────────────────────────────────
const epochs = [];
const missingFiles = [];
for (const d of EPOCH_DIRS) {
  const f = `${OUT_ROOT}verify-${basename(d)}-${SPLIT}.json`;
  if (!existsSync(f)) { missingFiles.push(f); continue; }
  epochs.push({ dir: d, file: f, data: JSON.parse(readFileSync(f, 'utf8')) });
}
if (missingFiles.length) {
  console.error('缺读数文件(先对每个 epoch 跑 node verify.mjs --arm=<dir> --split=' + SPLIT + '):');
  for (const f of missingFiles) console.error(`  ${f}`);
  process.exit(2);
}
if (!epochs.length) { console.error('没有任何 epoch 可汇总'); process.exit(2); }

const policyVersions = [...new Set(epochs.map(e => `${e.data.policy?.file ?? '?'}@${e.data.policy?.version ?? '?'}`))];
const clusterIds = [...new Set(epochs.flatMap(e => Object.keys(e.data.results ?? {})))];

// ── 每簇的样本状态:ok / error(环境问题)/ missing(这个 epoch 没有这簇)────
const status = {};   // cid → { ok: [], error: [], missing: [] }
for (const cid of clusterIds) {
  const st = { ok: [], error: [], missing: [] };
  for (const e of epochs) {
    const r = e.data.results?.[cid];
    if (!r) { st.missing.push(basename(e.dir)); continue; }
    if ((r.envProblems ?? []).length) { st.error.push(basename(e.dir)); continue; }
    st.ok.push(basename(e.dir));
  }
  status[cid] = st;
}

const agg = (values) => {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return { n: nums.length, na: values.length - nums.length, mean: nums.reduce((a, b) => a + b, 0) / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
};
const fmt = (x, dp) => (dp ? x.toFixed(dp) : Number.isInteger(x) ? String(x) : x.toFixed(2));

// ── 出表 ────────────────────────────────────────────────────────────────
const armName = basename(ARM);
console.log(`\nepoch 汇总 · arm=${armName} · split=${SPLIT} · epochs=${epochs.length}`);
console.log(`epoch 目录: ${epochs.map(e => basename(e.dir)).join(', ')}`);
if (epochs.length === 1) console.log('⚠️ epochs=1 —— 单次运行的结论只能当假设(CONTRACTS.md §6)。');
if (policyVersions.length > 1) console.log(`⚠️ 这些 epoch 是按不同通过线判的(${policyVersions.join(' / ')})—— pass 不可混着数;读数与 policy 无关,照常汇总。`);
else console.log(`policy: ${policyVersions[0]}`);
console.log('⚠️ configHash 不同的运行不可比(CONTRACTS.md §2)。本脚本只看 out/ 里的读数,拿不到 config —— 混了不同配置的 epoch 它不会报错,自己别混。');

// 样本状态
const totalOk = clusterIds.reduce((n, cid) => n + status[cid].ok.length, 0);
const totalErr = clusterIds.reduce((n, cid) => n + status[cid].error.length, 0);
const totalMiss = clusterIds.reduce((n, cid) => n + status[cid].missing.length, 0);
console.log(`\n样本状态:ok ${totalOk} · error ${totalErr} · missing ${totalMiss}(共 ${clusterIds.length} 簇 × ${epochs.length} epoch = ${clusterIds.length * epochs.length})`);
for (const cid of clusterIds) {
  const st = status[cid];
  if (!st.error.length && !st.missing.length) continue;
  console.log(`  c${cid}: ` +
    (st.error.length ? `error ${st.error.length}(${st.error.join(',')}) ` : '') +
    (st.missing.length ? `missing ${st.missing.length}(${st.missing.join(',')})` : ''));
}
if (totalErr || totalMiss) console.log('  ↑ 这些样本不进任何均值。别把它们当 0,也别当通过。');

// 逐簇 × 逐轴
console.log(`\n── 逐簇 × 逐轴(均值 / 极差 / n=有读数的 epoch 数;n/a = 该 epoch 这一轴没有读数)`);
console.log('簇    轴                            均值      极差            n   n/a');
for (const cid of clusterIds) {
  const name = epochs.map(e => e.data.results?.[cid]?.name).find(Boolean) ?? '';
  const st = status[cid];
  console.log(`c${cid} ${name}${st.error.length || st.missing.length ? `  (可用 epoch ${st.ok.length}/${epochs.length})` : ''}`);
  for (const [axis, dp] of AXES) {
    const vals = st.ok.map(dirName => epochs.find(e => basename(e.dir) === dirName).data.results[cid].read?.[axis] ?? null);
    const a = agg(vals);
    if (!a) {
      // 一个读数都没有:分两种,要分清 —— 键根本不存在(例:未标注事件组的簇没有 mixedBlocks)
      // 与键存在但值是 null(例:判不可写的簇没有杂质率)。后者必须显式写 n/a,不许当 0 也不许消失。
      const present = st.ok.some(d => axis in (epochs.find(e => basename(e.dir) === d).data.results[cid].read ?? {}));
      if (present) console.log(`  ${String(axis).padEnd(30)} ${'n/a'.padStart(7)}   ${''.padEnd(14)} ${String(0).padStart(2)}  ${vals.length}`);
      continue;
    }
    const range = a.min === a.max ? `${fmt(a.min, dp)}` : `${fmt(a.min, dp)}–${fmt(a.max, dp)}`;
    console.log(`  ${String(axis).padEnd(30)} ${fmt(a.mean, dp || (Number.isInteger(a.mean) ? 0 : 2)).padStart(7)}   ${range.padEnd(14)} ${String(a.n).padStart(2)}  ${a.na || ''}`);
  }
  // 事件混写是离散状态,不适合求均值:逐 epoch 列出来
  const mixStates = st.ok.map(d => epochs.find(e => basename(e.dir) === d).data.results[cid].read?.eventMixingStatus ?? '—');
  if (mixStates.length) console.log(`  ${'eventMixingStatus'.padEnd(30)} ${mixStates.join(' ')}`);
  // pass 是判定不是事实,所以单列一行并写明按哪条线判的
  const passes = st.ok.map(d => epochs.find(e => basename(e.dir) === d).data.results[cid].pass);
  console.log(`  ${'pass(按 policy)'.padEnd(30)} ${passes.filter(Boolean).length}/${passes.length}`);
}

// 逐轴合计:跨簇跨 epoch。簇之间规模差 20 倍,合计只当粗读
console.log(`\n── 逐轴合计(跨簇跨 epoch,簇规模差 20 倍,只当粗读)`);
console.log('轴                             均值      极差            n');
for (const [axis, dp] of AXES) {
  const vals = clusterIds.flatMap(cid => status[cid].ok.map(d => epochs.find(e => basename(e.dir) === d).data.results[cid].read?.[axis] ?? null));
  const a = agg(vals);
  if (!a) continue;
  const range = a.min === a.max ? `${fmt(a.min, dp)}` : `${fmt(a.min, dp)}–${fmt(a.max, dp)}`;
  console.log(`${String(axis).padEnd(30)} ${fmt(a.mean, dp || 2).padStart(7)}   ${range.padEnd(14)} ${String(a.n).padStart(2)}`);
}
console.log('');
