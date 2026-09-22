/**
 * 比两个模型对同一批核心层事件的校核。零 LLM。
 *
 * 两个用途,一次跑出来:
 *   1. 事件清单到底有没有错(两边都说 wrong 的最可信;只有一边说的要人看)
 *   2. **sonnet 在这类逐条对照任务上够不够用** —— 判官降档是会反复付的开销,
 *      今天光判官就烧了约 180 万 token,这个读数决定以后派谁
 *
 * 用法: node compare-audits.mjs [--dir=out/_checklist-audit]
 */
import { readFileSync, existsSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const DIR = `${HERE}${String(args.dir ?? 'out/_checklist-audit').replace(/\/$/, '')}`;
const CIDS = [1, 7, 36, 37, 43];

const load = (cid, suffix) => {
  const f = `${DIR}/audit-c${cid}${suffix}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

let both = 0, agree = 0, onlyOpus = [], onlySonnet = [], bothWrong = [], missing = [];
const conflicts = [];
const tally = { opus: {}, sonnet: {} };

for (const cid of CIDS) {
  const A = load(cid, ''), B = load(cid, '.sonnet');
  if (!A || !B) { missing.push(`c${cid}${!A ? ' opus' : ''}${!B ? ' sonnet' : ''}`); continue; }
  const ia = new Map((A.audits ?? []).map(x => [x.eventId, x]));
  const ib = new Map((B.audits ?? []).map(x => [x.eventId, x]));
  for (const id of new Set([...ia.keys(), ...ib.keys()])) {
    const a = ia.get(id), b = ib.get(id);
    if (!a || !b) { missing.push(`c${cid}#${id}`); continue; }
    both++;
    tally.opus[a.verdict] = (tally.opus[a.verdict] ?? 0) + 1;
    tally.sonnet[b.verdict] = (tally.sonnet[b.verdict] ?? 0) + 1;
    if (a.verdict === b.verdict) agree++;
    const aBad = a.verdict === 'wrong', bBad = b.verdict === 'wrong';
    if (aBad && bBad) bothWrong.push([cid, id, a, b]);
    else if (aBad) onlyOpus.push([cid, id, a]);
    else if (bBad) onlySonnet.push([cid, id, b]);
    if (a.conflictingFigures || b.conflictingFigures) conflicts.push([cid, id, a.conflictingFigures, b.conflictingFigures]);
  }
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
console.log(`\n核心层事件校核 · opus vs sonnet · ${DIR}\n`);
if (missing.length) console.log(`⚠️ 缺 ${missing.length} 项: ${missing.slice(0, 8).join(', ')}\n`);
console.log(`共同校核        ${both} 条`);
console.log(`verdict 一致    ${agree}/${both} = ${pct(agree, both)}`);
console.log(`opus 分布       ${JSON.stringify(tally.opus)}`);
console.log(`sonnet 分布     ${JSON.stringify(tally.sonnet)}`);
console.log(`\n两边都判 wrong  ${bothWrong.length} 条  ← 最可信,清单真的有错`);
for (const [cid, id, a] of bothWrong) console.log(`  c${cid}#${id} [${(a.problems ?? []).join(',')}] ${String(a.why).slice(0, 90)}`);
console.log(`\n只有 opus 判 wrong  ${onlyOpus.length} 条  ← sonnet 漏掉的`);
for (const [cid, id, a] of onlyOpus) console.log(`  c${cid}#${id} [${(a.problems ?? []).join(',')}] ${String(a.why).slice(0, 90)}`);
console.log(`\n只有 sonnet 判 wrong ${onlySonnet.length} 条  ← opus 漏掉的,或 sonnet 误报`);
for (const [cid, id, b] of onlySonnet) console.log(`  c${cid}#${id} [${(b.problems ?? []).join(',')}] ${String(b.why).slice(0, 90)}`);
if (conflicts.length) {
  console.log(`\n口径冲突 ${conflicts.length} 条:`);
  for (const [cid, id, ca, cb] of conflicts) console.log(`  c${cid}#${id} opus=${JSON.stringify(ca)?.slice(0, 110)} | sonnet=${JSON.stringify(cb)?.slice(0, 110)}`);
}
console.log('\n注:一致率高不等于两边都对 —— 两个模型可能有共同盲区。这个读数只能说明「降档会不会明显变差」。');
