// ============================================================================
// Judge 金标 worklist 生成器
//
// 从历史 brief 拉 (claim, source) 候选，分层后产出「盲标表」给标注者填 gold。
// 流程：observability 拉 brief_generation 输入(source)+输出(brief) → extractClaims →
//       跑 judge 做分层(过采非-supported，避免盲标表 90% 都是 supported) → 出两文件：
//   - worklist/<batch>.blind.jsonl   {id,type,claim,source,strata}  ← 给标注者，藏 judge 答案
//   - worklist/<batch>.judge.jsonl   {id,judge_verdict,judge_reason} ← 旁车，仅 critic 对比用
//
// 标注者照 ./rubric.md 在 blind 表上填 gold；多标注者结果 + critic 裁定 → gold/judge-gold.jsonl。
// ⚠️ 已知局限：用 judge 分层会漏 judge 的「假阴性」(judge 自判 supported 的真脑补，如"南郊")。
//    这批覆盖 judge 已 flag 的；假阴性靠多标注者分歧 + 后续难例专项补。
//
// 用法：
//   pnpm worklist <wfId> [<wfId> ...]            # 默认用 6 个已知 admin-brief
//   env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL(qwen-max),
//        WORKLIST_MAX(80), SUPPORTED_CAP(自动), CONCURRENCY(5), BATCH(日期)
// ============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeFactual, judgeAnalytical } from './judge.js';
import type { Claim } from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';
const WORKLIST_MAX = Number(process.env.WORKLIST_MAX ?? '80');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '5');
const BATCH = process.env.BATCH || new Date().toISOString().slice(0, 10);

const DEFAULT_WFS = [
  'admin-brief-1779944200625',
  'admin-brief-1779949426515',
  'admin-brief-1779956764799',
  'admin-brief-1780036335731',
  'admin-brief-1780469057139',
  'admin-brief-1780494276570',
];

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function messagesToSource(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => m.content).join('\n\n');
}

// 拉某 run 的 brief_generation source + brief
async function fetchBrief(wf: string): Promise<{ source: string; brief: string } | null> {
  const callList = await fetchJSON(`${BACKEND_URL}/observability/runs/${wf}/llm-calls`);
  const briefCall = (callList.calls || []).find(
    (c: any) => c.phase === 'brief_generation' && c.call_index === 0
  );
  if (!briefCall) {
    console.warn(`  ⚠ ${wf}: 无 brief_generation-000，跳过`);
    return null;
  }
  const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${briefCall.key}`);
  const source = messagesToSource(raw.request?.messages || []);
  const brief = raw.response?.content || '';
  if (!source || !brief) {
    console.warn(`  ⚠ ${wf}: source(${source.length})/brief(${brief.length}) 空，跳过`);
    return null;
  }
  return { source, brief };
}

interface Cand {
  id: string;
  type: 'factual' | 'analytical';
  claim: string;
  source: string;
  judge_verdict: string;
  judge_reason: string;
}

// 限并发跑 judge
async function judgeCands(
  rows: Array<{ id: string; claim: Claim; source: string }>
): Promise<Cand[]> {
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
  console.log(`[worklist] backend=${BACKEND_URL} judge=${JUDGE_MODEL} runs=${wfs.length} target≤${WORKLIST_MAX}`);

  // 1) 拉所有 brief，抽 claim
  const rows: Array<{ id: string; claim: Claim; source: string }> = [];
  for (const wf of wfs) {
    try {
      const b = await fetchBrief(wf);
      if (!b) continue;
      const claims = await extractClaims(b.brief, JUDGE_MODEL);
      claims.forEach((c) => rows.push({ id: `${wf}#${c.id}`, claim: c, source: b.source }));
      console.log(`  ${wf}: ${claims.length} claims`);
    } catch (e) {
      console.warn(`  ⚠ ${wf}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (rows.length === 0) {
    console.error('✗ 没抽到任何 claim');
    process.exit(1);
  }
  console.log(`[worklist] 共 ${rows.length} 个 claim 候选，跑 judge 分层...`);

  // 2) 跑 judge 分层
  const cands = await judgeCands(rows);

  // 3) 分层抽样：全要非-supported(稀有类) + 补一部分 supported 到 target
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
  console.log(`\n[worklist] 候选 ${cands.length} → 选 ${picked.length}（非-supported 全收 ${nonSupported.length}，supported 补 ${Math.min(supportedQuota, supported.length)}，judge 报错 ${errored.length} 弃）`);
  console.log(`  judge 预测分布(分层依据，非 gold): ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  盲标表 → ${blindPath}（给标注者，填 gold；藏 judge 答案）`);
  console.log(`  judge 旁车 → ${judgePath}（仅 critic 对比用）`);
  console.log(`\n下一步：标注者照 rubric.md 在盲标表上填 gold → 汇总裁定 → gold/judge-gold.jsonl → pnpm meta`);
}

main().catch((e) => {
  console.error('worklist 生成失败:', e);
  process.exit(1);
});
