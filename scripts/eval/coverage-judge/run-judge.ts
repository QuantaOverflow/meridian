// ============================================================================
// run-judge —— 在重建的输入上跑「被验对象」覆盖对账判官(qwen-long, temp0)
//
// 忠实复现 brief-generation.ts reconcileCoverage 的判定与兜底：
//   - prompt = getBriefCoverageReconciliationPrompt（从 ai-worker src 单一真源 import）
//   - model=qwen-long, temperature=0, maxTokens=4000
//   - 解析 coverage[]，S{n}→disposition；非法/漏判 story 兜底 dropped（与 runtime 完全一致）
// RUNS>1：每 brief 判 RUNS 次，每 story 取多数，记翻转率（量化 temp0 下裁判非确定性，同 faithfulness）。
//
// 用法：AI_WORKER_URL=... RUNS=3 CONCURRENCY=2 tsx run-judge.ts
// 前置：先跑 build-worklist 生成 worklist/<wf>.json
// ============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chat, parseJSON } from './llm.js';
import { getBriefCoverageReconciliationPrompt } from '../../../services/meridian-ai-worker/src/prompts/briefGeneration.js';
import type { Disposition } from './align.js';

const RUNS = Number(process.env.RUNS ?? '3');
const MODEL = process.env.JUDGE_MODEL || 'qwen-long';
const VALID = new Set<Disposition>(['headline', 'noteworthy', 'dropped']);

// 单次判官调用 → Map<sid, disposition>，忠实复现 runtime 兜底（漏判/非法→dropped）。
// 关键区分（meta-eval 忠实性）：
//   · 响应解析出 ≥1 行 → 视为有效判决；个别 story 未列 → 兜底 dropped（与 reconcileCoverage 一致）。
//   · 响应解析出 0 行（空/错误/非 JSON）→ 这是 **call 失败**不是判决（间歇 API 失败会被 runtime
//     兜底成"整篇全 dropped"的假漏报）→ 重试；重试仍 0 行才认输返回 null。
// 注：production reconcileCoverage 无此重试、无 RUNS——单次坏响应即整篇假漏报，这是判官的真实可靠性缺陷（另记）。
async function judgeOnce(storyList: string, brief: string, sids: string[]): Promise<Map<string, Disposition> | null> {
  const prompt = getBriefCoverageReconciliationPrompt(storyList, brief);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const raw = await chat(prompt, { model: MODEL, temperature: 0, maxTokens: 4000 });
    const parsed = parseJSON<{ coverage?: Array<{ story?: string; disposition?: string }> }>(raw);
    const rows = Array.isArray(parsed?.coverage) ? parsed!.coverage! : [];
    if (rows.length === 0) {
      console.warn(`  ⚠ 判官返回 0 行（rawLen=${raw.length}）——call 失败，第 ${attempt}/4 次重试`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const byId = new Map<string, Disposition>();
    for (const row of rows) {
      const m = /S(\d+)/i.exec(row?.story || '');
      if (!m) continue;
      const sid = `S${Number(m[1])}`;
      const d = VALID.has(row.disposition as Disposition) ? (row.disposition as Disposition) : 'dropped';
      byId.set(sid, d);
    }
    // 漏判的个别 story 兜底 dropped（与 reconcileCoverage 完全一致）
    const out = new Map<string, Disposition>();
    for (const sid of sids) out.set(sid, byId.get(sid) ?? 'dropped');
    return out;
  }
  return null; // 4 次都 0 行：真·call 失败
}

function majority(votes: Disposition[]): Disposition {
  const c: Record<string, number> = {};
  for (const v of votes) c[v] = (c[v] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Disposition;
}

async function main() {
  const files = readdirSync('worklist').filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('worklist/ 为空——先跑 build-worklist');

  const out: any[] = [];
  let flips = 0;
  let total = 0;

  for (const f of files) {
    const fx = JSON.parse(readFileSync(`worklist/${f}`, 'utf8')) as {
      workflow_id: string;
      brief: string;
      storyList: string;
      stories: Array<{ sid: string; storyId: string | number; cluster_id: number; label: string }>;
    };
    const sids = fx.stories.map((s) => s.sid);

    // RUNS 次（每次内部对 0 行 call 失败自重试；仍失败 → 该 run 作废不计入多数）
    const runMaps: Map<string, Disposition>[] = [];
    for (let r = 0; r < RUNS; r++) {
      const m = await judgeOnce(fx.storyList, fx.brief, sids);
      if (m) runMaps.push(m);
      await new Promise((res) => setTimeout(res, 500)); // 轻微限速，避免连发触发网关限流
    }
    if (runMaps.length === 0) {
      console.error(`✗ ${fx.workflow_id}: 全 ${RUNS} run 均 call 失败，跳过（该 brief 无判官标）`);
      continue;
    }

    for (const s of fx.stories) {
      const votes = runMaps.map((m) => m.get(s.sid)!);
      const disp = RUNS > 1 ? majority(votes) : votes[0];
      const flipped = new Set(votes).size > 1;
      if (flipped) flips++;
      total++;
      out.push({
        id: `${fx.workflow_id}#${s.sid}`,
        workflow_id: fx.workflow_id,
        sid: s.sid,
        storyId: s.storyId,
        cluster_id: s.cluster_id,
        judge_disposition: disp,
        votes,
        flipped,
      });
    }
    console.log(`${fx.workflow_id}: ${fx.stories.length} story 判完（RUNS=${RUNS}）`);
  }

  writeFileSync('judge-labels.jsonl', out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(
    `\n✅ ${total} story → judge-labels.jsonl；翻转(${RUNS}次非一致) ${flips}/${total} = ${((100 * flips) / total).toFixed(0)}% — 裁判非确定性量`
  );
}

main().catch((e) => {
  console.error('run-judge 失败:', e);
  process.exit(1);
});
