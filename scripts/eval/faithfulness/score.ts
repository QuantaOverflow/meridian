import { writeFileSync, mkdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeAll } from './judge.js';
import type { FaithfulnessReport } from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';

// 把 brief 合成步骤的 LLM 输入（messages）拼成 source 文本
function messagesToSource(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => m.content).join('\n\n');
}

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  const workflowId = process.argv[2];
  if (!workflowId) {
    console.error('Usage: pnpm score <workflow_id>');
    console.error('  env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL (default qwen-max)');
    process.exit(1);
  }

  console.log(`[faithfulness] workflow=${workflowId} judge=${JUDGE_MODEL}`);

  // 1. 找到 brief_generation-000 这次 LLM 调用（含 input=intel 源材料 + output=brief）
  const callList = await fetchJSON(`${BACKEND_URL}/observability/runs/${workflowId}/llm-calls`);
  const briefCall = (callList.calls || []).find(
    (c: any) => c.phase === 'brief_generation' && c.call_index === 0
  );
  if (!briefCall) {
    throw new Error(
      `no brief_generation-000 LLM call found for ${workflowId}. ` +
        `Available: ${(callList.calls || []).map((c: any) => `${c.phase}-${c.call_index}`).join(', ')}`
    );
  }

  // 2. 拉这次调用的完整 raw input/output
  const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${briefCall.key}`);
  const source = messagesToSource(raw.request?.messages || []);
  const brief = raw.response?.content || '';
  if (!source || !brief) {
    throw new Error(`missing source(${source.length}) or brief(${brief.length}) content`);
  }
  console.log(`[faithfulness] source=${source.length} chars, brief=${brief.length} chars`);

  // 3. 抽 claim
  const claims = await extractClaims(brief, JUDGE_MODEL);
  console.log(`[faithfulness] extracted ${claims.length} claims`);

  // 4. 逐 claim 裁决（强制取证 + 子串校验）
  const judgements = await judgeAll(claims, source, JUDGE_MODEL);

  // 5. 双通道聚合
  const supported = judgements.filter((j) => j.verdict === 'supported').length;
  const unsupported = judgements.filter((j) => j.verdict === 'unsupported').length;
  const contradicted = judgements.filter((j) => j.verdict === 'contradicted').length;
  const flagged = judgements.filter((j) => j.verdict !== 'supported');

  const report: FaithfulnessReport = {
    workflow_id: workflowId,
    judge_model: JUDGE_MODEL,
    checked_at: new Date().toISOString(),
    source_layer: 'brief_vs_intel_input',
    total_claims: claims.length,
    supported,
    unsupported,
    contradicted,
    faithfulness_score: claims.length ? supported / claims.length : 0,
    gate_pass: contradicted === 0,
    flagged,
    judgements,
  };

  // 6. 落盘 + 打印
  const outDir = 'eval-reports/faithfulness';
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${workflowId}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n========== FAITHFULNESS ==========');
  console.log(`score:        ${report.faithfulness_score.toFixed(3)}  (${supported}/${claims.length} supported)`);
  console.log(`unsupported:  ${unsupported}`);
  console.log(`contradicted: ${contradicted}   gate: ${report.gate_pass ? 'PASS' : 'FAIL ❌'}`);
  if (flagged.length) {
    console.log('\n--- flagged claims ---');
    for (const j of flagged) {
      console.log(`\n[${j.verdict.toUpperCase()}] ${j.claim.text}`);
      console.log(`   reason: ${j.reason}`);
      if (j.evidence_quote) console.log(`   judge-quote: ${j.evidence_quote.slice(0, 120)} (verified=${j.evidence_verified})`);
    }
  }
  console.log(`\nfull report -> ${outPath}`);
}

main().catch((e) => {
  console.error('[faithfulness] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
