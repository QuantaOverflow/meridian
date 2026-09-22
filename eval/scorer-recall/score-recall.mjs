/**
 * 拿判定对手工金标算**判官的检出能力**。零 LLM、纯计算。
 *
 * 金标:2026-09-18 逐句手工标注的 82 句自然候选句,15 句含事实错。
 * 主读数是召回(15 条里认出几条)与精确率(报出来的里有几条是真的)。
 *
 * 用法: node score-recall.mjs --verdicts=out/base/judgeA [--variant=base]
 *       verdicts 目录里每个 block 一个 `verdict-<block>.json`
 *
 * 退出码: 0 算完;2 缺文件或判定不完整。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { splitSentences } from '../cluster-to-brief/lib.mjs';
import { loadBlocks } from './corpus.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
if (!args.verdicts) { console.error('用法: node score-recall.mjs --verdicts=<目录>'); process.exit(2); }
const VDIR = String(args.verdicts).replace(/\/$/, '');
if (!existsSync(VDIR)) { console.error(`缺目录 ${VDIR}`); process.exit(2); }

const gold = readFileSync(`${HERE}gold/natural-errors.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const blocks = loadBlocks();

// 金标按文本定位到句号。**不能按句号对**:生产那套 splitter 与 lib.mjs 不同构,
// c0-lead 的编号整体差一位 —— 按句号对会把金标指到相邻句上,而且不报错。
const sentsOf = new Map(blocks.map(b => [b.block, splitSentences(b.text)]));
const goldAt = new Map();   // `${block}#${ref}` → gold row
for (const g of gold) {
  const ss = sentsOf.get(g.block) ?? [];
  const hits = ss.map((s, i) => [i + 1, s]).filter(([, s]) => s.includes(g.match));
  if (hits.length !== 1) { console.error(`金标 #${g.id} 在 ${g.block} 命中 ${hits.length} 条,定位失败`); process.exit(2); }
  goldAt.set(`${g.block}#s${hits[0][0]}`, g);
}

const RANK = { ok: 0, distortion: 1, hard: 2, fatal: 3 };
const NAME = ['ok', 'distortion', 'hard', 'fatal'];

let judged = 0, missingBlocks = [];
const flagged = [];   // {block, ref, tier, gold?}
for (const b of blocks) {
  const f = `${VDIR}/verdict-${b.block}.json`;
  if (!existsSync(f)) { missingBlocks.push(b.block); continue; }
  const v = JSON.parse(readFileSync(f, 'utf8'));
  const worst = new Map();
  for (const c of v.claims ?? []) {
    if (!c.sentenceRef) continue;
    worst.set(c.sentenceRef, Math.max(worst.get(c.sentenceRef) ?? 0, RANK[c.tier] ?? 0));
  }
  const n = (sentsOf.get(b.block) ?? []).length;
  for (let i = 1; i <= n; i++) {
    const ref = `s${i}`;
    if (!worst.has(ref)) { console.error(`${b.block} 漏判 ${ref}`); process.exit(2); }
    judged++;
    const t = worst.get(ref);
    if (t > 0) flagged.push({ block: b.block, ref, tier: NAME[t], gold: goldAt.get(`${b.block}#${ref}`) });
  }
}
if (missingBlocks.length) { console.error(`缺 ${missingBlocks.length} 个 block 的判定: ${missingBlocks.join(', ')}`); process.exit(2); }

const hit = flagged.filter(f => f.gold);
const miss = gold.filter(g => !hit.some(h => h.gold.id === g.id));
const fp = flagged.filter(f => !f.gold);

// 上限:金标里标了 inClusterRefutable=false 的条目,只靠本簇原文推不翻
const ceiling = gold.filter(g => g.inClusterRefutable !== false);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
console.log(`\n判官检出能力 · ${VDIR}\n`);
console.log(`判过的句子        ${judged}`);
console.log(`金标错误          ${gold.length}(其中 ${gold.length - ceiling.length} 条只靠本簇原文推不翻 → 召回上限 ${ceiling.length}/${gold.length} = ${pct(ceiling.length, gold.length)})`);
console.log(`判官报出非 ok     ${flagged.length}`);
console.log(`  命中金标        ${hit.length}`);
console.log(`  不在金标        ${fp.length}`);
console.log('');
console.log(`召回              ${hit.length}/${gold.length} = ${pct(hit.length, gold.length)}   (对上限 ${hit.length}/${ceiling.length} = ${pct(hit.length, ceiling.length)})`);
console.log(`精确率            ${hit.length}/${flagged.length} = ${pct(hit.length, flagged.length)}`);

const cats = [...new Set(gold.map(g => g.category))];
console.log('\n按错误形状:');
for (const c of cats) {
  const gs = gold.filter(g => g.category === c);
  const hs = hit.filter(h => h.gold.category === c);
  console.log(`  ${c.padEnd(10)} ${hs.length}/${gs.length} = ${pct(hs.length, gs.length)}`);
}

if (miss.length) {
  console.log('\n漏掉的:');
  for (const g of miss) console.log(`  #${String(g.id).padStart(2)} ${g.block.padEnd(9)} ${g.category.padEnd(9)} ${g.match.slice(0, 60)}${g.inClusterRefutable === false ? '  ← 本簇原文推不翻,属检测上限' : ''}`);
}
if (hit.length) {
  console.log('\n认出来的:');
  for (const h of hit) console.log(`  #${String(h.gold.id).padStart(2)} ${h.block.padEnd(9)} ${h.gold.category.padEnd(9)} 判 ${h.tier}`);
}
if (fp.length) {
  console.log(`\n不在金标里但被判非 ok 的 ${fp.length} 句:`);
  for (const f of fp) console.log(`  ${f.block.padEnd(9)} ${f.ref.padEnd(4)} ${f.tier}`);
  console.log('  注:原始标注里另有 10 句「措辞有损但读者不会形成假信念」的临界句,未落成机器可读的清单,');
  console.log('     所以这 ' + fp.length + ' 句里可能混着临界句 —— **精确率是下界,不要当误拦率读**。');
}
console.log('');
