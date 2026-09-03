/**
 * 【扔掉型原型】现行生产配置（全链 over cos ≥0.94）下，30 篇上限到底在丢多少文章？
 *
 * 背景：collapseGroup 把合并后的文章按时间均匀抽到 DEFAULT_ARTICLE_CAP=30，超出的直接丢，
 * 而抽样对题材是盲的（只有 2 篇的独家分析可能一篇不剩）。⑤′ 原型在最坏样本上量到全链
 * 会合出 48 篇的组、丢 18 篇。但那是 0.90 带 + LLM 边的假设配置。
 * 这里只问一件事：**现在生产跑的那套，有没有在丢？** 零 LLM、零 DB，读已缓存的期次 dump。
 *
 * 跑法：npx tsx cap-loss.ts            读 .cache/ 里已有的期次 dump
 *       npx tsx cap-loss.ts --add <wf>  先从 DB 抓一期存进 .cache/，再全量重算
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMergeGroups, DEFAULT_ARTICLE_CAP, type CosinePair } from '../../src/lib/core/story-dedup.js';

const CACHE = new URL('./.cache/', import.meta.url).pathname;
const CAP = DEFAULT_ARTICLE_CAP;

// --add：把一期从 DB 拉进 .cache/，格式与 probe.ts 落的 dump 一致（wf/stories/pairs）
const add = process.argv.indexOf('--add') >= 0 ? process.argv[process.argv.indexOf('--add') + 1] : null;
if (add && !existsSync(`${CACHE}${add}.json`)) {
  const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
    .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
  const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
    { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  const rows = psql(`SELECT id, cluster_id, coalesce(importance,0), coalesce(title,''), coalesce(article_ids::text,'[]')
    FROM brief_stories WHERE workflow_id='${add}' AND centroid IS NOT NULL ORDER BY id`);
  if (!rows.length) throw new Error(`卫生断言失败：${add} 没有带 centroid 的 story`);
  const idx = new Map(rows.map((r, i) => [Number(r[0]), i]));
  const stories = rows.map((r, i) => ({ index: i, clusterId: Number(r[1]), importance: Number(r[2]),
    articleIds: JSON.parse(r[4]) as number[], title: r[3] }));
  const pairs = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid)) FROM brief_stories a
    JOIN brief_stories b ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
    WHERE a.workflow_id='${add}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL`)
    .map((r) => ({ a: idx.get(Number(r[0]))!, b: idx.get(Number(r[1]))!, cos: Number(r[2]) }))
    .filter((p) => Number.isInteger(p.a) && Number.isInteger(p.b));
  writeFileSync(`${CACHE}${add}.json`, JSON.stringify({ wf: add, stories, pairs }));
  console.log(`已抓取 ${add}：${stories.length} 条 story，${pairs.length} 对\n`);
}
// 期次 dump = `<wf>.json`；判决/配对缓存是 `verdicts_*` / `pairs_*`，排掉
const files = readdirSync(CACHE).filter((f) => f.endsWith('.json') && !/^(verdicts|pairs)_/.test(f));
if (files.length < 5) throw new Error(`卫生断言失败：只找到 ${files.length} 个期次 dump，期望 ≥5`);

/**
 * 生产 buildMergeGroups 的独立重写 + 容量约束：并起来超过 cap 的一对不许合。
 * 独立重写而非改生产函数，是为了先量出代价再决定改不改；cap=Infinity 时必须与生产函数
 * 逐格相同（下面的对拍断言），否则这个臂量出来的差异就分不清是约束的还是重写的 bug。
 */
function cappedGroups(stories: any[], pairs: CosinePair[], minCos: number, cap: number): number[][] {
  const byIdx = new Map<number, any>(stories.map((s) => [s.index, s]));
  const k = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const sim = new Map<string, number>();
  for (const p of pairs) {
    if (p.cos < minCos) continue;
    const sa = byIdx.get(p.a), sb = byIdx.get(p.b);
    if (!sa || !sb || sa.clusterId !== sb.clusterId) continue;
    sim.set(k(p.a, p.b), p.cos);
  }
  const cos = (a: number, b: number) => sim.get(k(a, b)) ?? 0;
  const size = (g: number[]) => new Set(g.flatMap((i) => byIdx.get(i)!.articleIds as number[])).size;
  let gs: number[][] = stories.map((s) => [s.index]);
  for (;;) {
    let best: [number, number] | null = null, bestSim = -Infinity;
    for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) {
      if (byIdx.get(gs[a][0])!.clusterId !== byIdx.get(gs[b][0])!.clusterId) continue;
      if (size(gs[a].concat(gs[b])) > cap) continue; // ← 唯一的改动
      let mn = 1;
      outer: for (const x of gs[a]) for (const y of gs[b]) {
        const v = cos(x, y);
        if (v < mn) mn = v;
        if (mn < minCos) break outer;
      }
      if (mn >= minCos && mn > bestSim) { bestSim = mn; best = [a, b]; }
    }
    if (!best) break;
    gs[best[0]] = gs[best[0]].concat(gs[best[1]]); gs.splice(best[1], 1);
  }
  return gs.filter((g) => g.length > 1).map((g) => g.slice().sort((x, y) => x - y))
    .sort((a, b) => b.length - a.length || a[0] - b[0]);
}

