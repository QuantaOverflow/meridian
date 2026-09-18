/**
 * 慢档阶段 C:读 codex 写回的判定,算覆盖与正确性、套通过线。**零 LLM、纯计算。**
 *
 * 通过线沿用 block-writer/RUBRIC.md 第五节,只把核心层换成相对口径:
 *   1. 致命错 = 0        (一条即否)
 *   2. 一般硬错 ≤ 1
 *   3. 核心层覆盖 ≥ 2/3
 * 失真是软线(超了只报不否)。这条线不是拍高的:簇 82 的 r3 稿曾达到致命 0 / 硬错 0 / 核心 4/6。
 *
 * 用法:
 *   node score-slow.mjs --arm=out/arm-a [--split=dev|heldout|all] [--cluster=N]
 *
 * 退出码: 0 全部通过;1 有簇不合格;2 环境问题(缺判定、判定不完整)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { loadExpectations, FIX } from './lib.mjs';

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
/**
 * 清单目录。默认读 fixtures/checklists/,`--checklists=<dir>` 可覆盖。
 * 加这个开关只为一个用途:自测要喂伪造的清单去碰通过线的每条边界,而它**不能写进真清单目录**
 * —— 一个会覆盖真基准的自测,比没有自测更危险。
 */
const CK_DIR = String(args.checklists ?? `${FIX}checklists`).replace(/\/$/, '');

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

  if (!existsSync(ckF)) { env.push(`缺事件清单 ${ckF}`); }
  if (!existsSync(vF)) { env.push(`缺判定 ${vF} —— 先跑 build-judge-pack.mjs 再让 codex 判`); }
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  const v = JSON.parse(readFileSync(vF, 'utf8'));
  const ck = JSON.parse(readFileSync(ckF, 'utf8'));

  // 判不可写的簇:慢档不判正文(没有正文),通过与否由快档的二元判据决定
  if (v.skipped) {
    results[cid] = { name: exp.name, split: exp.split, pass: true, read: { skipped: v.skipped }, failures: [], envProblems: [] };
    continue;
  }

  const cov = Array.isArray(v.coverage) ? v.coverage : [];
  const claims = Array.isArray(v.claims) ? v.claims : [];
  if (!cov.length) env.push('coverage 为空 —— codex 还没判,或判定没写回');
  if (!claims.length) env.push('claims 为空 —— codex 还没判,或判定没写回');
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  // 卫生:覆盖判定必须盖满清单,缺了会让覆盖率虚高(分母被悄悄缩小)
  const judged = new Set(cov.map(c => c.eventId));
  const missingIds = ck.events.map((_, i) => i + 1).filter(i => !judged.has(i));
  if (missingIds.length) env.push(`coverage 漏判 ${missingIds.length}/${ck.events.length} 条(缺 eventId ${missingIds.slice(0, 8).join(',')}…)—— 补齐再算,否则覆盖率虚高`);
  const badIds = cov.map(c => c.eventId).filter(i => !Number.isInteger(i) || i < 1 || i > ck.events.length);
  if (badIds.length) env.push(`coverage 里有越界 eventId: ${badIds.slice(0, 5).join(',')}`);
  if (env.length) { results[cid] = { name: exp.name, split: exp.split, pass: false, read, failures: fail, envProblems: env }; envBad++; continue; }

  // ── 覆盖,按支持篇数分层 ──────────────────────────────────────────────
  const coreMin = ck.tiers.coreMin;
  const tierOf = e => (e.nArticles >= coreMin ? 'core' : e.nArticles >= 2 ? 'mid' : 'tail');
  const byTier = { core: [0, 0], mid: [0, 0], tail: [0, 0] };
  for (const c of cov) {
    const e = ck.events[c.eventId - 1];
    const t = tierOf(e);
    byTier[t][1]++;
    if (c.covered) byTier[t][0]++;
  }
  read.coreMin = coreMin;
  read.coverage = Object.fromEntries(Object.entries(byTier).map(([t, [hit, of]]) => [t, { hit, of, pct: of ? +((100 * hit) / of).toFixed(1) : null }]));
  read.coverageAll = { hit: cov.filter(c => c.covered).length, of: cov.length };

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

  results[cid] = { name: exp.name, form: exp.form, split: exp.split, pass: fail.length === 0, read, failures: fail, envProblems: [] };
  if (fail.length) failed++;
}

// ── 报告 ────────────────────────────────────────────────────────────────
const armName = basename(ARM);
console.log(`\n慢档 · arm=${armName} · split=${SPLIT} · ${targets.length} 簇\n`);
console.log('簇    名称            判定   核心层覆盖      次层        致命 硬错 失真');
for (const [cid, r] of Object.entries(results)) {
  const d = r.read;
  if (d.skipped) { console.log(`c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)}  ⊘    ${d.skipped}`); continue; }
  if (r.envProblems.length) { console.log(`c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} 环境`); continue; }
  const c = d.coverage?.core, m = d.coverage?.mid, e = d.errors ?? {};
  console.log(
    `c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} ${r.pass ? ' ✅ ' : ' ❌ '}  ` +
    `${c ? `${c.hit}/${c.of} (${c.pct ?? '-'}%)`.padEnd(15) : '—'.padEnd(15)} ` +
    `${m ? `${m.hit}/${m.of}`.padEnd(11) : '—'.padEnd(11)} ` +
    `${String(e.fatal ?? '-').padStart(4)} ${String(e.hard ?? '-').padStart(4)} ${String(e.distortion ?? '-').padStart(4)}`
  );
}

for (const [cid, r] of Object.entries(results)) {
  if (!r.envProblems.length && !r.failures.length && !r.read.note && !r.read.softLine) continue;
  console.log(`\n── c${cid} ${r.name}`);
  for (const e of r.envProblems) console.log(`  [环境] ${e}`);
  for (const e of r.failures) console.log(`  [不合格] ${e}`);
  if (r.read.note) console.log(`  [说明] ${r.read.note}`);
  if (r.read.softLine) console.log(`  [软线] ${r.read.softLine}`);
}

mkdirSync(`${HERE}out`, { recursive: true });
const outF = `${HERE}out/slow-${armName}-${SPLIT}.json`;
writeFileSync(outF, `${JSON.stringify({ arm: armName, split: SPLIT, at: new Date().toISOString(), coverageRatio: COVERAGE_RATIO, results }, null, 1)}\n`);
console.log(`\n读数落盘: ${outF}`);
console.log('注:事实正确性由 codex 判(不是 LLM 自判),但臂也由 codex 写 → self-preference 风险仍在,**只能臂间相对比较,不能当绝对门**。');
console.log('注:归属类错误(主体/日期搬错)召回很低 —— 判定包写死「判不准标 ok 不硬猜」,所以硬错数是**下界**。自然错误实测 actor 占 60%,正是这类。');
console.log('注:事件清单由 glm-flash 抽、未经人工核 → 覆盖率的绝对值打折读。');

if (envBad) { console.error(`\n环境问题 ${envBad} 簇 —— 先补齐判定,不是质量问题`); process.exit(2); }
if (failed) { console.error(`\n不合格 ${failed}/${targets.length} 簇`); process.exit(1); }
console.log(`\n✅ ${targets.length}/${targets.length} 簇通过慢档`);
