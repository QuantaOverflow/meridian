// ============================================================================
// regen-ab —— 合成漏报修复的离线 A/B 复测（coverage + faithfulness 双尺）
//
// 背景：19 条确证合成漏报 open-code 归因（见 scripts/eval/error-analysis/
// synthesis-omission-opencode.md）→ 改 getBriefGenerationPrompt（覆盖契约 +
// 如实告知重要性排序 + noteworthy 兜底重定义）。原 8 期生产简报生成于 bc3f8a9
// (RARR+输入修复) 之前，不能当对照 → 两臂都用本地 HEAD 代码重放生成，唯一变量=prompt。
//
// 每期 wf：
//   1. .r2cache 读 15 个 intel report（S1..Sn 序，与生产一致）→ POST 本地 ai-worker
//      /meridian/generate-final-brief（selfCorrect 默认开=生产链路含 RARR）→ 新简报
//   2. coverage 尺：getBriefCoverageReconciliationPrompt 判官（qwen-long temp0，
//      RUNS 次多数决，0 行重试——与 run-judge.ts 同一套已 κ 验的尺）
//   3. faithfulness 尺：POST /meridian/faithfulness-check（brief vs 同一批 story 源）
//      守"补覆盖别把编造搞高"的 trade-off
//
// 用法：
//   AI_WORKER_URL=http://localhost:8787 ARM=baseline  tsx regen-ab.ts   # 旧 prompt（stash 后）
//   AI_WORKER_URL=http://localhost:8787 ARM=treatment tsx regen-ab.ts   # 新 prompt
//   可选 RUNS(判官次数,默认3) / GEN_RUNS(每期生成几份,默认1) / ONLY=<wf> 单期调试
// 产出：eval-reports/ab/<arm>/<wf>.run<k>.json + 每臂汇总打印
// ============================================================================
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chat, parseJSON } from './llm.js';
import { getBriefCoverageReconciliationPrompt } from '../../../services/meridian-ai-worker/src/prompts/briefGeneration.js';
import type { Disposition } from './align.js';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8787';
const ARM = process.env.ARM || 'treatment';
// 两遍法覆盖补录臂：REPAIR=1 开启（服务端默认开，其余臂必须显式关掉保持可比）
const REPAIR = process.env.REPAIR === '1';
const RUNS = Number(process.env.RUNS ?? '3');
const GEN_RUNS = Number(process.env.GEN_RUNS ?? '1');
const ONLY = process.env.ONLY;
const VALID = new Set<Disposition>(['headline', 'noteworthy', 'dropped']);

interface Fixture {
  workflow_id: string;
  brief: string;
  storyList: string;
  stories: Array<{ sid: string; storyId: string; r2_key: string; label: string }>;
}

function loadReport(r2Key: string): any {
  const cacheFile = `.r2cache/${r2Key.replace(/[^A-Za-z0-9]+/g, '_')}`;
  return JSON.parse(readFileSync(cacheFile, 'utf8'));
}

// 忠实度源：把 intel report 渲染成与合成输入同源的 per-story 文本（不带 [story k/N] 标记，
// 两臂共用同一渲染 → 尺子恒定）。字段对齐 convertReportsToMarkdown，
// legacy 兜底链对齐 index.ts /generate-final-brief（最老 run 用旧 schema：
// overview/key_developments/stakeholders/implications/outlook——不兜底会渲染出空源，
// 忠实度门全判 unsupported 的假读数）。
function reportToSourceText(r: any): string {
  let md = `# ${r.executiveSummary || r.overview || r.summary || ''}\n\n`;
  if (Array.isArray(r.timeline) && r.timeline.length) {
    md += '## 时间线\n' + r.timeline.map((ev: any) => `* [${ev.timestamp || ev.date || ''}] ${ev.description}`).join('\n') + '\n\n';
  }
  const facts = (Array.isArray(r.factualBasis) && r.factualBasis.length) ? r.factualBasis : r.key_developments;
  if (Array.isArray(facts) && facts.length) {
    md += '## 关键发展\n' + facts.map((f: string) => `* ${f}`).join('\n') + '\n\n';
  }
  const ents = (Array.isArray(r.entities) && r.entities.length) ? r.entities
    : (Array.isArray(r.keyEntities) && r.keyEntities.length) ? r.keyEntities
    : (Array.isArray(r.stakeholders) ? r.stakeholders.map((name: string) => ({ name })) : []);
  if (Array.isArray(ents) && ents.length) {
    md += '## 相关方\n' + ents.map((e: any) => `* ${e.name}${e.role || e.type ? ` (${e.role || e.type})` : ''}${e.description ? `：${e.description}` : ''}`).join('\n') + '\n\n';
  }
  const gaps = (Array.isArray(r.informationGaps) && r.informationGaps.length) ? r.informationGaps : r.implications;
  if (Array.isArray(gaps) && gaps.length) {
    md += '## 影响评估\n' + gaps.map((g: string) => `* ${g}`).join('\n') + '\n\n';
  }
  const outlook = r.significance?.reasoning || r.outlook;
  if (outlook) md += `## 前景展望\n${outlook}\n`;
  return md;
}

