// ============================================================================
// Intel-grounding judge 金标 worklist 生成器
//
// 从历史 brief workflow 拉每个 story 的 intelligence_analysis LLM 调用：
//   SOURCE = 输入 RSS 文章（prompt 的 <articles> 块）
//   被评对象 = 情报报告（response），抽 claim
// 跑 judge 做分层（过采非-supported），产出盲标表给标注者填 gold。
//
// 与 faithfulness 的 build-judge-worklist.ts 同构，差别仅在「拉哪条 LLM 调用 + 怎么拆 source/被评对象」。
//
// 用法：
//   pnpm worklist <wfId> [<wfId> ...]
//   env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL(qwen-max),
//        WORKLIST_MAX(80), CONCURRENCY(5), BATCH(日期), MAX_STORIES_PER_WF(全部)
// ============================================================================

import { authHeaders } from '../_shared/backend.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeFactual, judgeAnalytical } from './judge.js';
import { extractSourceArticles, intelReportToProse } from './intel-source.js';
import type { Claim } from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';
const WORKLIST_MAX = Number(process.env.WORKLIST_MAX ?? '80');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '5');
const BATCH = process.env.BATCH || new Date().toISOString().slice(0, 10);
const MAX_STORIES_PER_WF = Number(process.env.MAX_STORIES_PER_WF ?? '999');

