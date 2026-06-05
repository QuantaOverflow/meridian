// 一次性诊断：把某 run 的生产排序(importance+覆盖度) vs 金标 rel 逐条摊开，找拖低 NDCG 的错排。
// 用法: node_modules/.bin/tsx _diagnose.ts <workflow_id> [labels.csv]
import { readFile } from 'node:fs/promises';
import { fetchCandidates, fetchSources } from './fetch.js';
import { ndcgAtN } from './metrics.js';

const WF = process.argv[2];
const LABELS = process.argv[3] || 'gold-worklist-2026-06-05.csv';
const COVERAGE_WEIGHT = 1.0;
const N = 10;

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}

async function main() {
  const lines = (await readFile(LABELS, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  const h = parseCsvLine(lines[0]);
  const ci = { wf: h.indexOf('workflow_id'), cl: h.indexOf('cluster_id'), imp: h.indexOf('importance'), rel: h.indexOf('rel'), title: h.indexOf('title') };
  const gold = new Map<number, { rel: number; imp: number; title: string }>(); // clusterId -> gold
  for (const l of lines.slice(1)) {
    const f = parseCsvLine(l);
    if (f[ci.wf] !== WF) continue;
    const r = (f[ci.rel] ?? '').trim(); if (r === '') continue;
    gold.set(Number(f[ci.cl]), { rel: Number(r), imp: Number(f[ci.imp]), title: f[ci.title] });
  }

  const cands = await fetchCandidates(WF);
  const allIds = new Set<number>(); cands.forEach(c => c.articleIds.forEach(i => allIds.add(i)));
  const id2src = await fetchSources([...allIds]);
  const distinct = (ids: number[]) => new Set(ids.map(i => id2src.get(i)).filter(x => x != null)).size;

  type Item = { cl: number; rel: number; imp: number; srcs: number; score: number; title: string };
  const items: Item[] = [];
  for (const c of cands) {
    const g = gold.get(c.clusterId); if (!g) continue;
    const srcs = distinct(c.articleIds);
    items.push({ cl: c.clusterId, rel: g.rel, imp: c.importance, srcs, score: c.importance + COVERAGE_WEIGHT * Math.log2(1 + srcs), title: g.title });
  }
  items.sort((a, b) => b.score - a.score); // 生产排序

  const ndcg = ndcgAtN(items.map(i => i.rel), N);
  console.log(`\n== run ${WF}  候选(已标)=${items.length}  NDCG@${N}=${ndcg.toFixed(3)} ==`);
  console.log('生产排序(↓分):  #=生产排名  rel=金标  imp/源/分=排序依据\n');
  const flag = (i: Item, rank: number) =>
    (i.rel >= 2 && rank > N) ? '  ⚠该上却被挤出top10' :
    (i.rel === 0 && rank <= N) ? '  ⚠噪音却进了top10' : '';
  items.forEach((i, idx) => {
    const rank = idx + 1;
    console.log(`  #${String(rank).padStart(2)}  rel=${i.rel}  imp=${i.imp} 源=${String(i.srcs).padStart(2)} 分=${i.score.toFixed(2)}  ${i.title.slice(0, 58)}${flag(i, rank)}`);
  });

  // 理想排序(按 rel 降序)对照，点出 top-N 内"该在却不在"的
  const idealTop = [...items].sort((a, b) => b.rel - a.rel).slice(0, N);
  const prodTop = new Set(items.slice(0, N).map(i => i.cl));
  const missed = idealTop.filter(i => !prodTop.has(i.cl) && i.rel >= 2);
  console.log(`\n理想 top${N} 里、却被生产排序挤出 top${N} 的 rel≥2 故事: ${missed.length} 个`);
  for (const m of missed) console.log(`  rel=${m.rel} imp=${m.imp} 源=${m.srcs} | ${m.title.slice(0, 60)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
