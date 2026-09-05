/**
 * 聚类后处理层的手动驾驶台。**用完即弃**——要留的是 logic.ts。
 *
 * 你在这里扮演那个还没建的 LLM 判官：逐对看两簇的标题，判 same / different / 拿不准，
 * 每判一次，上方的产品口径指标立刻重算。想知道「判官做到完美能挽回多少」就按 [o] 让金标代判。
 *
 *   pnpm run tui              F2 窗口，凝聚 t=0.08
 *   pnpm run tui -- F1 0.10   换窗口 / 换阈值
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMerges, buildMergeCandidates, detectPockets, pairKey, scoreProduct,
  type Cluster, type Metrics, type Pair, type PocketPolicy, type Verdict,
} from './logic.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const args = process.argv.slice(2).filter(a => a !== '--');
const WIN = args[0] ?? 'F2';
const THR = args[1] ?? '0.08';
const HERE = new URL('.', import.meta.url).pathname;
const BAND = join(HERE, '..', '_data');
const GOLD = join(HERE, '..', '..', '..', '..', 'scripts', 'eval', 'clustering', 'gold');

// ── 载数据（真实 fixture + 真实金标，内存里跑，不写任何东西）─────────────────
const rows = readFileSync(join(BAND, `fixture-${WIN}.jsonl`), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const vec = new Map<number, Float64Array>();
const titleOf = new Map<number, string>();
for (const r of rows) {
  const v = Float64Array.from(JSON.parse(r.emb) as number[]);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < v.length; k++) v[k] /= n;
  vec.set(r.id, v);
  titleOf.set(r.id, r.title);
}
const labelPath = [
  join(BAND, 'cluster-sweep', `${WIN}-fine-avg-t${THR}.json`),
  join(BAND, 'cluster-sweep', `${WIN}-agglo2-average-t${THR}.json`),
].find(existsSync);
if (!labelPath) throw new Error(`找不到 ${WIN} t=${THR} 的标签文件`);
const labels: Record<string, number> = JSON.parse(readFileSync(labelPath, 'utf-8')).labels;

const events = readFileSync(join(GOLD, `events-${WIN}.jsonl`), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const meta = JSON.parse(readFileSync(join(GOLD, `meta-${WIN}.json`), 'utf-8'));
const excluded = new Set<number>((meta.non_article ?? []).map((x: { id: number }) => x.id));
for (const p of meta.duplicate_pairs ?? []) excluded.add(Math.max(...(p as number[])));
const goldOf = new Map<number, string>();
const goldSize = new Map<string, number>();
for (const e of events) {
  for (const m of e.multi_label ?? []) excluded.add(m.id);
  const ids = [...e.members, ...(e.related ?? []).map((r: { id: number }) => r.id)].filter((i: number) => !excluded.has(i));
  if (ids.length < 2) continue;
  goldSize.set(e.event, ids.length);
  for (const i of ids) goldOf.set(i, e.event);
}

const byCluster = new Map<number, number[]>();
for (const [k, c] of Object.entries(labels)) {
  const id = Number(k);
  if (excluded.has(id) || c < 0) continue;
  (byCluster.get(c) ?? byCluster.set(c, []).get(c)!).push(id);
}
const clusters: Cluster[] = [...byCluster.entries()].filter(([, ids]) => ids.length >= 2).map(([id, articleIds]) => ({ id, articleIds }));
const sizeOf = new Map(clusters.map(c => [c.id, c.articleIds.length]));

// ── 状态 ──────────────────────────────────────────────────────────────────────
const state = {
  candThr: 0.9,
  maxMergedSize: 60,
  completeLinkage: true,
  pocketPolicy: 'keep' as PocketPolicy,
  pocketShare: 0.4,
  cursor: 0,
  verdicts: new Map<string, Verdict>(),
  candidates: [] as Pair[],
};
const rebuildCandidates = () => {
  state.candidates = buildMergeCandidates(clusters, vec, state.candThr);
  state.cursor = 0;
};
rebuildCandidates();

/** 金标口径的「这对该不该合」：两簇里同一个金标事件各占 ≥2 篇 */
function oracle(p: Pair): Verdict {
  const cnt = (id: number) => {
    const m = new Map<string, number>();
    for (const a of byCluster.get(id) ?? []) {
      const g = goldOf.get(a);
      if (g) m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ca = cnt(p.a);
  const cb = cnt(p.b);
  for (const [g, n] of ca) if (n >= 2 && (cb.get(g) ?? 0) >= 2) return 'same';
  return 'different';
}

function currentPartition(): number[][] {
  const out = applyMerges(clusters, state.candidates, state.verdicts, {
    maxMergedSize: state.maxMergedSize,
    completeLinkage: state.completeLinkage,
  });
  const pockets = new Set(
    detectPockets(clusters, titleOf, state.pocketShare).filter(p => p.isPocket).map(p => p.id)
  );
  const blocks: number[][] = [];
  for (const g of out.groups) {
    const ids = g.flatMap(cid => byCluster.get(cid) ?? []);
    if (state.pocketPolicy === 'drop' && g.every(cid => pockets.has(cid))) continue;
    blocks.push(ids);
  }
  return blocks;
}

const fmt = (m: Metrics) =>
  `簇 ${String(m.clusters).padStart(3)}  交付 ${m.delivery.toFixed(3)}  纯度 ${m.purity.toFixed(3)}  ` +
  `题材袋 ${m.pocketRate.toFixed(3)}  跨簇 ${m.spread.toFixed(2)}  完整 ${m.wholeness.toFixed(3)}`;

const base = scoreProduct(clusters.map(c => c.articleIds), goldOf, goldSize);

function render() {
  const out = applyMerges(clusters, state.candidates, state.verdicts, {
    maxMergedSize: state.maxMergedSize,
    completeLinkage: state.completeLinkage,
  });
  const now = scoreProduct(currentPartition(), goldOf, goldSize);
  const judged = state.verdicts.size;
  const same = [...state.verdicts.values()].filter(v => v === 'same').length;
  const unk = [...state.verdicts.values()].filter(v => v === 'unknown').length;
  const pockets = detectPockets(clusters, titleOf, state.pocketShare).filter(p => p.isPocket);

  console.clear();
  console.log(B(`聚类后处理原型  窗口 ${WIN}  凝聚 t=${THR}  ${clusters.length} 个簇`));
  console.log(D('问题：候选阈值 / 全链聚合 / unknown 默认不合 / 大小守卫，这四条规则对不对'));
  console.log('');
  console.log(B('指标') + D('（产品口径：<2 篇的簇与事件都不计）'));
  console.log('  后处理前  ' + fmt(base));
  console.log('  ' + G('当前      ') + fmt(now));
  console.log('');
  console.log(
    B('后处理状态') +
      `  已判 ${judged}/${state.candidates.length}` +
      `  判 same ${same}  拿不准 ${unk}` +
      `  实际合并 ${G(String(out.merges))}` +
      `  全链挡下 ${Y(String(out.blockedByLinkage.length))}` +
      `  守卫挡下 ${R(String(out.blockedByGuard.length))}`
  );
  console.log(
    D(`  候选阈值 ${state.candThr.toFixed(2)}   大小守卫 ${state.maxMergedSize} 篇   ` +
      `全链 ${state.completeLinkage ? '开' : '关'}   题材袋策略 ${state.pocketPolicy}（share<${state.pocketShare}，命中 ${pockets.length} 个簇）`)
  );
  console.log('');

  const p = state.candidates[state.cursor];
  if (!p) {
    console.log(G('候选判完了。'));
  } else {
    const v = state.verdicts.get(pairKey(p.a, p.b));
    console.log(
      B(`候选 ${state.cursor + 1}/${state.candidates.length}`) +
        `  质心余弦 ${p.cos.toFixed(4)}` +
        `  簇 ${p.a}(${sizeOf.get(p.a)}篇) ↔ 簇 ${p.b}(${sizeOf.get(p.b)}篇)` +
        (v ? `  已判：${v === 'same' ? G(v) : v === 'different' ? R(v) : Y(v)}` : '')
    );
    for (const cid of [p.a, p.b]) {
      console.log(D(`  ── 簇 ${cid}`));
      const ids = byCluster.get(cid)!;
      for (const id of ids.slice(0, 4)) console.log('     ' + (titleOf.get(id) ?? '').slice(0, 96));
      if (ids.length > 4) console.log(D(`     …还有 ${ids.length - 4} 篇`));
    }
  }
  console.log('');
  console.log(
    D('[s] 同一件事  [d] 不同  [u] 拿不准  [n]/[b] 下一个/上一个  [o] 金标代判全部（上限）  ') + '\n' +
    D('[l] 全链开关  [+]/[-] 大小守卫  [t]/[T] 候选阈值 ±0.01  [p] 题材袋策略  [<]/[>] 题材袋阈值  [r] 重置  [q] 退出')
  );
}

const keys: Record<string, () => void> = {
  s: () => { const p = state.candidates[state.cursor]; if (p) { state.verdicts.set(pairKey(p.a, p.b), 'same'); state.cursor++; } },
  d: () => { const p = state.candidates[state.cursor]; if (p) { state.verdicts.set(pairKey(p.a, p.b), 'different'); state.cursor++; } },
  u: () => { const p = state.candidates[state.cursor]; if (p) { state.verdicts.set(pairKey(p.a, p.b), 'unknown'); state.cursor++; } },
  n: () => { state.cursor = Math.min(state.cursor + 1, state.candidates.length - 1); },
  b: () => { state.cursor = Math.max(0, state.cursor - 1); },
  o: () => { for (const p of state.candidates) state.verdicts.set(pairKey(p.a, p.b), oracle(p)); },
  l: () => { state.completeLinkage = !state.completeLinkage; },
  '+': () => { state.maxMergedSize += 10; },
  '=': () => { state.maxMergedSize += 10; },
  '-': () => { state.maxMergedSize = Math.max(4, state.maxMergedSize - 10); },
  t: () => { state.candThr = Math.min(0.99, state.candThr + 0.01); rebuildCandidates(); },
  T: () => { state.candThr = Math.max(0.7, state.candThr - 0.01); rebuildCandidates(); },
  '>': () => { state.pocketShare = Math.min(0.95, state.pocketShare + 0.05); },
  '<': () => { state.pocketShare = Math.max(0.05, state.pocketShare - 0.05); },
  p: () => { state.pocketPolicy = state.pocketPolicy === 'keep' ? 'flag' : state.pocketPolicy === 'flag' ? 'drop' : 'keep'; },
  r: () => { state.verdicts.clear(); state.cursor = 0; },
};

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (raw: string) => {
  // 按字符遍历：真 TTY 下一次一个键，管道喂入时一次一串，两种都能驱动
  for (const k of raw.toString()) {
    if (k === 'q' || k === '\u0003') { console.clear(); process.exit(0); }
    keys[k]?.();
  }
  render();
});
render();