// 复用 faithfulness 的默认 admin-brief 集（同一批 run 里也存了 intel 调用）
const DEFAULT_WFS = [
  'admin-brief-1779944200625',
  'admin-brief-1779949426515',
  'admin-brief-1779956764799',
  'admin-brief-1780036335731',
  'admin-brief-1780469057139',
  'admin-brief-1780494276570',
];

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// 拉某 workflow 的全部 intelligence_analysis 调用 → [{ ref, source, reportProse }]
async function fetchIntelStories(
  wf: string
): Promise<Array<{ ref: string; source: string; reportProse: string }>> {
  const callList = await fetchJSON(`${BACKEND_URL}/observability/runs/${wf}/llm-calls`);
  const intelCalls = (callList.calls || [])
    .filter((c: any) => c.phase === 'intelligence_analysis')
    .sort((a: any, b: any) => (a.call_index ?? 0) - (b.call_index ?? 0))
    .slice(0, MAX_STORIES_PER_WF);
  if (intelCalls.length === 0) {
    console.warn(`  ⚠ ${wf}: 无 intelligence_analysis 调用，跳过`);
    return [];
  }

  const out: Array<{ ref: string; source: string; reportProse: string }> = [];
  for (const call of intelCalls) {
    try {
      const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${call.key}`);
      const prompt = raw.request?.messages?.map((m: any) => m.content).join('\n\n') || '';
      const response = raw.response?.content || '';
      const { source, bounded } = extractSourceArticles(prompt);
      if (!bounded) console.warn(`  ⚠ ${wf}#${call.call_index}: 未找到 <articles> 标签，source 退化为整段 prompt`);
      const { prose, parsedOk } = intelReportToProse(response);
      if (!source || !prose) {
        console.warn(`  ⚠ ${wf}#${call.call_index}: source(${source.length})/report(${prose.length},ok=${parsedOk}) 空，跳过`);
        continue;
      }
      out.push({ ref: `${wf}#story${call.call_index}`, source, reportProse: prose });
    } catch (e) {
      console.warn(`  ⚠ ${wf} call ${call.key}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

interface Cand {
  id: string;
  type: 'factual' | 'analytical';
  claim: string;
  source: string;
  judge_verdict: string;
  judge_reason: string;
}

async function judgeCands(rows: Array<{ id: string; claim: Claim; source: string }>): Promise<Cand[]> {
  const out: Cand[] = new Array(rows.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < rows.length) {
      const i = next++;
      const { id, claim, source } = rows[i];
      let verdict: string;
      let reason: string;
      try {
        if (claim.type === 'analytical') {
          const j = await judgeAnalytical(claim, source, JUDGE_MODEL);
          verdict = j.verdict;
          reason = j.reason;
        } else {
          const j = await judgeFactual(claim, source, JUDGE_MODEL);
          verdict = j.verdict;
          reason = j.reason;
        }
      } catch (e) {
        verdict = 'error';
        reason = e instanceof Error ? e.message.slice(0, 120) : String(e);
      }
      out[i] = { id, type: claim.type, claim: claim.text, source, judge_verdict: verdict, judge_reason: reason };
      done++;
      if (done % 20 === 0 || done === rows.length) console.log(`  judged ${done}/${rows.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return out;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const wfs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_WFS;
  console.log(`[intel-worklist] backend=${BACKEND_URL} judge=${JUDGE_MODEL} runs=${wfs.length} target≤${WORKLIST_MAX}`);

  // 1) 拉所有 story 的 intel 报告，抽 claim
  const rows: Array<{ id: string; claim: Claim; source: string }> = [];
  for (const wf of wfs) {
    try {
      const stories = await fetchIntelStories(wf);
      for (const st of stories) {
        const claims = await extractClaims(st.reportProse, JUDGE_MODEL);
        claims.forEach((c) => rows.push({ id: `${st.ref}#${c.id}`, claim: c, source: st.source }));
        console.log(`  ${st.ref}: ${claims.length} claims (source ${st.source.length} chars)`);
      }
    } catch (e) {
      console.warn(`  ⚠ ${wf}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (rows.length === 0) {
    console.error('✗ 没抽到任何 claim');
    process.exit(1);
  }
  console.log(`[intel-worklist] 共 ${rows.length} 个 claim 候选，跑 judge 分层...`);

  // 2) judge 分层
  const cands = await judgeCands(rows);

  // 3) 分层抽样：全要非-supported + 补 supported 到 target
  const nonSupported = cands.filter((c) => c.judge_verdict !== 'supported' && c.judge_verdict !== 'consistent' && c.judge_verdict !== 'error');
  const supported = shuffle(cands.filter((c) => c.judge_verdict === 'supported' || c.judge_verdict === 'consistent'));
  const errored = cands.filter((c) => c.judge_verdict === 'error');
  const supportedQuota = Math.max(0, WORKLIST_MAX - nonSupported.length);
  const picked = shuffle([...nonSupported, ...supported.slice(0, supportedQuota)]);

  // 4) 落两文件
  mkdirSync('worklist', { recursive: true });
  const blindPath = `worklist/${BATCH}.blind.jsonl`;
  const judgePath = `worklist/${BATCH}.judge.jsonl`;
  const blindLines = picked.map((c) =>
    JSON.stringify({ id: c.id, type: c.type, claim: c.claim, source: c.source, strata: {}, gold: '' })
  );
  const judgeLines = picked.map((c) =>
    JSON.stringify({ id: c.id, judge_verdict: c.judge_verdict, judge_reason: c.judge_reason })
  );
  writeFileSync(blindPath, blindLines.join('\n') + '\n');
  writeFileSync(judgePath, judgeLines.join('\n') + '\n');

  // 5) 统计
  const byVerdict: Record<string, number> = {};
  for (const c of picked) byVerdict[c.judge_verdict] = (byVerdict[c.judge_verdict] ?? 0) + 1;
  console.log(`\n[intel-worklist] 候选 ${cands.length} → 选 ${picked.length}（非-supported 全收 ${nonSupported.length}，supported 补 ${Math.min(supportedQuota, supported.length)}，judge 报错 ${errored.length} 弃）`);
  console.log(`  judge 预测分布(分层依据，非 gold): ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  盲标表 → ${blindPath}（给标注者，填 gold；藏 judge 答案）`);
  console.log(`  judge 旁车 → ${judgePath}（仅 critic 对比用）`);
  console.log(`\n下一步：标注者照 rubric.md 在盲标表上填 gold → 汇总裁定 → gold/judge-gold.jsonl → pnpm meta`);
}

main().catch((e) => {
  console.error('intel-worklist 生成失败:', e);
  process.exit(1);
});
