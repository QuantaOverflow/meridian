// 用新 rubric(storyValidation prompt)对 gold 候选实时重打 importance，重算 NDCG，与旧基线对比。
// 旧 importance 来自 CSV(旧 prompt 跑出),新 importance 现场用新 rubric 打 d1-d4。
// 结果缓存到 _rescore-cache.json，再跑不重复付费。
// 用法: BACKEND_URL=... AI_WORKER_URL=... node_modules/.bin/tsx rescore.ts [labels.csv] [--baseline 0.958] [--tolerance 0.02]
import { readFile, writeFile } from 'node:fs/promises';
import { fetchCandidates, fetchSources } from './fetch.js';
import { ndcgAtN } from './metrics.js';
import { getStoryValidationPrompt } from '../../../services/meridian-ai-worker/src/prompts/storyValidation.ts';
import { chat as sharedChat, parseJSON } from '../_shared/judge-llm.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let labels = 'gold-worklist-2026-06-05.csv';
  let baseline: number | null = null;
  let tolerance = 0.02;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--baseline') baseline = parseFloat(args[++i]);
    else if (args[i] === '--tolerance') tolerance = parseFloat(args[++i]);
    else if (!args[i].startsWith('--')) labels = args[i];
  }
  return { labels, baseline, tolerance };
}
const { labels: LABELS, baseline: BASELINE, tolerance: TOLERANCE } = parseArgs();
const BACKEND = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const AIW = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';
const CACHE = '_rescore-cache.json';
const COVERAGE_WEIGHT = 1.0;
const N = 10;
const CONCURRENCY = 5;
const FOCUS = 'admin-brief-1780494276570'; // 0.809 那个 run

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}
const g = (x: any) => Math.min(Math.max(Math.round(Number(x)) || 0, 0), 3);
function impFromDims(d: any): number {
  const raw = 0.35 * g(d?.d1) + 0.30 * g(d?.d2) + 0.20 * g(d?.d3) + 0.15 * g(d?.d4);
  return Math.min(Math.max(Math.round(raw * 3.33), 1), 10);
}
// JSON 抠取 + judge LLM 传输走共享层 ../_shared/judge-llm.ts；本脚本绑定 qwen-max / max_tokens 1400。
const chat = (prompt: string) => sharedChat(prompt, { model: 'qwen-max', maxTokens: 1400, baseUrl: AIW });
async function fetchArticleInfo(ids: number[]): Promise<Map<number, { title: string; points: string[] }>> {
  const m = new Map<number, { title: string; points: string[] }>();
  if (ids.length === 0) return m;
  const r = await fetch(`${BACKEND}/admin/articles/by-ids`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  const d: any = await r.json();
  for (const a of d.articles || []) m.set(a.id, { title: a.title, points: a.event_summary_points || [] });
  return m;
}

type Cand = { wf: string; cl: number; rel: number; oldImp: number; title: string; articleIds: number[] };

async function main() {
  // 1. 读 CSV labeled 候选
  const lines = (await readFile(LABELS, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  const h = parseCsvLine(lines[0]);
  const ci = { wf: h.indexOf('workflow_id'), cl: h.indexOf('cluster_id'), imp: h.indexOf('importance'), rel: h.indexOf('rel'), title: h.indexOf('title') };
  const labeled: Cand[] = [];
  for (const l of lines.slice(1)) {
    const f = parseCsvLine(l); const r = (f[ci.rel] ?? '').trim(); if (r === '') continue;
    labeled.push({ wf: f[ci.wf], cl: Number(f[ci.cl]), rel: Number(r), oldImp: Number(f[ci.imp]), title: f[ci.title], articleIds: [] });
  }
  // 2. 每 run 拉候选 articleIds + 文章信息
  const wfs = [...new Set(labeled.map(c => c.wf))];
  const artInfo = new Map<number, { title: string; points: string[] }>();
  for (const wf of wfs) {
    const cands = await fetchCandidates(wf);
    const byCl = new Map<number, number[]>(cands.map(c => [c.clusterId, c.articleIds]));
    const ids = new Set<number>();
    for (const c of labeled.filter(x => x.wf === wf)) { c.articleIds = byCl.get(c.cl) ?? []; c.articleIds.forEach(i => ids.add(i)); }
    const info = await fetchArticleInfo([...ids]);
    info.forEach((v, k) => artInfo.set(k, v));
  }
  // 3. 缓存
  let cache: Record<string, { newImp: number; dims: any }> = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}
  const todo = labeled.filter(c => !cache[`${c.wf}#${c.cl}`]);
  console.log(`重打 ${todo.length}/${labeled.length} 候选(其余命中缓存)，新 rubric @ qwen-max temp=0 ...`);
  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      const c = todo[next++];
      try {
        const list = c.articleIds.map(id => { const a = artInfo.get(id); return a ? `- [${id}] ${a.title}${a.points.length ? '\n    Points: ' + a.points.join('; ') : ''}` : `- [${id}]`; }).join('\n');
        const j = parseJSON(await chat(getStoryValidationPrompt(list)));
        const sc = j?.scoring || j?.stories?.[0]?.scoring;
        const dims = sc ? { d1: sc.d1?.score, d2: sc.d2?.score, d3: sc.d3?.score, d4: sc.d4?.score } : (j?.dimensions || j?.stories?.[0]?.dimensions);
        if (!dims) { failed++; console.log(`  ?? 解析失败 cl=${c.cl} | ${c.title.slice(0, 45)}`); continue; }
        cache[`${c.wf}#${c.cl}`] = { newImp: impFromDims(dims), dims: { d1: g(dims.d1), d2: g(dims.d2), d3: g(dims.d3), d4: g(dims.d4) } };
        if (++done % 10 === 0) { await writeFile(CACHE, JSON.stringify(cache, null, 2)); process.stdout.write(`  ..${done}\n`); }
      } catch (e: any) { failed++; console.log(`  ?? 调用失败 cl=${c.cl} | ${e?.message?.slice(0, 50)}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(CACHE, JSON.stringify(cache, null, 2));
  console.log(`重打完成: 成功 ${done} 失败 ${failed} 缓存命中 ${labeled.length - todo.length}\n`);

  // 4. 独立源数
  const allIds = new Set<number>(); labeled.forEach(c => c.articleIds.forEach(i => allIds.add(i)));
  const id2src = await fetchSources([...allIds]);
  const distinct = (ids: number[]) => new Set(ids.map(i => id2src.get(i)).filter(x => x != null)).size;

  // 5. 每 run NDCG: 旧 importance vs 新 importance(均 + 覆盖度)
  const oldS: number[] = [], newS: number[] = [];
  console.log(`== NDCG@${N} 按 run: 旧 importance vs 新 rubric (均含覆盖度) ==`);
  for (const wf of wfs) {
    const cs = labeled.filter(c => c.wf === wf).map(c => {
      const srcs = distinct(c.articleIds); const cov = COVERAGE_WEIGHT * Math.log2(1 + srcs);
      const ni = cache[`${wf}#${c.cl}`]?.newImp ?? c.oldImp;
      return { rel: c.rel, oldSc: c.oldImp + cov, newSc: ni + cov };
    });
    const oldN = ndcgAtN([...cs].sort((a, b) => b.oldSc - a.oldSc).map(c => c.rel), N);
    const newN = ndcgAtN([...cs].sort((a, b) => b.newSc - a.newSc).map(c => c.rel), N);
    oldS.push(oldN); newS.push(newN);
    const d = newN - oldN;
    console.log(`  ${wf.slice(0, 24)}  旧=${oldN.toFixed(3)}  新=${newN.toFixed(3)}  Δ=${d >= 0 ? '+' : ''}${d.toFixed(3)}${wf === FOCUS ? '  ← 0.809 run' : ''}`);
  }
  const mo = oldS.reduce((a, b) => a + b, 0) / oldS.length, mn = newS.reduce((a, b) => a + b, 0) / newS.length;
  console.log(`\n== 宏平均  旧=${mo.toFixed(3)}  新=${mn.toFixed(3)}  Δ=${mn - mo >= 0 ? '+' : ''}${(mn - mo).toFixed(3)} ==\n`);
  if (BASELINE !== null) {
    const threshold = BASELINE - TOLERANCE;
    if (mn < threshold) {
      console.error(`\n[FAIL] NDCG@${N} ${mn.toFixed(3)} < baseline ${BASELINE} - tolerance ${TOLERANCE} = ${threshold.toFixed(3)}  — importance prompt 疑似回归`);
      process.exit(1);
    }
    console.log(`[PASS] NDCG@${N} ${mn.toFixed(3)} ≥ ${threshold.toFixed(3)} (baseline ${BASELINE} - tolerance ${TOLERANCE})`);
  }

  // 6. FOCUS run 三处错排的新旧 importance 对照
  console.log(`== ${FOCUS} 逐条: 旧imp → 新imp (按新分排序) ==`);
  const focus = labeled.filter(c => c.wf === FOCUS).map(c => {
    const srcs = distinct(c.articleIds); const e = cache[`${FOCUS}#${c.cl}`];
    return { ...c, srcs, newImp: e?.newImp ?? c.oldImp, dims: e?.dims, newSc: (e?.newImp ?? c.oldImp) + COVERAGE_WEIGHT * Math.log2(1 + srcs) };
  }).sort((a, b) => b.newSc - a.newSc);
  focus.forEach((c, i) => {
    const dd = c.dims ? ` d=${c.dims.d1}${c.dims.d2}${c.dims.d3}${c.dims.d4}` : '';
    const mv = c.newImp !== c.oldImp ? ` (${c.oldImp}→${c.newImp})` : ` (${c.oldImp})`;
    console.log(`  #${String(i + 1).padStart(2)} rel=${c.rel} imp${mv}${dd} 源=${c.srcs} | ${c.title.slice(0, 52)}`);
  });
}
main().catch(e => { console.error(e); process.exit(1); });