async function post(path: string, body: any, timeoutMs = 600_000): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${AI_WORKER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) throw new Error(`${path} -> ${resp.status} ${(await resp.text()).slice(0, 300)}`);
      return await resp.json();
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`  ⚠ ${path} 第 ${attempt} 次失败(${e instanceof Error ? e.message.slice(0, 120) : e})，重试`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// 与 run-judge.ts judgeOnce 同逻辑（0 行=call 失败重试；漏判个别 story 兜底 dropped）
async function judgeOnce(storyList: string, brief: string, sids: string[]): Promise<Map<string, Disposition> | null> {
  const prompt = getBriefCoverageReconciliationPrompt(storyList, brief);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const raw = await chat(prompt, { model: 'qwen-long', temperature: 0, maxTokens: 4000 });
    const parsed = parseJSON<{ coverage?: Array<{ story?: string; disposition?: string }> }>(raw);
    const rows = Array.isArray(parsed?.coverage) ? parsed!.coverage! : [];
    if (rows.length === 0) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const byId = new Map<string, Disposition>();
    for (const row of rows) {
      const m = /S(\d+)/i.exec(row?.story || '');
      if (!m) continue;
      byId.set(`S${Number(m[1])}`, VALID.has(row.disposition as Disposition) ? (row.disposition as Disposition) : 'dropped');
    }
    const out = new Map<string, Disposition>();
    for (const sid of sids) out.set(sid, byId.get(sid) ?? 'dropped');
    return out;
  }
  return null;
}

