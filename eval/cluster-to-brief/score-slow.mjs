/**
 * 慢档阶段 C:读 codex 写回的判定,算覆盖与正确性、套通过线。**零 LLM、纯计算。**
 *
 * 通过线沿用 block-writer/RUBRIC.md 第五节,只把核心层换成相对口径:
 *   1. 致命错 = 0        (一条即否)
 *   2. 一般硬错 ≤ 1
 *   3. 核心层覆盖 ≥ 2/3
 * 失真是软线(超了只报不否)。这条线不是拍高的:簇 82 的 r3 稿曾达到致命 0 / 硬错 0 / 核心 4/6。
 *
 * 2026-09-19 新增两个只报不设门的读数:`citation`(被引那句够不够)与 `pack`(检索缺口、
 * 剥掉的行内引用号)。它们不进通过线 —— 进了就又变成一道卡引用行为的门。
 *
 * 用法:
 *   node score-slow.mjs --arm=out/arm-a [--split=dev|heldout|all] [--cluster=N]
 *
 * 退出码: 0 全部通过;1 有簇不合格;2 环境问题(缺判定、判定不完整)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { loadExpectations, gradedEventIds, FIX } from './lib.mjs';
import { scorerSrcId, packId } from './scorer-id.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
if (!args.arm) { console.error('用法: node score-slow.mjs --arm=<原型输出目录> [--split=...] [--cluster=N]'); process.exit(2); }

const ARM = String(args.arm).replace(/\/$/, '');
const SPLIT = String(args.split ?? 'dev');
const EXP = loadExpectations();
const COVERAGE_RATIO = EXP.meta.coverageRatio ?? 0.667;
const CK_DIR = `${FIX}checklists`;

let targets = Object.entries(EXP.clusters);
if (args.cluster) targets = targets.filter(([c]) => c === String(args.cluster));
else if (SPLIT !== 'all') targets = targets.filter(([, e]) => e.split === SPLIT);
if (!targets.length) { console.error('没有匹配的簇'); process.exit(2); }

const results = {};
let failed = 0, envBad = 0;

for (const [cid, exp] of targets) {
  const fail = [], env = [], read = {};
  const vF = `${ARM}/verdict-c${cid}.json`;
  const ckF = `${CK_DIR}/c${cid}.json`;

  const metaF = `${ARM}/judge-pack-c${cid}.meta.json`;

  if (!existsSync(ckF)) { env.push(`缺事件清单 ${ckF}`); }
  if (!existsSync(vF)) { env.push(`缺判定 ${vF} —— 先跑 build-judge-pack.mjs 再让判官判`); }
  // ── 尺的身份闸 ────────────────────────────────────────────────────────
  // 判定只对**当初生成它的那个判定包**有效。包的指纹与现在的 scorer 对不上,就说明这把尺
  // 在判完之后改过 —— 此时算出来的任何数都是新旧混用,而混用不会报错,只会给出一个看着正常的值。
  if (!existsSync(metaF)) {
    env.push(`缺判定包指纹 ${metaF} —— 先跑 build-judge-pack.mjs`);
  } else {
    const pm = JSON.parse(readFileSync(metaF, 'utf8'));
    const packF = `${ARM}/judge-pack-c${cid}.md`;
    if (!pm.packId) {
      env.push('判定包没有 packId(建于指纹机制之前)—— 重跑 build-judge-pack.mjs');
    } else if (existsSync(packF)) {
      const now = packId(readFileSync(packF, 'utf8'));
      if (now !== pm.packId) env.push(`判定包被改过:实际内容 ${now} ≠ 指纹 ${pm.packId} —— 重跑 build-judge-pack.mjs`);
    }
    // 包没变但尺的源码变了 → 包是旧的,必须重建(重建后包若真变了,旧判定会被自动隔离)
    if (pm.scorerSrcId && pm.scorerSrcId !== scorerSrcId()) {
      env.push(`尺改过但判定包没重建:包 ${pm.scorerSrcId} ≠ 当前 ${scorerSrcId()} —— 先跑 build-judge-pack.mjs`);
    }
  }
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  const v = JSON.parse(readFileSync(vF, 'utf8'));
  const ck = JSON.parse(readFileSync(ckF, 'utf8'));

  // 判不可写的簇:**超出本 scorer 的范围**,不是「通过」。
  // Inspect AI 的口径:超出 scorer 范围应当不产生 score 条目(return None),
  // 而不是记一个满分。早先写成 pass: true 会虚高通过数 —— c37 上有三个臂判不可写,
  // 它们在慢档其实一条都没被判过。通过与否由快档的二元判据决定。
  if (v.skipped) {
    results[cid] = { name: exp.name, split: exp.split, pass: null, scored: false, read: { skipped: v.skipped }, failures: [], envProblems: [] };
    continue;
  }

  // 覆盖的新格式:判官**只列命中的**,没命中的由这里用「判定范围减命中」算出来。
  // 旧格式每条事件都要吐一行(含大量 covered:false 的零信息行),620 行里一大半是在写「没有」。
  // 代价:旧格式能断言「判满了没」,能抓住判到一半就停;新格式靠 examined 这个自报数,
  // 抓得住截断、抓不住敷衍 —— 但旧格式其实也抓不住敷衍(全填 false 即可)。
  const graded = gradedEventIds(ck);
  const gradedSet = new Set(graded);
  const covRaw = v.coverage;
  const covered = Array.isArray(covRaw?.covered) ? covRaw.covered : Array.isArray(covRaw) ? covRaw.filter(c => c.covered) : [];
  const examined = Number.isInteger(covRaw?.examined) ? covRaw.examined : (Array.isArray(covRaw) ? covRaw.length : null);
  const claims = Array.isArray(v.claims) ? v.claims : [];
  if (covRaw === undefined) env.push('缺 coverage —— 判官还没判,或判定没写回');
  if (!claims.length) env.push('claims 为空 —— 判官还没判,或判定没写回');
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  if (examined !== graded.length) env.push(`coverage.examined=${examined} ≠ 判定范围 ${graded.length} 条 —— 判官没看完或口径不一致`);
  const ids = covered.map(c => c.eventId);
  const badIds = ids.filter(i => !gradedSet.has(i));
  if (badIds.length) env.push(`coverage 里有不在判定范围内的 eventId: ${badIds.slice(0, 5).join(',')}(尾层不判)`);
  const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dupIds.length) env.push(`coverage 里有重复 eventId: ${[...new Set(dupIds)].slice(0, 5).join(',')}`);
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  // ── 覆盖,按支持篇数分层 ──────────────────────────────────────────────
  const coreMin = ck.tiers.coreMin;
  const hitSet = new Set(ids);
  const byTier = { core: [0, 0], mid: [0, 0] };
  for (const id of graded) {
    const t = ck.events[id - 1].nArticles >= coreMin ? 'core' : 'mid';
    byTier[t][1]++;
    if (hitSet.has(id)) byTier[t][0]++;
  }
  read.coreMin = coreMin;
  read.coverage = Object.fromEntries(Object.entries(byTier).map(([t, [hit, of]]) => [t, { hit, of, pct: of ? +((100 * hit) / of).toFixed(1) : null }]));
  read.coverage.tail = { hit: null, of: ck.events.length - graded.length, pct: null, note: '尾层不判' };
  read.coverageAll = { hit: hitSet.size, of: graded.length, note: '分母是判定范围(核心层+次层),不含尾层' };

  // ── 正确性 ──────────────────────────────────────────────────────────
  const tally = { fatal: 0, hard: 0, distortion: 0, ok: 0, other: 0 };
  const examples = { fatal: [], hard: [] };
  for (const c of claims) {
    const t = ['fatal', 'hard', 'distortion', 'ok'].includes(c.tier) ? c.tier : 'other';
    tally[t]++;
    if ((t === 'fatal' || t === 'hard') && examples[t].length < 3) {
      examples[t].push(`[${c.sentenceRef}] ${String(c.claim ?? '').slice(0, 70)} — ${String(c.why ?? '').slice(0, 60)}`);
    }
  }
  read.claims = claims.length;
  read.errors = tally;

  // ── 引用质量(新增一维,单列,不进通过线)────────────────────────────────
  // 为什么单列:旧的 `hard ≤ 1` 这道门实际在卡引用质量而不是事实正确性 —— 判官只看成稿引的
  // 那一句,一句话有多个成分时缺的那半常在紧邻的下一句里。c1 实测真没依据 0 条、引错句子 9 条(18%),
  // 这 9 条在旧四档里全被算进错误,于是"引得更宽"比"写得更准"更容易过门。
  // 2026-09-19 起证据改由脚本全簇检索(与成稿引了谁无关),这一维只回答"被引那句本身够不够"。
  const cited = claims.filter(c => typeof c.citedSentenceSuffices === 'boolean');
  read.citation = {
    judged: cited.length,
    missing: claims.length - cited.length,
    insufficient: cited.filter(c => c.citedSentenceSuffices === false).length,
    pct: cited.length ? +((100 * cited.filter(c => c.citedSentenceSuffices === false).length) / cited.length).toFixed(1) : null,
  };
  if (read.citation.missing) env.push(`${read.citation.missing}/${claims.length} 条 claim 缺 citedSentenceSuffices —— 补齐再算`);

  if (Array.isArray(v.packDefects) && v.packDefects.length) read.packDefects = v.packDefects;

  // 判定包的机械读数(检索缺口、剥掉的行内引用号)。检索缺口大意味着"判不出来"被记成了
  // 正确性问题 —— 它要跟正确性读数摆在一起看,否则会把检索的锅算到写作头上。
  if (existsSync(metaF)) {
    const pm = JSON.parse(readFileSync(metaF, 'utf8'));
    read.pack = {
      topK: pm.topK,
      citedNotInEvidence: pm.citedNotInEvidence,
      citedSources: pm.citedSources,
      citedNotInEvidencePct: pm.citedSources ? +((100 * pm.citedNotInEvidence) / pm.citedSources).toFixed(1) : null,
      inlineCitationsStripped: pm.inlineCitationsStripped,
      sentencesWithoutSources: pm.sentencesWithoutSources,
      citedUnresolvable: pm.citedUnresolvable,
    };
  }
  const verdictTally = {};
  for (const c of claims) verdictTally[c.verdict ?? 'missing'] = (verdictTally[c.verdict ?? 'missing'] ?? 0) + 1;
  read.verdicts = verdictTally;
  if (tally.other) env.push(`${tally.other} 条 claim 的 tier 不在 fatal/hard/distortion/ok 内`);

  // ── 通过线 ──────────────────────────────────────────────────────────
  const maxFatal = exp.pass?.fatalErrors ?? 0;
  const maxHard = exp.pass?.hardErrors ?? 1;
  if (tally.fatal > maxFatal) fail.push(`致命错 ${tally.fatal} > ${maxFatal}: ${examples.fatal.join(' | ')}`);
  if (tally.hard > maxHard) fail.push(`一般硬错 ${tally.hard} > ${maxHard}: ${examples.hard.join(' | ')}`);

  const core = read.coverage.core;
  if (core.of === 0) {
    // 核心层为空不算不合格,但要显式说明:这个簇的通过线只由正确性决定
    read.note = `核心层为空(没有事件达到 ≥${coreMin} 篇支持),覆盖那一条无从计算`;
  } else if (core.pct / 100 < COVERAGE_RATIO) {
    fail.push(`核心层覆盖 ${core.hit}/${core.of} = ${core.pct}% < ${(COVERAGE_RATIO * 100).toFixed(1)}%`);
  }
  if (tally.distortion > 2) read.softLine = `失真 ${tally.distortion} 条(软线 ≤2,超了只报不否)`;

  // envProblems 这里写死成 [] 会把正确性段之后 push 的环境问题**静默丢掉**
  // (`tally.other`、缺 citedSentenceSuffices 都在那之后)。改成回传 env 并计数。
  results[cid] = { name: exp.name, form: exp.form, split: exp.split, pass: fail.length === 0 && env.length === 0, read, failures: fail, envProblems: env };
  if (env.length) envBad++;
  else if (fail.length) failed++;
}

// ── 报告 ────────────────────────────────────────────────────────────────
const armName = basename(ARM);
console.log(`\n慢档 · arm=${armName} · split=${SPLIT} · ${targets.length} 簇\n`);
console.log('簇    名称            判定   核心层覆盖      次层        致命 硬错 失真  引用不足  检索缺口');
for (const [cid, r] of Object.entries(results)) {
  const d = r.read;
  if (d.skipped) { console.log(`c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)}  ⊘    ${d.skipped}(超出慢档范围,不计入通过数)`); continue; }
  if (r.envProblems.length) { console.log(`c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} 环境`); continue; }
  const c = d.coverage?.core, m = d.coverage?.mid, e = d.errors ?? {};
  console.log(
    `c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} ${r.pass ? ' ✅ ' : ' ❌ '}  ` +
    `${c ? `${c.hit}/${c.of} (${c.pct ?? '-'}%)`.padEnd(15) : '—'.padEnd(15)} ` +
    `${m ? `${m.hit}/${m.of}`.padEnd(11) : '—'.padEnd(11)} ` +
    `${String(e.fatal ?? '-').padStart(4)} ${String(e.hard ?? '-').padStart(4)} ${String(e.distortion ?? '-').padStart(4)}  ` +
    `${(d.citation ? `${d.citation.insufficient}/${d.citation.judged}` : '—').padStart(8)}  ` +
    `${(d.pack ? `${d.pack.citedNotInEvidence}/${d.pack.citedSources}` : '—').padStart(8)}`
  );
}

for (const [cid, r] of Object.entries(results)) {
  if (!r.envProblems.length && !r.failures.length && !r.read.note && !r.read.softLine && !r.read.packDefects) continue;
  console.log(`\n── c${cid} ${r.name}`);
  for (const e of r.envProblems) console.log(`  [环境] ${e}`);
  for (const e of r.failures) console.log(`  [不合格] ${e}`);
  if (r.read.note) console.log(`  [说明] ${r.read.note}`);
  if (r.read.softLine) console.log(`  [软线] ${r.read.softLine}`);
  for (const d of r.read.packDefects ?? []) console.log(`  [判定包缺陷] ${d}`);
}

mkdirSync(`${HERE}out`, { recursive: true });
const outF = `${HERE}out/slow-${armName}-${SPLIT}.json`;
writeFileSync(outF, `${JSON.stringify({ arm: armName, split: SPLIT, at: new Date().toISOString(), coverageRatio: COVERAGE_RATIO, results }, null, 1)}\n`);
console.log(`\n读数落盘: ${outF}`);
console.log('注:事实正确性由 codex 判(不是 LLM 自判),但臂也由 codex 写 → self-preference 风险仍在,**只能臂间相对比较,不能当绝对门**。');
console.log('注:归属类错误(主体/日期搬错)召回很低 —— 判定包写死「判不准标 ok 不硬猜」,所以硬错数是**下界**。自然错误实测 actor 占 60%,正是这类。');
console.log('注:事件清单由 glm-flash 抽、未经人工核 → 覆盖率的绝对值打折读。');
console.log('注:「引用不足」= citedSentenceSuffices=false 的 claim 数,只报不设门 —— 它量的是引用质量,不是事实正确性。');
console.log('注:判定包带 scorer 指纹,尺一改旧判定自动作废(exit 2)—— 这是 CONTEXT.md 那条「判据变了旧读数作废」的机械形态。');
console.log('注:「检索缺口」= 成稿引的句子没进 top-k 检索证据的条数。这个数大时,正确性读数里混着"判官没看到"而不是"写错了"。');

const scoredN = Object.values(results).filter(r => r.scored !== false && !r.envProblems.length).length;
const skippedN = Object.values(results).filter(r => r.scored === false).length;
if (envBad) { console.error(`\n环境问题 ${envBad} 簇 —— 先补齐判定,不是质量问题`); process.exit(2); }
if (failed) { console.error(`\n不合格 ${failed}/${scoredN} 簇(另有 ${skippedN} 簇超出慢档范围)`); process.exit(1); }
console.log(`\n✅ ${scoredN}/${scoredN} 簇通过慢档${skippedN ? `(另有 ${skippedN} 簇判不可写,超出慢档范围,不计入)` : ''}`);
