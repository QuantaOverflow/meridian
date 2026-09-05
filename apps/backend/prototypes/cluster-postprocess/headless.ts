/**
 * 非交互跑法：直接用金标当判官（= 判官做到完美时的上限），扫几组守卫参数。
 * 用来在手动驾驶之前先看清「这一层最多能挽回多少」。
 *
 *   pnpm run headless            F2 / t=0.08
 *   pnpm run headless -- F1 0.10
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMerges, buildMergeCandidates, pairKey, scoreProduct, type Cluster, type Pair, type Verdict } from './logic.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const WIN = args[0] ?? 'F2';
const THR = args[1] ?? '0.08';
const HERE = new URL('.', import.meta.url).pathname;
const BAND = join(HERE, '..', 'dedup-band');
const GOLD = join(HERE, '..', '..', '..', '..', 'scripts', 'eval', 'clustering', 'gold');

const rows = readFileSync(join(BAND, 'fixtures', `fixture-${WIN}.jsonl`), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const vec = new Map<number, Float64Array>();
for (const r of rows) {
  const v = Float64Array.from(JSON.parse(r.emb) as number[]);
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let k = 0; k < v.length; k++) v[k] /= n;
  vec.set(r.id, v);
}
const labels: Record<string, number> = JSON.parse(readFileSync(join(BAND, 'out', 'cluster-sweep', `${WIN}-fine-avg-t${THR}.json`), 'utf-8')).labels;
const events = readFileSync(join(GOLD, `events-${WIN}.jsonl`), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const meta = JSON.parse(readFileSync(join(GOLD, `meta-${WIN}.json`), 'utf-8'));
const excluded = new Set<number>((meta.non_article ?? []).map((x: { id: number }) => x.id));
for (const p of meta.duplicate_pairs ?? []) excluded.add(Math.max(...(p as number[])));
const goldOf = new Map<number, string>(); const goldSize = new Map<string, number>();
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

const oracle = (p: Pair): Verdict => {
  const cnt = (id: number) => {
    const m = new Map<string, number>();
    for (const a of byCluster.get(id) ?? []) { const g = goldOf.get(a); if (g) m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const ca = cnt(p.a), cb = cnt(p.b);
  for (const [g, n] of ca) if (n >= 2 && (cb.get(g) ?? 0) >= 2) return 'same';
  return 'different';
};

const fmt = (m: ReturnType<typeof scoreProduct>) =>
  `簇 ${String(m.clusters).padStart(3)}  交付 ${m.delivery.toFixed(3)}  纯度 ${m.purity.toFixed(3)}  题材袋 ${m.pocketRate.toFixed(3)}  跨簇 ${m.spread.toFixed(2)}  完整 ${m.wholeness.toFixed(3)}`;

console.log(`【${WIN} 凝聚 t=${THR}】判官=金标（完美判官上限）`);
console.log('后处理前                      ' + fmt(scoreProduct(clusters.map(c => c.articleIds), goldOf, goldSize)));
for (const candThr of [0.88, 0.9, 0.92]) {
  const cands = buildMergeCandidates(clusters, vec, candThr);
  const v = new Map<string, Verdict>();
  for (const p of cands) v.set(pairKey(p.a, p.b), oracle(p));
  const trueSame = [...v.values()].filter(x => x === 'same').length;
  for (const linkage of [true, false]) {
    for (const maxSize of [40, 60, 200]) {
      const out = applyMerges(clusters, cands, v, { maxMergedSize: maxSize, completeLinkage: linkage });
      const blocks = out.groups.map(g => g.flatMap(cid => byCluster.get(cid) ?? []));
      console.log(
        `cand≥${candThr} 全链${linkage ? '开' : '关'} 守卫${String(maxSize).padStart(3)}篇 ` +
        `候选${String(cands.length).padStart(3)} 真same${String(trueSame).padStart(3)} 合并${String(out.merges).padStart(3)} ` +
        `链挡${String(out.blockedByLinkage.length).padStart(2)} 守卫挡${String(out.blockedByGuard.length).padStart(2)}  ` + fmt(scoreProduct(blocks, goldOf, goldSize))
      );
    }
  }
}
