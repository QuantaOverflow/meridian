/**
 * A 臂 vs b′ 忠实度对照（环 2：简报 vs 情报报告）。
 *
 * 问题：分段写让每个块只看得见自己那一份报告。源变窄，方向未知——
 * 可能更差（缺的事实靠记忆补 = unsupported），也可能更好（跨故事串源是已知失真源，隔离防串）。
 *
 * 判官 = @cf/meta/llama-3.3-70b。选它是因为生成端是 @cf/zai-org/glm-4.7-flash，
 * 判官必须跨家族，否则同族共盲把分数抬虚。代价：llama 在 95k 字符全量源上 500（实测
 * 48k 可以、95k 不行），所以按 claim 检索 top-k 报告再判——这也是业界标准做法。
 *
 * ⚠️ 这把尺子测不出「块与块之间打架」：逐 claim 对源，$17.1B 和 $18B 各自都能在源里
 * 找到，都会判 supported。跨块一致性由 consistency-check.ts 的确定性通道另测。
 *
 * 跑：npx tsx arm-compare.ts [每臂最多判多少条 claim]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeFactual, judgeAnalytical } from './judge.js';
import type { Claim } from './types.js';

const PROTO = '/Users/shiwenjie/Desktop/playground/projects/meridian/services/meridian-ai-worker/prototypes/skeleton-planner';
const MODEL = process.env.JUDGE_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CAP = Number(process.argv[2] ?? 0);      // 0 = 不限
const TOPK = 5;
const CONC = 6;

// ── 源：25 份情报报告，逐份独立可检索 ────────────────────────────────────────────
const reports: any[] = readdirSync(`${PROTO}/fixtures/intel-75`)
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))
  .map((f) => JSON.parse(readFileSync(`${PROTO}/fixtures/intel-75/${f}`, 'utf8')));

const full = readFileSync(`${PROTO}/source-oracle.md`, 'utf8');
const docs = full.split(/\n---\n\n(?=# \[story )/).map((s) => s.trim()).filter(Boolean);
if (docs.length !== reports.length) throw new Error(`源切分成 ${docs.length} 段，应为 ${reports.length}`);

// ── 检索：IDF 加权词重叠，取 top-k ──────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%.一-鿿]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const df = new Map<string, number>();
const docTerms = docs.map((d) => {
  const set = new Set(norm(d));
  set.forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
  return set;
});
const idf = (t: string) => Math.log(docs.length / (1 + (df.get(t) ?? 0)));

function retrieve(claim: string, k = TOPK): { idx: number[]; text: string } {
  const terms = [...new Set(norm(claim))];
  const scored = docTerms.map((set, i) => ({ i, s: terms.reduce((a, t) => a + (set.has(t) ? idf(t) : 0), 0) }));
  scored.sort((a, b) => b.s - a.s);
  const idx = scored.slice(0, k).map((x) => x.i);
  return { idx, text: idx.map((i) => docs[i]).join('\n---\n\n') };
}

// ── 两臂的块：b′ 的块知道自己的真源报告索引，A 臂不知道 ──────────────────────────
interface Blk { arm: 'A' | 'B'; title: string; text: string; truth: number | null }
function splitBlocks(md: string, arm: 'A' | 'B', truthOf?: (t: string) => number | null): Blk[] {
  const out: Blk[] = [];
  for (const chunk of md.split(/^\s*<u>/m).slice(1)) {
    const m = chunk.match(/^\*{0,2}(.*?)\*{0,2}<\/u>\s*([\s\S]*?)(?=\n## |$)/);
    if (!m) continue;
    const title = m[1].trim();
    out.push({ arm, title, text: m[2].trim(), truth: truthOf ? truthOf(title) : null });
  }
  return out;
}

const armA = splitBlocks(readFileSync(`${PROTO}/armA-brief.md`, 'utf8'), 'A');
const bpRun = JSON.parse(readFileSync(`${PROTO}/bprime-result.json`, 'utf8')).find((x: any) => x.run === 1);
const titleToIdx = new Map<string, number>();
for (const r of [...bpRun.plan.main.flatMap((s: any) => s.reports), ...bpRun.plan.isolated]) titleToIdx.set(r.title.trim(), r.i);
const armB = splitBlocks(bpRun.brief, 'B', (t) => titleToIdx.get(t) ?? null);

console.log(`A 臂 ${armA.length} 块 / ${armA.reduce((a, b) => a + b.text.length, 0)} 字符`);
console.log(`b′  ${armB.length} 块 / ${armB.reduce((a, b) => a + b.text.length, 0)} 字符，其中 ${armB.filter((b) => b.truth).length} 块能对上真源报告`);
console.log(`判官 ${MODEL} | 检索 top-${TOPK}\n`);

async function pool<T, R>(items: T[], conc: number, fn: (t: T, i: number) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  const q = items.map((t, i) => ({ t, i }));
  let done = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) {
      const j = q.shift(); if (!j) return;
      try { out[j.i] = await fn(j.t, j.i); } catch (e) { process.stderr.write(`\n[fail ${j.i}] ${e instanceof Error ? e.message.slice(0, 100) : e}\n`); }
      process.stderr.write(`\r  ${++done}/${items.length}`);
    }
  }));
  process.stderr.write('\n');
  return out;
}

// ── 抽 claim：逐块抽，prompt 小、且能把 claim 归到块上 ──────────────────────────
type Tagged = Claim & { blk: number; arm: 'A' | 'B'; truth: number | null };
async function claimsOf(blocks: Blk[], label: string): Promise<Tagged[]> {
  process.stderr.write(`抽 claim (${label})\n`);
  const per = await pool(blocks, CONC, (b) => extractClaims(`${b.title}\n\n${b.text}`, MODEL));
  const out: Tagged[] = [];
  per.forEach((cs, i) => (cs ?? []).forEach((c) => out.push({ ...c, blk: i, arm: blocks[i].arm, truth: blocks[i].truth })));
  const failed = per.filter((x) => x === null).length;
  if (failed) console.log(`  ⚠ ${failed}/${blocks.length} 块抽取失败`);
  return out;
}

const cA = await claimsOf(armA, 'A 臂');
const cB = await claimsOf(armB, "b′");
console.log(`A 臂 ${cA.length} 条 claim（factual ${cA.filter((c) => c.type === 'factual').length}）`);
console.log(`b′  ${cB.length} 条 claim（factual ${cB.filter((c) => c.type === 'factual').length}）\n`);

// ── 检索召回控制：b′ 的 claim 里，真源报告有没有落进 top-k ──────────────────────
const withTruth = cB.filter((c) => c.truth !== null);
const hit = withTruth.filter((c) => retrieve(c.text).idx.includes(c.truth! - 1)).length;
const recall = withTruth.length ? hit / withTruth.length : 0;
console.log(`检索召回控制：b′ 有真源的 ${withTruth.length} 条 claim 中，${hit} 条的真源落进 top-${TOPK} = ${(recall * 100).toFixed(1)}%`);
console.log(`  （召回不足会把 supported 误判成 unsupported，两臂同等受影响，但会压低绝对分）\n`);

// ── 判 ────────────────────────────────────────────────────────────────────────
async function judge(cs: Tagged[], label: string) {
  const list = CAP ? cs.slice(0, CAP) : cs;
  process.stderr.write(`判 ${label}（${list.length} 条）\n`);
  const res = await pool(list, CONC, async (c) => {
    const src = retrieve(c.text).text;
    return c.type === 'analytical'
      ? { c, kind: 'analytical' as const, j: await judgeAnalytical(c, src, MODEL) }
      : { c, kind: 'factual' as const, j: await judgeFactual(c, src, MODEL) };
  });
  return res.filter(Boolean) as NonNullable<(typeof res)[number]>[];
}

const jA = await judge(cA, 'A 臂');
const jB = await judge(cB, "b′");

function summarize(rs: any[], label: string, blocks: Blk[]) {
  const f = rs.filter((r) => r.kind === 'factual');
  const a = rs.filter((r) => r.kind === 'analytical');
  const sup = f.filter((r) => r.j.verdict === 'supported').length;
  const uns = f.filter((r) => r.j.verdict === 'unsupported').length;
  const con = f.filter((r) => r.j.verdict === 'contradicted').length;
  const ctr = a.filter((r) => r.j.verdict === 'contradicts_facts').length;
  console.log(`\n${label}`);
  console.log(`  factual ${f.length} 条 → supported ${sup} / unsupported ${uns} / contradicted ${con}`);
  console.log(`  忠实度 = ${f.length ? (sup / f.length).toFixed(3) : 'n/a'}   (unsupported ${f.length ? (uns / f.length * 100).toFixed(1) : 0}% / contradicted ${f.length ? (con / f.length * 100).toFixed(1) : 0}%)`);
  console.log(`  analytical ${a.length} 条 → 建立在源否定的前提上 ${ctr}`);
  const bad = f.filter((r) => r.j.verdict === 'contradicted');
  if (bad.length) {
    console.log(`  --- contradicted 明细（最多 6 条）---`);
    bad.slice(0, 6).forEach((r) => console.log(`   · [块 ${r.c.blk} ${blocks[r.c.blk]?.title.slice(0, 34)}] ${r.c.text.slice(0, 110)}\n     判官理由: ${String(r.j.reason ?? '').slice(0, 130)}`));
  }
  return { n_factual: f.length, supported: sup, unsupported: uns, contradicted: con, analytical_contradicting: ctr, faithfulness: f.length ? sup / f.length : null };
}

const sA = summarize(jA, 'A 臂（生产现状：扁平输入 + 一次写完，无 RARR）', armA);
const sB = summarize(jB, "b′（规划 + 分段写，无 RARR）", armB);

console.log(`\n════ delta（b′ − A）════`);
console.log(`  忠实度        ${sA.faithfulness?.toFixed(3)} → ${sB.faithfulness?.toFixed(3)}  (${((sB.faithfulness! - sA.faithfulness!) * 100).toFixed(1)} 个百分点)`);
console.log(`  unsupported%  ${(sA.unsupported / sA.n_factual * 100).toFixed(1)}% → ${(sB.unsupported / sB.n_factual * 100).toFixed(1)}%`);
console.log(`  contradicted% ${(sA.contradicted / sA.n_factual * 100).toFixed(1)}% → ${(sB.contradicted / sB.n_factual * 100).toFixed(1)}%`);
console.log(`\n⚠ 判官 llama-3.3-70b 未做过 κ 验证，只能读相对 delta，不能读绝对分。`);
console.log(`⚠ 「块间不一致」不在这把尺子的问题形式里，另见 consistency-check.ts。`);

mkdirSync('eval-reports/arm-compare', { recursive: true });
writeFileSync('eval-reports/arm-compare/result.json', JSON.stringify({
  judge: MODEL, topk: TOPK, retrieval_recall: recall,
  armA: { ...sA, blocks: armA.length }, armB: { ...sB, blocks: armB.length },
  judgements: { A: jA.map((r) => ({ blk: r.c.blk, type: r.c.type, text: r.c.text, verdict: r.j.verdict, reason: r.j.reason })),
                B: jB.map((r) => ({ blk: r.c.blk, type: r.c.type, text: r.c.text, verdict: r.j.verdict, reason: r.j.reason })) },
}, null, 2));
console.log('\n明细 → scripts/eval/faithfulness/eval-reports/arm-compare/result.json');
