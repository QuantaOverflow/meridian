/**
 * 零 LLM：在**现有 cos 边**上，把聚合从单链换成全链，会有什么变化？
 * 这是文献里最小改动的那一档（complete-linkage 定义即排除「组内存在低于阈值配对」）。
 *
 * ⚠️ 改动已搬进生产（story-dedup.ts 的 buildMergeGroups 现在就是全链），所以「生产函数」
 * 那一行现在应当与「原型全链」逐格相同——这条就是移植校验，别当成还在对比单链/全链。
 * 要看改动前的数字，去读 git 历史或本目录 FINDINGS.md。
 */
import { existsSync, readFileSync } from 'node:fs';
import { buildMergeGroups, type CosinePair, type DedupStory } from '../../src/lib/core/story-dedup.js';
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const wfs = readFileSync('/dev/stdin', 'utf-8').trim().split('\n').filter(Boolean);

/** 全链：组内每一对都得 ≥ 阈值。贪心会依赖种子顺序，所以用标准凝聚式：每次并"最小边最大"的两簇。 */
function completeLink(stories: DedupStory[], pairs: CosinePair[], t: number): number[][] {
  const cos = new Map<string, number>();
  for (const p of pairs) cos.set(`${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`, p.cos);
  const cl = (a: number, b: number) => cos.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? 0;
  let cs = stories.map((s) => [s.index]);
  const sameCluster = new Map(stories.map((s) => [s.index, s.clusterId]));
  for (;;) {
    let best = { i: -1, j: -1, v: t };
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        if (sameCluster.get(cs[i][0]) !== sameCluster.get(cs[j][0])) continue;
        let min = 1;
        for (const a of cs[i]) for (const b of cs[j]) min = Math.min(min, cl(a, b));
        if (min >= best.v && min >= t) best = { i, j, v: min };
      }
    if (best.i < 0) break;
    cs[best.i] = [...cs[best.i], ...cs[best.j]].sort((x, y) => x - y);
    cs.splice(best.j, 1);
  }
  return cs.filter((c) => c.length > 1);
}

console.log('阈值   聚合      组数  合掉的故事数  最大组  ≥3组  ≥3组里"全对最小<阈值"');
for (const t of [0.94, 0.92, 0.9]) {
  for (const mode of ['生产函数', '原型全链'] as const) {
    let ng = 0, merged = 0, big = 0, bad = 0, mx = 0;
    for (const wf of wfs) {
      const r = JSON.parse(readFileSync(`${CACHE}${wf}.json`, 'utf-8'));
      const kept = r.pairs.filter((p: CosinePair) => p.cos >= t);
      const gs = mode === '生产函数'
        ? buildMergeGroups(r.stories, kept, t).map((g) => g.indices)
        : completeLink(r.stories, r.pairs, t);
      const cosOf = new Map<string, number>(r.pairs.map((p: CosinePair) => [`${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`, p.cos]));
      for (const g of gs) {
        ng++; merged += g.length; mx = Math.max(mx, g.length);
        if (g.length < 3) continue;
        big++;
        let min = 1;
        for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++)
          min = Math.min(min, cosOf.get(`${Math.min(g[i], g[j])}-${Math.max(g[i], g[j])}`) ?? 0);
        if (min < t) bad++;
      }
    }
    console.log(
      `${t.toFixed(2)}  ${mode.padEnd(8)}${String(ng).padStart(5)} ${String(merged).padStart(13)} ` +
      `${String(mx).padStart(7)} ${String(big).padStart(5)} ${String(bad).padStart(20)}`
    );
  }
}
