import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildMergeGroups, type CosinePair } from '../../src/lib/core/story-dedup.js';
const WF = 'admin-brief-1788058777778';
const CODEX_4: number[][] = [
  [2642, 2651, 2637], [2653, 2652, 2650, 2644, 2645],
  [2635, 2636, 2640, 2641, 2639, 2647, 2648], [2643, 2634, 2646, 2654, 2655, 2638]];
const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (q: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
  { encoding: 'utf-8', maxBuffer: 256*1024*1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const rows = psql(`SELECT id, cluster_id, coalesce(title,''), coalesce(article_ids::text,'[]')
  FROM brief_stories WHERE workflow_id='${WF}' AND centroid IS NOT NULL ORDER BY id`);
const all = rows.map((r, i) => ({ index: i, id: Number(r[0]), clusterId: Number(r[1]), importance: 0,
  title: r[2], articleIds: JSON.parse(r[3]) as number[] }));
const idx = new Map(all.map((s) => [s.id, s.index]));
const pairs: CosinePair[] = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid)) FROM brief_stories a
  JOIN brief_stories b ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
  WHERE a.workflow_id='${WF}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL`)
  .map((r) => ({ a: idx.get(Number(r[0]))!, b: idx.get(Number(r[1]))!, cos: Number(r[2]) }));

const c47 = all.filter((s) => s.clusterId === 47);
const inCodex = new Set(CODEX_4.flat());
console.log(`cluster 47 共 ${c47.length} 条；codex 覆盖 ${inCodex.size} 条`);
console.log(`不在 codex 里的：`); c47.filter((s) => !inCodex.has(s.id)).forEach((s) => console.log(`   [${s.id}] ${s.articleIds.length}篇 ${s.title}`));

const groups = buildMergeGroups(all, pairs.filter((p) => p.cos >= 0.94), 0.94);
const inG = new Map<number, number>(); groups.forEach((g, gi) => g.indices.forEach((i) => inG.set(i, gi)));
const units = [
  ...groups.map((g, gi) => ({ merged: true, members: g.indices.map((i) => all[i]) })),
  ...all.filter((s) => !inG.has(s.index)).map((s) => ({ merged: false, members: [s] })),
].filter((u) => u.members[0].clusterId === 47);

const grpOf = new Map<number, number>(CODEX_4.flatMap((g, gi) => g.map((id) => [id, gi] as [number, number])));
console.log(`\n去重后 cluster 47 = ${units.length} 个单元：`);
let conflict = 0;
const out = units.map((u, k) => {
  const arts = [...new Set(u.members.flatMap((m) => m.articleIds))];
  const labels = [...new Set(u.members.map((m) => grpOf.get(m.id)).filter((x) => x !== undefined))] as number[];
  if (labels.length > 1) conflict++;
  console.log(`  U${k}  ${String(u.members.length).padStart(2)}条/${String(arts.length).padStart(2)}篇  codex组 ${labels.length ? labels.join('+') : '无'}${labels.length>1?'  ⚠️跨主线':''}  ${u.members.map((m)=>m.id).join(',')}`);
  return { u: k, storyIds: u.members.map((m) => m.id), articleIds: arts, titles: u.members.map((m) => m.title), codex: labels };
});
console.log(`\n跨主线的合并单元：${conflict} 个`);
writeFileSync('/tmp/units.json', JSON.stringify(out, null, 1));
