// Recall/coverage 审计：从 raw-{key}.json 的 co-association 召回池，挖出被 consensus tau 砍掉的
// "低共识对"(2/N~未达 tau)，分三类供人工判：① 漏并(单例该进某组)② 漏故事(两单例该成组)
// ③ 组内可疑离群(组内某成员与组内其他平均共现低)。纯确定性，复用 raw，不调 LLM。
// 用法: tsx recall-audit.ts --key news-2026-06-01 [--lo 0.4] [--tau 0.75]
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchArticles } from './fetch.js';

type Story = { label: string; articleIds: number[] };

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const key = arg('--key');
  const lo = parseFloat(arg('--lo', '0.4')!); // 候选下界(默认 2/5)
  const tau = parseFloat(arg('--tau', '0.75')!); // consensus 阈值(候选上界)
  if (!key) {
    console.log('Usage: tsx recall-audit.ts --key <name> [--lo 0.4] [--tau 0.75]');
    process.exit(1);
  }

  const raw = JSON.parse(
    await readFile(resolve(`eval-reports/clustering/raw-${key}.json`), 'utf8')
  ) as { runs: Story[][] };
  const ref = JSON.parse(
    await readFile(resolve(`eval-reports/clustering/reference-${key}.json`), 'utf8')
  ) as { stories: Story[]; unassigned: number[] };

  // 重建 co-association(与 consensus 一致：每次运行内一对只计一次)
  const N = raw.runs.length;
  const co = new Map<string, number>();
  const pk = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const run of raw.runs) {
    const seen = new Set<string>();
    for (const s of run) {
      const ids = [...new Set(s.articleIds)];
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const k = pk(ids[i], ids[j]);
          if (seen.has(k)) continue;
          seen.add(k);
          co.set(k, (co.get(k) ?? 0) + 1);
        }
    }
  }
  const freq = (a: number, b: number) => (co.get(pk(a, b)) ?? 0) / N;

  // gold 归属
  const groupOf = new Map<number, number | 'single'>();
  ref.stories.forEach((s, i) => s.articleIds.forEach(id => groupOf.set(id, i)));
  for (const id of ref.unassigned) groupOf.set(id, 'single');

  const titleIds = [...groupOf.keys()];
  const m = await fetchArticles(titleIds);
  const t = (id: number) => m.get(id)?.title ?? '??';

  // ① 漏并 / ② 漏故事：遍历候选区间 [lo, tau) 的对
  const missMerge: Array<{ single: number; grp: number; f: number }> = [];
  const missStory: Array<{ a: number; b: number; f: number }> = [];
  for (const [k, c] of co) {
    const f = c / N;
    if (f < lo || f >= tau) continue;
    const [a, b] = k.split(',').map(Number);
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (ga === 'single' && gb === 'single') missStory.push({ a, b, f });
    else if (ga === 'single' && typeof gb === 'number') missMerge.push({ single: a, grp: gb, f });
    else if (gb === 'single' && typeof ga === 'number') missMerge.push({ single: b, grp: ga, f });
  }

  // ③ 组内可疑离群：成员与组内其他成员的平均共现 < tau
  const suspect: Array<{ id: number; grp: number; avg: number }> = [];
  ref.stories.forEach((s, i) => {
    if (s.articleIds.length < 3) return; // 2 篇组没有"离群"概念
    for (const id of s.articleIds) {
      const others = s.articleIds.filter(x => x !== id);
      const avg = others.reduce((acc, o) => acc + freq(id, o), 0) / others.length;
      if (avg < tau) suspect.push({ id, grp: i, avg });
    }
  });

  // 漏并候选：聚合到"单例 → 最该并入的组"(取最高 freq)
  const bySingle = new Map<number, { grp: number; f: number }>();
  for (const x of missMerge) {
    const cur = bySingle.get(x.single);
    if (!cur || x.f > cur.f) bySingle.set(x.single, { grp: x.grp, f: x.f });
  }

  const grpSample = (i: number) => `组${i + 1}「${t(ref.stories[i].articleIds[0])}」`;

  console.log(`\n=== Recall 审计 ${key} (N=${N}, 候选 freq ∈ [${lo}, ${tau})) ===`);
  console.log(`gold: ${ref.stories.length} 组, ${ref.unassigned.length} 单例\n`);

  console.log(`### ① 漏并候选(单例疑似该进某组) — ${bySingle.size} 个 ###`);
  [...bySingle.entries()]
    .sort((a, b) => b[1].f - a[1].f)
    .forEach(([id, v]) => console.log(`  [${v.f.toFixed(2)}] 单例[${id}] "${t(id)}"\n        → ${grpSample(v.grp)}`));

  console.log(`\n### ② 漏故事候选(两单例疑似该成组) — ${missStory.length} 对 ###`);
  missStory
    .sort((a, b) => b.f - a.f)
    .forEach(x => console.log(`  [${x.f.toFixed(2)}] [${x.a}] "${t(x.a)}"\n        + [${x.b}] "${t(x.b)}"`));

  console.log(`\n### ③ 组内可疑离群(与组内平均共现 < ${tau}) — ${suspect.length} 个 ###`);
  suspect
    .sort((a, b) => a.avg - b.avg)
    .forEach(x => console.log(`  [avg ${x.avg.toFixed(2)}] ${grpSample(x.grp)} 的 [${x.id}] "${t(x.id)}"`));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
