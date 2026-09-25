/**
 * 两份独立判定的一致性。**零 LLM、纯计算。** 这是改 scorer 时唯一的验收仪器。
 *
 * 为什么需要它:scorer 改动的目标是「判官换一次判,读数别翻」。没有这个脚本,
 * 一致性只能靠人眼比两份 JSON —— 上一轮正是这样比的,比一次要十几分钟,且比不出集合重合度。
 *
 * 用法:
 *   node compare-verdicts.mjs <verdictA.json> <verdictB.json>
 *
 * 口径(与 2026-09-19 原型那批读数同口径,好跟 18% / 6% / 0% 直接比):
 *   · 一句可以有多条 claim,两个判官拆的条数不一定相同 → **按句聚合到最严的那一档**再比。
 *   · 主读数是**二元不一致率**(ok 对 非ok),因为通过线只看 fatal/hard 条数,档内挪动不改判。
 *   · 四档不一致率一并打出,它是更严的读数。
 *
 * 退出码: 0 比完(一致性高低不用退出码表达,门槛由调用方定);2 文件缺失或形状不对。
 */
import { readFileSync, existsSync } from 'node:fs';

const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('用法: node compare-verdicts.mjs <verdictA.json> <verdictB.json>'); process.exit(2); }
for (const f of [fa, fb]) if (!existsSync(f)) { console.error(`缺文件 ${f}`); process.exit(2); }

const A = JSON.parse(readFileSync(fa, 'utf8'));
const B = JSON.parse(readFileSync(fb, 'utf8'));
if (A.cluster !== B.cluster) { console.error(`两份判定不是同一个簇: c${A.cluster} vs c${B.cluster}`); process.exit(2); }

const RANK = { ok: 0, distortion: 1, hard: 2, fatal: 3 };
const NAME = ['ok', 'distortion', 'hard', 'fatal'];

/** 句级聚合:该句最严的那一档;citedSentenceSuffices 只要有一条 false 就记 false。 */
function bySentence(v) {
  const m = new Map();
  for (const c of v.claims ?? []) {
    const ref = c.sentenceRef;
    if (!ref) continue;
    const r = RANK[c.tier] ?? 0;
    const prev = m.get(ref) ?? { tier: 0, suff: null, n: 0 };
    prev.tier = Math.max(prev.tier, r);
    prev.n++;
    if (typeof c.citedSentenceSuffices === 'boolean') prev.suff = prev.suff === false ? false : c.citedSentenceSuffices;
    m.set(ref, prev);
  }
  return m;
}

const ma = bySentence(A), mb = bySentence(B);
const refs = [...new Set([...ma.keys(), ...mb.keys()])].sort();
const onlyA = refs.filter(r => !mb.has(r)), onlyB = refs.filter(r => !ma.has(r));
const both = refs.filter(r => ma.has(r) && mb.has(r));

let binDiff = 0, tierDiff = 0;
const diffs = [];
for (const r of both) {
  const a = ma.get(r), b = mb.get(r);
  const binA = a.tier > 0, binB = b.tier > 0;
  if (binA !== binB) binDiff++;
  if (a.tier !== b.tier) { tierDiff++; diffs.push(`${r}: ${NAME[a.tier]} vs ${NAME[b.tier]}`); }
}

const nonOkA = both.filter(r => ma.get(r).tier > 0).length;
const nonOkB = both.filter(r => mb.get(r).tier > 0).length;

// citedSentenceSuffices=false 的集合重合度
const sa = new Set(both.filter(r => ma.get(r).suff === false));
const sb = new Set(both.filter(r => mb.get(r).suff === false));
const inter = [...sa].filter(r => sb.has(r)).length;
const union = new Set([...sa, ...sb]).size;
const jac = union ? +(inter / union).toFixed(3) : null;

// 覆盖。现行格式(build-judge-pack 写的)是 {examined, covered:[{eventId, where}]},只列命中的;
// 旧格式是逐条 [{eventId, covered}]。两种都归一成「命中集合 + 看过的条数」再比。
function coverageOf(v) {
  const raw = v.coverage;
  if (Array.isArray(raw)) return { hit: new Set(raw.filter(c => c.covered).map(c => c.eventId)), examined: raw.length };
  return { hit: new Set((raw?.covered ?? []).map(c => c.eventId)), examined: Number.isInteger(raw?.examined) ? raw.examined : null };
}
const ca = coverageOf(A), cb = coverageOf(B);
if (ca.examined !== cb.examined) console.warn(`⚠ 两份判定看过的事件条数不同: A ${ca.examined} / B ${cb.examined} —— 覆盖读数不可比`);
const covDiff = [...new Set([...ca.hit, ...cb.hit])].filter(k => ca.hit.has(k) !== cb.hit.has(k)).sort((x, y) => x - y);
const covExamined = Math.max(ca.examined ?? 0, cb.examined ?? 0);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

console.log(`\n判定一致性 · c${A.cluster}`);
console.log(`  A ${fa}`);
console.log(`  B ${fb}\n`);
console.log(`句数            共同 ${both.length}${onlyA.length || onlyB.length ? `(只有 A 判的 ${onlyA.length}、只有 B 判的 ${onlyB.length})` : ''}`);
console.log(`claim 条数      A ${A.claims?.length ?? 0} / B ${B.claims?.length ?? 0}`);
console.log(`二元不一致      ${binDiff}/${both.length} = ${pct(binDiff, both.length)}   ← 主读数(ok 对 非ok)`);
console.log(`四档不一致      ${tierDiff}/${both.length} = ${pct(tierDiff, both.length)}`);
console.log(`非 ok 句数      A ${nonOkA} / B ${nonOkB}   ← 打架读数:两边都塌到 0 时,再低的不一致率也没有意义`);
console.log(`引用不足集合    A ${sa.size} / B ${sb.size} · 交 ${inter} · 并 ${union} · Jaccard ${jac ?? '—'}`);
console.log(`覆盖不一致      ${covDiff.length}/${covExamined} = ${pct(covDiff.length, covExamined)}${covDiff.length ? `(eventId ${covDiff.slice(0, 10).join(',')}${covDiff.length > 10 ? '…' : ''})` : ''}`);

if (diffs.length) {
  console.log('\n档位不同的句子:');
  for (const d of diffs) console.log(`  ${d}`);
}
if (onlyA.length) console.log(`\n只有 A 判的句子: ${onlyA.join(', ')}`);
if (onlyB.length) console.log(`只有 B 判的句子: ${onlyB.join(', ')}`);

const defA = A.packDefects ?? [], defB = B.packDefects ?? [];
if (defA.length || defB.length) {
  console.log('\n判定包缺陷(判官主动报的):');
  for (const d of defA) console.log(`  [A] ${d}`);
  for (const d of defB) console.log(`  [B] ${d}`);
}
console.log('');