function majority(votes: Disposition[]): Disposition {
  const c: Record<string, number> = {};
  for (const v of votes) c[v] = (c[v] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Disposition;
}

async function main() {
  const outDir = `eval-reports/ab/${ARM}`;
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync('worklist').filter((f) => f.endsWith('.json') && (!ONLY || f.includes(ONLY)));
  if (!files.length) throw new Error('worklist/ 为空或 ONLY 无匹配');

  const summary: any[] = [];
  for (const f of files) {
    const fx = JSON.parse(readFileSync(`worklist/${f}`, 'utf8')) as Fixture;
    const sids = fx.stories.map((s) => s.sid);
    const reports = fx.stories.map((s) => loadReport(s.r2_key));
    const sources = reports.map((r, i) => ({ storyId: sids[i], content: reportToSourceText(r) }));

    // FAITH_ONLY=1：不重新生成，读已存 run 文件只重跑忠实度门（修源渲染 bug 后的补测）
    if (process.env.FAITH_ONLY) {
      for (let k = 1; k <= GEN_RUNS; k++) {
        const path = `${outDir}/${fx.workflow_id}.run${k}.json`;
        let rec: any;
        try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
        console.log(`[${ARM}] ${fx.workflow_id} run${k}: FAITH_ONLY 重跑忠实度门…`);
        const faith = await post('/meridian/faithfulness-check', { sources, brief: rec.brief });
        const fv = faith?.data ?? {};
        rec.faithfulness = { block: fv.block, block_reasons: fv.block_reasons, contradicted: fv.contradicted, genuine_unsupported: fv.genuine_unsupported, factual_claims: fv.factual_claims, unsupported_rate: fv.unsupported_rate, flagged: (fv.flagged_factual ?? []).map((x: any) => ({ verdict: x.verdict, text: x.claim?.text, reason: x.reason })) };
        writeFileSync(path, JSON.stringify(rec, null, 2));
        console.log(`  门: block=${fv.block} contradicted=${fv.contradicted} unsupported=${fv.genuine_unsupported}/${fv.factual_claims}(${((fv.unsupported_rate ?? 0) * 100).toFixed(1)}%)`);
        summary.push({ wf: fx.workflow_id, run: k, n: sids.length, dropped: rec.judge_dropped.length, noteworthy: rec.judge_noteworthy.length, brief_len: rec.brief_len, block: fv.block, contradicted: fv.contradicted, unsupported_rate: fv.unsupported_rate });
      }
      continue;
    }

    for (let k = 1; k <= GEN_RUNS; k++) {
      // 断点续跑：进程中断后重启，已完成的 run 不再重新生成（省 qwen-long 计费）
      const outPath = `${outDir}/${fx.workflow_id}.run${k}.json`;
      if (process.env.SKIP_EXISTING) {
        let prev: any = null;
        try { prev = JSON.parse(readFileSync(outPath, 'utf8')); } catch { /* 不存在则正常生成 */ }
        if (prev) {
          console.log(`[${ARM}] ${fx.workflow_id} run${k}: 已存在，跳过（SKIP_EXISTING）`);
          summary.push({ wf: fx.workflow_id, run: k, n: sids.length, dropped: prev.judge_dropped.length, noteworthy: prev.judge_noteworthy.length, brief_len: prev.brief_len, block: prev.faithfulness?.block, contradicted: prev.faithfulness?.contradicted, unsupported_rate: prev.faithfulness?.unsupported_rate });
          continue;
        }
      }
      const t0 = Date.now();
      console.log(`\n[${ARM}] ${fx.workflow_id} run${k}: 生成简报（${reports.length} 报告）…`);
      const gen = await post('/meridian/generate-final-brief', { analysisData: reports, reconcileCoverage: true, coverageRepair: REPAIR });
      if (!gen?.success) throw new Error(`生成失败: ${JSON.stringify(gen).slice(0, 300)}`);
      const brief: string = gen.data.content;
      const endpointCoverage = gen.metadata?.coverage ?? [];
      console.log(`  生成完成 ${brief.length} chars（${((Date.now() - t0) / 1000).toFixed(0)}s），判官 RUNS=${RUNS}…`);

      // coverage 尺（storyList 固定复用 fixture 的——story 集与序完全相同）
      const runMaps: Map<string, Disposition>[] = [];
      for (let r = 0; r < RUNS; r++) {
        const m = await judgeOnce(fx.storyList, brief, sids);
        if (m) runMaps.push(m);
        await new Promise((res) => setTimeout(res, 500));
      }
      if (!runMaps.length) throw new Error(`${fx.workflow_id}: 判官全 ${RUNS} run call 失败`);
      const judge: Record<string, Disposition> = {};
      for (const sid of sids) judge[sid] = majority(runMaps.map((m) => m.get(sid)!));
      const dropped = sids.filter((s) => judge[s] === 'dropped');
      const noteworthy = sids.filter((s) => judge[s] === 'noteworthy');
      console.log(`  判官: dropped=${dropped.length}/${sids.length} [${dropped.join(',')}] noteworthy=${noteworthy.length}`);

      // faithfulness 尺
      console.log(`  忠实度门…`);
      const faith = await post('/meridian/faithfulness-check', { sources, brief });
      const fv = faith?.data ?? {};
      console.log(`  门: block=${fv.block} contradicted=${fv.contradicted} unsupported=${fv.genuine_unsupported}/${fv.factual_claims}(${((fv.unsupported_rate ?? 0) * 100).toFixed(1)}%)`);

      const rec = {
        arm: ARM as string, workflow_id: fx.workflow_id, run: k,
        brief_len: brief.length, title: gen.data.title,
        judge, judge_dropped: dropped, judge_noteworthy: noteworthy,
        endpoint_coverage: endpointCoverage,
        faithfulness: { block: fv.block, block_reasons: fv.block_reasons, contradicted: fv.contradicted, genuine_unsupported: fv.genuine_unsupported, factual_claims: fv.factual_claims, unsupported_rate: fv.unsupported_rate, flagged: (fv.flagged_factual ?? []).map((x: any) => ({ verdict: x.verdict, text: x.claim?.text, reason: x.reason })) },
        brief,
      };
      writeFileSync(`${outDir}/${fx.workflow_id}.run${k}.json`, JSON.stringify(rec, null, 2));
      summary.push({ wf: fx.workflow_id, run: k, n: sids.length, dropped: dropped.length, noteworthy: noteworthy.length, brief_len: brief.length, block: fv.block, contradicted: fv.contradicted, unsupported_rate: fv.unsupported_rate });
    }
  }

  const totN = summary.reduce((s, r) => s + r.n, 0);
  const totD = summary.reduce((s, r) => s + r.dropped, 0);
  console.log(`\n===== [${ARM}] 汇总 =====`);
  for (const r of summary) console.log(`${r.wf} run${r.run}: dropped ${r.dropped}/${r.n} | note ${r.noteworthy} | ${r.brief_len} chars | block=${r.block} contra=${r.contradicted} unsup=${((r.unsupported_rate ?? 0) * 100).toFixed(1)}%`);
  console.log(`dropped 率: ${totD}/${totN} = ${((100 * totD) / totN).toFixed(1)}% | block: ${summary.filter((r) => r.block).length}/${summary.length}`);
  // FAITH_ONLY 补测可能只跑子集，别覆盖整臂 summary.json（run 文件已就地更新，汇总由 compare 阶段从 run 文件重算）
  if (!process.env.FAITH_ONLY) writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('regen-ab 失败:', e);
  process.exit(1);
});
