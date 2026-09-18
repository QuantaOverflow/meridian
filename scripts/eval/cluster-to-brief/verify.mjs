/**
 * 快档 verifier —— 零 LLM、秒级、退出码表判定,给 codex 自主迭代用。
 *
 * 它只判**机械可判**的东西:schema 合规、出处能不能解析、杂质率、数字有没有出处、
 * 以及二元判据(题材袋该不该被写成一块)。覆盖率与事实正确性属于慢档,要 LLM,不在这里。
 *
 * 为什么快档值得单独存在:这轮诊断出的主缺陷正是杂质(委内瑞拉/尼日尔混进 houthi 块),
 * 而它完全不需要 LLM 就能量——前提是原型输出每句的出处。
 *
 * ── 原型的输出契约 ──────────────────────────────────────────────────────
 * 每簇一个文件:<armDir>/c<clusterId>.json
 *
 *   {
 *     "cluster": 36,
 *     "verdict": "written" | "not_a_single_event",
 *     "reason": "...",                       // verdict=not_a_single_event 时必填
 *     "blocks": [                            // verdict=written 时至少 1 块
 *       {
 *         "title": "...",
 *         "sentences": [
 *           { "text": "...", "sources": [ { "articleId": 1009385, "sentence": 12 } ] }
 *         ]
 *       }
 *     ]
 *   }
 *
 * 出处是强制的:三项判据里两项靠它。它对内部架构不构成限制——拆几步、传什么表示,都能标出处。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   node verify.mjs --arm=out/arm-a                 # 跑 dev 五簇
 *   node verify.mjs --arm=out/arm-a --split=heldout # 跑 heldout 两簇
 *   node verify.mjs --arm=out/arm-a --cluster=36    # 只跑一簇
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────
 *   0  全部簇通过
 *   1  有簇未通过(逐项失败原因会打出来,并落 out/verify-<arm>.json)
 *   2  配置或数据问题(缺 fixture、缺输出文件、schema 不合规)——不是质量问题,先修环境
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { loadExpectations, loadCluster, sentenceOf, numbersIn, proseSentences } from './lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  })
);
if (!args.arm) { console.error('用法: node verify.mjs --arm=<原型输出目录> [--split=dev|heldout|all] [--cluster=N]'); process.exit(2); }

const ARM = String(args.arm).replace(/\/$/, '');
const SPLIT = String(args.split ?? 'dev');
const EXP = loadExpectations();

let targets = Object.entries(EXP.clusters);
if (args.cluster) targets = targets.filter(([cid]) => cid === String(args.cluster));
else if (SPLIT !== 'all') targets = targets.filter(([, e]) => e.split === SPLIT);
if (!targets.length) { console.error(`没有匹配的簇(split=${SPLIT} cluster=${args.cluster ?? '-'})`); process.exit(2); }

// ── 单簇判定 ────────────────────────────────────────────────────────────
function verifyCluster(cid, exp) {
  const fail = [];   // 判定失败(质量问题 → exit 1)
  const envFail = [];// 环境问题(缺文件/schema → exit 2)
  const read = {};   // 读数,无论过不过都报

  const f = `${ARM}/c${cid}.json`;
  if (!existsSync(f)) { envFail.push(`缺输出文件 ${f}`); return { fail, envFail, read }; }

  let out;
  try { out = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { envFail.push(`${f} 不是合法 JSON: ${e.message}`); return { fail, envFail, read }; }

  const cluster = loadCluster(cid);
  const impurities = new Set(exp.impurities ?? []);
  read.inputArticles = cluster.articles.length;
  read.inputImpurities = impurities.size;
  read.inputImpurityRate = +(impurities.size / cluster.articles.length).toFixed(3);

  // —— schema ——
  if (out.verdict !== 'written' && out.verdict !== 'not_a_single_event') {
    envFail.push(`verdict 必须是 written 或 not_a_single_event,拿到 ${JSON.stringify(out.verdict)}`);
    return { fail, envFail, read };
  }
  if (out.verdict === 'not_a_single_event' && !String(out.reason ?? '').trim()) {
    envFail.push('verdict=not_a_single_event 时 reason 必填');
  }
  const blocks = Array.isArray(out.blocks) ? out.blocks : [];
  if (out.verdict === 'written' && !blocks.length) envFail.push('verdict=written 但 blocks 为空');
  read.verdict = out.verdict;
  read.blocks = blocks.length;

  // —— 二元判据:题材袋/多数派错位该拆或该拒 ——
  if (exp.pass?.requireSplitOrReject) {
    const ok = out.verdict === 'not_a_single_event' || blocks.length >= (exp.minBlocks ?? 2);
    if (!ok) {
      fail.push(
        `二元判据不过:本簇形态为 ${exp.form},期望「拆成 ≥${exp.minBlocks ?? 2} 块」或「判 not_a_single_event」,` +
        `实际 verdict=${out.verdict} blocks=${blocks.length}。无论正文写得多好,写成一块即失败`
      );
    }
  }

  // —— 逐句:出处解析、杂质、数字 ——
  const allSents = blocks.flatMap(b => (Array.isArray(b.sentences) ? b.sentences : []));
  read.sentences = allSents.length;
  if (out.verdict === 'written' && allSents.length === 0 && !envFail.length) {
    envFail.push('blocks 里没有任何 sentences');
  }

  let unresolved = 0, noSource = 0, impureSents = 0, numbersMissing = 0;
  const impureExamples = [], unresolvedExamples = [], numberExamples = [];
  const citedImpurityIds = new Set();

  for (const s of allSents) {
    const text = String(s?.text ?? '');
    const srcs = Array.isArray(s?.sources) ? s.sources : [];
    if (!srcs.length) {
      noSource++;
      if (unresolvedExamples.length < 3) unresolvedExamples.push(`无出处: "${text.slice(0, 60)}"`);
      continue;
    }
    const srcTexts = [];
    let sentImpure = false;
    for (const sr of srcs) {
      const t = sentenceOf(cluster, sr?.articleId, sr?.sentence);
      if (t === undefined) {
        unresolved++;
        if (unresolvedExamples.length < 3) unresolvedExamples.push(`解析不到 ${sr?.articleId}:${sr?.sentence}`);
      } else srcTexts.push(t);
      if (impurities.has(sr?.articleId)) { sentImpure = true; citedImpurityIds.add(sr.articleId); }
    }
    if (sentImpure) {
      impureSents++;
      if (impureExamples.length < 4) impureExamples.push(`"${text.slice(0, 70)}" ← 引了杂质文章`);
    }
    // 数字核对:句中非日期数字必须出现在所引原句里
    const srcNums = numbersIn(srcTexts.join(' '));
    const miss = [...numbersIn(text)].filter(n => !srcNums.has(n));
    if (miss.length) {
      numbersMissing++;
      if (numberExamples.length < 3) numberExamples.push(`"${text.slice(0, 55)}" 缺 [${miss.slice(0, 4)}]`);
    }
  }

  read.unresolvedSources = unresolved;
  read.sentencesWithoutSource = noSource;
  read.impureSentences = impureSents;
  read.impurityRate = allSents.length ? +(impureSents / allSents.length).toFixed(3) : null;
  read.citedImpurityArticles = citedImpurityIds.size;
  read.sentencesWithUncitedNumbers = numbersMissing;

  // —— 硬判据:出处必须全部可解析 ——
  if (unresolved > 0) fail.push(`出处解析失败 ${unresolved} 处(编号越界或文章不在簇内): ${unresolvedExamples.join(' | ')}`);
  if (noSource > 0) fail.push(`${noSource} 句没有任何出处 —— 出处是契约的强制项: ${unresolvedExamples.join(' | ')}`);

  // —— 杂质率 ——
  const cap = out.verdict === 'written'
    ? (exp.pass?.impurityRateMax ?? exp.pass?.ifWrittenImpurityRateMax)
    : undefined;
  if (cap !== undefined && read.impurityRate !== null) {
    // impurityRateStrict:必须**严格低于**输入杂质率 —— 选材这一步存在的意义就是筛
    const bad = exp.pass?.impurityRateStrict ? read.impurityRate >= cap : read.impurityRate > cap;
    if (bad) {
      fail.push(
        `杂质率 ${(read.impurityRate * 100).toFixed(1)}% ${exp.pass?.impurityRateStrict ? '未严格低于' : '超过'} ` +
        `上限 ${(cap * 100).toFixed(1)}%(输入杂质率 ${(read.inputImpurityRate * 100).toFixed(1)}%)` +
        (impureExamples.length ? ` — 例: ${impureExamples.join(' | ')}` : '')
      );
    }
  }

  // —— 篇幅下限(只对期望写成一块的簇)——
  if (exp.pass?.minSentences && out.verdict === 'written' && allSents.length < exp.pass.minSentences) {
    fail.push(`只写了 ${allSents.length} 句,低于下限 ${exp.pass.minSentences}(干净簇写太薄同样不合格)`);
  }

  // —— 数字只报读数,不设门 ——
  // 归属类错误(主体/日期搬错)这把尺看不见,所以数字缺出处只当信号,判定留给慢档。
  if (numbersMissing > 0) read.numberExamples = numberExamples;

  return { fail, envFail, read };
}

// ── 跑 ──────────────────────────────────────────────────────────────────
const results = {};
let failedClusters = 0, envProblems = 0;

for (const [cid, exp] of targets) {
  const { fail, envFail, read } = verifyCluster(cid, exp);
  results[cid] = { name: exp.name, form: exp.form, split: exp.split, pass: fail.length === 0 && envFail.length === 0, read, failures: fail, envProblems: envFail };
  if (envFail.length) envProblems++;
  else if (fail.length) failedClusters++;
}

// ── 报告 ────────────────────────────────────────────────────────────────
const armName = basename(ARM);
console.log(`\n快档 verifier · arm=${armName} · split=${SPLIT} · ${targets.length} 簇\n`);
console.log('簇    名称            形态                  判定   句数  杂质率(输入)      出处问题');
for (const [cid, r] of Object.entries(results)) {
  const d = r.read;
  const imp = d.impurityRate === null || d.impurityRate === undefined
    ? '   —        '
    : `${(d.impurityRate * 100).toFixed(1)}% (${((d.inputImpurityRate ?? 0) * 100).toFixed(0)}%)`.padEnd(12);
  const srcIssue = (d.unresolvedSources ?? 0) + (d.sentencesWithoutSource ?? 0);
  console.log(
    `c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} ${String(r.form).padEnd(21)} ` +
    `${r.envProblems.length ? '环境' : r.pass ? ' ✅ ' : ' ❌ '}  ${String(d.sentences ?? '-').padStart(4)}  ${imp}  ${srcIssue}`
  );
}

for (const [cid, r] of Object.entries(results)) {
  if (!r.envProblems.length && !r.failures.length) continue;
  console.log(`\n── c${cid} ${r.name}`);
  for (const e of r.envProblems) console.log(`  [环境] ${e}`);
  for (const e of r.failures) console.log(`  [不合格] ${e}`);
  if (r.read.numberExamples) console.log(`  [读数] 数字无出处 ${r.read.sentencesWithUncitedNumbers} 句: ${r.read.numberExamples.join(' | ')}`);
}

mkdirSync(`${HERE}out`, { recursive: true });
const outFile = `${HERE}out/verify-${armName}-${SPLIT}.json`;
writeFileSync(outFile, `${JSON.stringify({ arm: armName, split: SPLIT, at: new Date().toISOString(), results }, null, 1)}\n`);

console.log(`\n读数落盘: ${outFile}`);
console.log('注:这是快档 —— 覆盖率与事实正确性要慢档(LLM)才有,本次未判。');
console.log('注:杂质标注只依据标题、未读正文,所以杂质率是**下界**。');

if (envProblems) { console.error(`\n环境问题 ${envProblems} 簇 —— 先修环境,不是质量问题`); process.exit(2); }
if (failedClusters) { console.error(`\n不合格 ${failedClusters}/${targets.length} 簇`); process.exit(1); }
console.log(`\n✅ ${targets.length}/${targets.length} 簇通过快档`);
