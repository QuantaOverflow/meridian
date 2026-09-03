/**
 * 【扔掉型原型】选择层加「每事件名额上限」，能不能把全链裂开的代价接住？
 *
 * 全链修好了合错，代价是一场大灾裂成 8 片、吃掉 8 个情报名额（去重层的老病复发）。
 * 但「一个事件占几个名额」本来就不是聚合算法的职责——它是选择层的职责。
 * 这里量：按 clusterId 设上限 K，top-25 里的题材分布怎么变。
 *
 * clusterId 作为「事件」的代理：去重只在簇内合并，所以全链裂出来的碎片仍共享 clusterId。
 */
import { readFileSync } from 'node:fs';
import { buildMergeGroups, type CosinePair } from '../../src/lib/core/story-dedup.js';
import { rankStoriesForIntelligence } from '../../src/lib/core/story-ranking.js';
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const MAX = 25;

function single(stories: any[], pairs: CosinePair[], t: number): number[][] {
  const par = new Map<number, number>(stories.map((s) => [s.index, s.index]));
  const find = (x: number): number => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x)!)!); x = par.get(x)!; } return x; };
  const by = new Map(stories.map((s) => [s.index, s]));
  for (const p of pairs) {
    if (p.cos < t) continue;
    const a = by.get(p.a), b = by.get(p.b);
    if (!a || !b || a.clusterId !== b.clusterId) continue;
    par.set(find(p.a), find(p.b));
  }
  const g = new Map<number, number[]>();
  for (const s of stories) { const r = find(s.index); (g.get(r) ?? g.set(r, []).get(r)!).push(s.index); }
  return [...g.values()].filter((x) => x.length > 1);
}

/** 把合并组应用掉，返回「去重后的 story 列表」（合并结果取组内最大 importance，同生产 collapseGroup） */
function applyMerge(stories: any[], groups: number[][]) {
  const inG = new Map<number, number>();
  groups.forEach((g, gi) => g.forEach((i) => inG.set(i, gi)));
  const out: any[] = [];
  stories.forEach((s: any) => { if (!inG.has(s.index)) out.push({ ...s }); });
  groups.forEach((g) => {
    const ms = g.map((i) => stories.find((s: any) => s.index === i));
    out.push({ index: g[0], clusterId: ms[0].clusterId, importance: Math.max(...ms.map((m: any) => m.importance ?? 0)),
      articleIds: [...new Set(ms.flatMap((m: any) => m.articleIds))], title: ms[0].title });
  });
  return out;
}

/**
 * 带每簇配额的 top-N：按分降序扫，某簇已占满 K 就跳过，剩余名额再放开兜底。
 * 兜底是必须的——配额太紧会让名额空着，那等于白扔。
 */
function pickWithQuota(ranked: any[], maxStories: number, k: number) {
  const used = new Map<number, number>();
  const picked: any[] = [];
  const deferred: any[] = [];
  for (const r of ranked) {
    const c = r.story.clusterId;
    if ((used.get(c) ?? 0) >= k) { deferred.push(r); continue; }
    used.set(c, (used.get(c) ?? 0) + 1);
    picked.push(r);
    if (picked.length >= maxStories) return picked;
  }
  for (const r of deferred) { picked.push(r); if (picked.length >= maxStories) break; }
  return picked;
}

const rows: any[] = [];
for (const wf of readFileSync('/tmp/wfs.txt', 'utf-8').trim().split('\n')) {
  const r = JSON.parse(readFileSync(`${CACHE}${wf}.json`, 'utf-8'));
  const srcOf = (list: any[]) => Object.fromEntries(list.map((s, i) => [i, new Set(s.articleIds).size]));
  const arms: Record<string, any[]> = {
    '单链(改前)': applyMerge(r.stories, single(r.stories, r.pairs, 0.94)),
    '全链': applyMerge(r.stories, buildMergeGroups(r.stories, r.pairs.filter((p: CosinePair) => p.cos >= 0.94), 0.94).map((g) => g.indices)),
  };
  for (const [name, list] of Object.entries(arms)) {
    const { ranked } = rankStoriesForIntelligence(list, srcOf(list), { coverageWeight: 1.0, maxStories: MAX });
    for (const k of [Infinity, 3, 2]) {
      const sel = k === Infinity ? ranked.slice(0, MAX) : pickWithQuota(ranked, MAX, k);
      const byC = new Map<number, number>();
      for (const x of sel) byC.set(x.story.clusterId, (byC.get(x.story.clusterId) ?? 0) + 1);
      const top = Math.max(...byC.values());
      rows.push({ wf, arm: name, k: k === Infinity ? '无' : String(k), slots: sel.length,
        events: byC.size, topEvent: top, dup: [...byC.values()].filter((v) => v > 1).reduce((s, v) => s + v - 1, 0) });
    }
  }
}
const key = (x: any) => `${x.arm}|${x.k}`;
const agg = new Map<string, any>();
for (const x of rows) {
  const a = agg.get(key(x)) ?? { arm: x.arm, k: x.k, n: 0, events: 0, topEvent: 0, dup: 0, slots: 0 };
  a.n++; a.events += x.events; a.topEvent = Math.max(a.topEvent, x.topEvent); a.dup += x.dup; a.slots += x.slots;
  agg.set(key(x), a);
}
console.log(`\n7 期 · 每期 top-${MAX} 情报名额 · clusterId 当"事件"代理\n`);
console.log('聚合        每簇上限  名额用满  覆盖的不同事件数  最挤的事件占几格  被同一事件重复占用的格子');
for (const a of agg.values())
  console.log(
    `${a.arm.padEnd(12)}${a.k.padStart(6)}${String(Math.round(a.slots / a.n)).padStart(10)}` +
    `${(a.events / a.n).toFixed(1).padStart(18)}${String(a.topEvent).padStart(18)}${(a.dup / a.n).toFixed(1).padStart(26)}`
  );
