/** 一次性：把现行去重（全链 0.94）跑在 report 76（尼泊尔碎成 11 块那期）上，看能压到几条。 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildMergeGroups, type CosinePair } from '../../src/lib/core/story-dedup.js';
const DB = readFileSync(new URL('../../../frontend/.env', import.meta.url).pathname, 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
const psql = (s: string) => execFileSync('psql', [DB, '-At', '-F', '\t', '-c', s],
  { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));

const WF = 'admin-brief-1788058777778';
const rows = psql(`SELECT id, cluster_id, coalesce(importance,0), coalesce(title,''), coalesce(article_ids::text,'[]')
  FROM brief_stories WHERE workflow_id='${WF}' AND centroid IS NOT NULL ORDER BY id`);
const idx = new Map(rows.map((r, i) => [Number(r[0]), i]));
const st = rows.map((r, i) => ({ index: i, clusterId: Number(r[1]), importance: Number(r[2]),
  articleIds: JSON.parse(r[4]) as number[], title: r[3] }));
const pr = psql(`SELECT a.id, b.id, (1-(a.centroid<=>b.centroid)) FROM brief_stories a
  JOIN brief_stories b ON b.workflow_id=a.workflow_id AND b.cluster_id=a.cluster_id AND a.id<b.id
  WHERE a.workflow_id='${WF}' AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL`);
const pairs: CosinePair[] = pr.map((r) => ({ a: idx.get(Number(r[0]))!, b: idx.get(Number(r[1]))!, cos: Number(r[2]) }))
  .filter((p) => Number.isInteger(p.a) && Number.isInteger(p.b));

const nepal = st.filter((s) => /nepal|himalay|glacial|trishuli|tibet/i.test(s.title));
console.log(`全期 ${st.length} 条 story，其中尼泊尔相关 ${nepal.length} 条\n`);
console.log('尼泊尔各条 story：');
nepal.forEach((s) => console.log(`  簇${String(s.clusterId).padStart(3)} imp${s.importance} ${s.articleIds.length}篇  ${s.title.slice(0, 62)}`));

for (const thr of [0.94, 0.92, 0.90]) {
  const gs = buildMergeGroups(st, pairs.filter((p) => p.cos >= thr), thr);
  const nIdx = new Set(nepal.map((s) => s.index));
  const touched = gs.filter((g) => g.indices.some((i) => nIdx.has(i)));
  const merged = touched.reduce((n, g) => n + g.indices.filter((i) => nIdx.has(i)).length, 0);
  console.log(`\n阈值 ${thr}（全链）：全期合并组 ${gs.length} 个｜尼泊尔 ${nepal.length} 条 → ${nepal.length - merged + touched.length} 条`);
  for (const g of touched) {
    console.log(`   合并 ${g.indices.length} 条（最小余弦 ${g.minCos.toFixed(4)}）:`);
    g.indices.forEach((i) => console.log(`      ${st[i].title.slice(0, 60)}`));
  }
}