console.log(`cap = ${CAP}（生产 DEFAULT_ARTICLE_CAP）\n`);
console.log('期次                          story  合并组  最大组篇数  超 cap 的组  丢弃篇数');
let totGroups = 0, totOver = 0, totDrop = 0;
const capRows: any[] = [];
const overDetail: string[] = [];
for (const f of files.sort()) {
  const r = JSON.parse(readFileSync(CACHE + f, 'utf-8'));
  const byIdx = new Map<number, any>(r.stories.map((s: any) => [s.index, s]));
  const groups = buildMergeGroups(r.stories, r.pairs.filter((p: CosinePair) => p.cos >= 0.94), 0.94);
  // 篇数按文章 id 并集算，与 collapseGroup 一致（它先并集再抽样）
  const sizes = groups.map((g) => new Set(g.indices.flatMap((i) => byIdx.get(i)!.articleIds as number[])).size);
  const over = sizes.filter((s) => s > CAP).length;
  const drop = sizes.reduce((n, s) => n + Math.max(0, s - CAP), 0);
  totGroups += groups.length; totOver += over; totDrop += drop;

  // 对拍：cap=Infinity 时独立重写必须与生产 buildMergeGroups 逐格相同
  const echo = cappedGroups(r.stories, r.pairs, 0.94, Infinity);
  const norm = (gs: number[][]) => gs.map((g) => g.join(',')).sort().join('|');
  if (norm(echo) !== norm(groups.map((g) => g.indices)))
    throw new Error(`卫生断言失败：${r.wf} 上重写与生产函数划分不同\n  生产 ${norm(groups.map((g) => g.indices))}\n  重写 ${norm(echo)}`);

  const capped = cappedGroups(r.stories, r.pairs, 0.94, CAP);
  const cSizes = capped.map((g) => new Set(g.flatMap((i) => byIdx.get(i)!.articleIds as number[])).size);
  capRows.push({ wf: r.wf, stories: r.stories.length,
    // 「全期故事数」= 未合并的 + 合并组数；约束多切一组就多占一个版面
    before: r.stories.length - groups.reduce((n, g) => n + g.indices.length - 1, 0),
    after: r.stories.length - capped.reduce((n, g) => n + g.length - 1, 0),
    groups: capped.length, maxArt: Math.max(...cSizes, 0),
    drop: cSizes.reduce((n, s) => n + Math.max(0, s - CAP), 0), dropBefore: drop });
  groups.forEach((g, k) => { if (sizes[k] > CAP)
    overDetail.push(`  ${r.wf}  ${sizes[k]} 篇 / ${g.indices.length} 条  丢 ${sizes[k] - CAP}：${byIdx.get(g.indices[0])!.title.slice(0, 50)}`); });
  console.log(`${r.wf.padEnd(28)} ${String(r.stories.length).padStart(5)} ${String(groups.length).padStart(7)} ` +
    `${String(Math.max(...sizes, 0)).padStart(11)} ${String(over).padStart(12)} ${String(drop).padStart(9)}`);
}
console.log(`\n合计：${files.length} 期，${totGroups} 个合并组，其中 ${totOver} 个超 ${CAP} 篇，共丢 ${totDrop} 篇`);
if (overDetail.length) { console.log('\n超 cap 的组：'); overDetail.forEach((l) => console.log(l)); }

console.log('\n=== 给聚合加容量约束（仍是 0.94 全链，零 LLM）===');
console.log('期次                          合并组  最大组篇数  丢弃篇数  全期故事数  多占版面');
let dGroups = 0, dSlots = 0, dDrop = 0;
for (const c of capRows) {
  dGroups += c.groups; dSlots += c.after - c.before; dDrop += c.dropBefore - c.drop;
  console.log(`${c.wf.padEnd(28)} ${String(c.groups).padStart(7)} ${String(c.maxArt).padStart(11)} ` +
    `${String(c.drop).padStart(9)} ${String(c.before).padStart(7)} → ${String(c.after).padStart(3)} ` +
    `${(c.after - c.before > 0 ? '+' : '') + String(c.after - c.before)}`.padStart(10));
}
console.log(`\n合计：丢弃 ${totDrop} → ${totDrop - dDrop} 篇；版面代价 ${dSlots > 0 ? '+' : ''}${dSlots} 个故事 / ${capRows.length} 期` +
  `（每期 ${(dSlots / capRows.length).toFixed(2)}）`);
