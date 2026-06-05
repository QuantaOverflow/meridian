// 覆盖度对照：在金标上比较两种排序的 NDCG@N——
//   排法 A: 纯 importance        排法 B: importance + W·log2(1+独立源数)
// 扫 W 找最优,量出 ② 多源覆盖度对选择质量的净效果(W=0 即纯 importance 基线)。
// 用法: BACKEND_URL=... tsx coverage-compare.ts --labels worklist.csv [--n 10]
import { readFile } from 'node:fs/promises';
import { fetchCandidates, fetchSources } from './fetch.js';
import { ndcgAtN } from './metrics.js';

function parseArgs(argv: string[]) {
  let labels = ''; let n = 10;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--labels') labels = argv[++i];
    else if (argv[i] === '--n') n = parseInt(argv[++i], 10);
  }
  if (!labels) { console.log('用法: tsx coverage-compare.ts --labels worklist.csv [--n 10]'); process.exit(1); }
  return { labels, n };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

async function main() {
  const { labels, n } = parseArgs(process.argv.slice(2));
  // 1. 读金标 rel,按 (workflow_id, cluster_id) 索引(只保留已标 rel 的)
  const text = await readFile(labels, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const ci = { wf: header.indexOf('workflow_id'), cl: header.indexOf('cluster_id'), rel: header.indexOf('rel') };
  const rel = new Map<string, number>(); // `${wf}#${cluster}` -> rel
  const wfs = new Set<string>();
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const r = (f[ci.rel] ?? '').trim();
    if (r === '') continue;
    rel.set(`${f[ci.wf]}#${f[ci.cl]}`, Number(r));
    wfs.add(f[ci.wf]);
  }

  // 2. 取各 run 候选(含 article_ids),join 金标 rel
  type C = { importance: number; rel: number; srcs: number };
  const perWf = new Map<string, { importance: number; rel: number; articleIds: number[] }[]>();
  const allIds = new Set<number>();
  for (const wf of wfs) {
    const cands = await fetchCandidates(wf);
    const kept: { importance: number; rel: number; articleIds: number[] }[] = [];
    for (const c of cands) {
      const r = rel.get(`${wf}#${c.clusterId}`);
      if (r === undefined) continue; // 非本desk/未标,跳过
      kept.push({ importance: c.importance, rel: r, articleIds: c.articleIds });
      c.articleIds.forEach(id => allIds.add(id));
    }
    perWf.set(wf, kept);
  }

  // 3. 独立源数
  const id2src = await fetchSources([...allIds]);
  const distinct = (ids: number[]) => new Set(ids.map(i => id2src.get(i)).filter(x => x != null)).size;
  const scored = new Map<string, C[]>();
  for (const [wf, ks] of perWf) {
    scored.set(wf, ks.map(k => ({ importance: k.importance, rel: k.rel, srcs: distinct(k.articleIds) })));
  }

  // 4. 扫 W,各算宏平均 NDCG@N
  const Ws = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
  console.log(`\n== 覆盖度对照 NDCG@${n}(W=0 即纯 importance 基线) ==`);
  let baseline = 0;
  let best = { W: 0, ndcg: -1 };
  for (const W of Ws) {
    const scores: number[] = [];
    for (const [, cs] of scored) {
      const ranked = [...cs].sort((a, b) =>
        (b.importance + W * Math.log2(1 + b.srcs)) - (a.importance + W * Math.log2(1 + a.srcs)));
      scores.push(ndcgAtN(ranked.map(c => c.rel), n));
    }
    const macro = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (W === 0) baseline = macro;
    if (macro > best.ndcg) best = { W, ndcg: macro };
    console.log(`  W=${W.toFixed(2)}   NDCG@${n}=${macro.toFixed(4)}${W === 0 ? '  ← 基线' : ''}`);
  }
  const delta = best.ndcg - baseline;
  console.log(`\n基线(W=0)=${baseline.toFixed(4)}  最优 W=${best.W} NDCG@${n}=${best.ndcg.toFixed(4)}  净效果 Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
