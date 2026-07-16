// 本地验证新 importance prompt 的忠实度:对金标故事用【新 storyValidation prompt】让 LLM 打 d1-d4,
// 算 importance→rel,对比你确认的 gold rel。不用部署 ai-worker——prompt 内联发 /meridian/chat。
// 用法: tsx validate-prompt.ts --labels gold-worklist-2026-06-05.csv [--per 5]
import { readFile } from 'node:fs/promises';
import { fetchCandidates } from './fetch.js';
import { getStoryValidationPrompt } from '../../../services/meridian-ai-worker/src/prompts/storyValidation.ts';

const BACKEND = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const AIW = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

async function chat(prompt: string): Promise<string> {
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(`${AIW}/meridian/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // skipCache: eval 判官须独立采样，绕开 Gateway 默认缓存（重问逐字复读=样本量退化成 1）
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], options: { provider: 'dashscope', model: 'qwen-max', temperature: 0, max_tokens: 1400, skipCache: true } }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const d: any = await r.json();
      return d?.data?.choices?.[0]?.message?.content || '';
    } catch (e) { if (a < 4) await new Promise(s => setTimeout(s, 1500 * a)); else throw e; }
  }
  return '';
}
function parseJSON(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cands = [fenced?.[1], raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)].filter(Boolean) as string[];
  for (const c of cands) { try { return JSON.parse(c); } catch {} }
  return null;
}
async function fetchArticleInfo(ids: number[]): Promise<Map<number, { title: string; points: string[] }>> {
  const m = new Map<number, { title: string; points: string[] }>();
  if (ids.length === 0) return m;
  const r = await fetch(`${BACKEND}/admin/articles/by-ids`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  const d: any = await r.json();
  for (const a of d.articles || []) m.set(a.id, { title: a.title, points: a.event_summary_points || [] });
  return m;
}
const g = (x: any) => Math.min(Math.max(Math.round(Number(x)) || 0, 0), 3);
function impFromDims(d: any): number {
  const raw = 0.35 * g(d?.d1) + 0.30 * g(d?.d2) + 0.20 * g(d?.d3) + 0.15 * g(d?.d4);
  return Math.min(Math.max(Math.round(raw * 3.33), 1), 10);
}
const toRel = (imp: number) => imp >= 7.5 ? 3 : imp >= 5.5 ? 2 : imp >= 3.5 ? 1 : 0;

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let labels = ''; let per = 5;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--labels') labels = argv[++i]; else if (argv[i] === '--per') per = parseInt(argv[++i], 10); }
  const lines = (await readFile(labels, 'utf8')).split(/\r?\n/).filter(l => l.trim());
  const h = parseCsvLine(lines[0]);
  const ci = { wf: h.indexOf('workflow_id'), cl: h.indexOf('cluster_id'), rel: h.indexOf('rel'), title: h.indexOf('title') };
  type Row = { wf: string; cl: number; rel: number; title: string };
  const rows: Row[] = [];
  for (const l of lines.slice(1)) { const f = parseCsvLine(l); const r = (f[ci.rel] ?? '').trim(); if (r === '') continue;
    rows.push({ wf: f[ci.wf], cl: Number(f[ci.cl]), rel: Number(r), title: f[ci.title] }); }
  // 每个 rel 桶取 per 个(去重标题)
  const sample: Row[] = []; const seen = new Set<string>();
  for (const target of [3, 2, 1, 0]) { let n = 0;
    for (const row of rows) { if (row.rel !== target) continue; const k = row.title.slice(0, 30); if (seen.has(k)) continue;
      seen.add(k); sample.push(row); if (++n >= per) break; } }
  // 取各 wf 的 cluster→articleIds
  const wfMap = new Map<string, Map<number, number[]>>();
  for (const wf of new Set(sample.map(s => s.wf))) {
    const cands = await fetchCandidates(wf); const m = new Map<number, number[]>();
    for (const c of cands) m.set(c.clusterId, c.articleIds); wfMap.set(wf, m);
  }
  console.log(`样本 ${sample.length} 条,逐条用新 prompt 重打分...`);
  type Res = { gold: number; llm: number; imp: number; d: string; whys: any; title: string; gap: number };
  const res: Res[] = []; let done = 0; let failed = 0;
  for (const s of sample) {
    try {
      const ids = wfMap.get(s.wf)?.get(s.cl) || [];
      let info = new Map<number, { title: string; points: string[] }>();
      for (let a = 1; a <= 3; a++) { try { info = await fetchArticleInfo(ids); break; } catch (e) { if (a === 3) throw e; await new Promise(r => setTimeout(r, 1500 * a)); } }
      const articleList = ids.map(id => { const a = info.get(id); return a ? `- [${id}] ${a.title}${a.points.length ? '\n    Points: ' + a.points.join('; ') : ''}` : `- [${id}]`; }).join('\n');
      const resp = await chat(getStoryValidationPrompt(articleList));
      const j = parseJSON(resp);
      const sc = j?.scoring || j?.stories?.[0]?.scoring;
      const dims = sc ? { d1: sc.d1?.score, d2: sc.d2?.score, d3: sc.d3?.score, d4: sc.d4?.score }
                      : (j?.dimensions || j?.stories?.[0]?.dimensions);
      if (!dims) { failed++; console.log(`  ?? 解析失败 | gold=${s.rel} | ${s.title.slice(0, 50)} | ans=${j?.answer}`); continue; }
      const imp = impFromDims(dims); const llm = toRel(imp); done++;
      res.push({ gold: s.rel, llm, imp, d: `${g(dims.d1)}${g(dims.d2)}${g(dims.d3)}${g(dims.d4)}`, whys: sc || {}, title: s.title, gap: Math.abs(llm - s.rel) });
    } catch (e: any) { failed++; console.log(`  ?? 网络/调用失败,跳过 | ${s.title.slice(0, 50)} | ${e?.message?.slice(0, 60)}`); }
  }
  const exact = res.filter(r => r.gap === 0).length;
  const within1 = res.filter(r => r.gap <= 1).length;
  const gross = res.filter(r => r.gap >= 2);
  const near = res.filter(r => r.gap === 1);
  console.log(`\n== 忠实度:精确符合 ${exact}/${done} (${(100 * exact / done).toFixed(0)}%) ｜ 误差≤1 ${within1}/${done} (${(100 * within1 / done).toFixed(0)}%) ｜ 解析失败 ${failed} ==`);

  console.log(`\n### ⚠ GROSS 分歧(差≥2,必看,${gross.length} 个)###`);
  if (gross.length === 0) console.log('  无 —— 没有把大事打成小事/反之的崩盘');
  for (const r of gross) {
    console.log(`\n  gold=${r.gold} vs llm=${r.llm} (imp${r.imp} d=${r.d}) | ${r.title.slice(0, 60)}`);
    for (const k of ['d1', 'd2', 'd3', 'd4']) if (r.whys[k]) console.log(`      ${k}=${r.whys[k].score}: ${String(r.whys[k].why).slice(0, 90)}`);
  }
  console.log(`\n### ~ ±1 分歧(抽看,${near.length} 个)###`);
  for (const r of near) console.log(`  gold=${r.gold} llm=${r.llm} (d=${r.d}) | ${r.title.slice(0, 58)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
