// ============================================================================
// Intel-grounding 打分器 —— 对单个 story 的情报报告跑全量 grounding 评估。
// SOURCE = 该 story 输入 RSS 文章；被评对象 = 情报报告所有 claim。
// 与 faithfulness 的 score.ts 同构，差别仅在拉的是 intelligence_analysis 调用。
//
// 用法：pnpm score <workflow_id> [storyIndex]
//   不给 storyIndex → 评该 wf 的第 0 个 story；给了就评对应 call_index 的 story。
//   env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL(qwen-max)
// ============================================================================

import { authHeaders } from '../_shared/backend.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeAll } from './judge.js';
import { extractSourceArticles, intelReportToProse } from './intel-source.js';
import type { IntelGroundingReport } from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  const workflowId = process.argv[2];
  const storyIndex = process.argv[3] ? Number(process.argv[3]) : 0;
  if (!workflowId) {
    console.error('Usage: pnpm score <workflow_id> [storyIndex]');
    console.error('  env: BACKEND_URL, AI_WORKER_URL, JUDGE_MODEL (default qwen-max)');
    process.exit(1);
  }

  console.log(`[intel-grounding] workflow=${workflowId} story=${storyIndex} judge=${JUDGE_MODEL}`);

  const callList = await fetchJSON(`${BACKEND_URL}/observability/runs/${workflowId}/llm-calls`);
  const intelCall = (callList.calls || []).find(
    (c: any) => c.phase === 'intelligence_analysis' && (c.call_index ?? 0) === storyIndex
  );
  if (!intelCall) {
    throw new Error(
      `no intelligence_analysis call_index=${storyIndex} for ${workflowId}. ` +
        `Available: ${(callList.calls || []).filter((c: any) => c.phase === 'intelligence_analysis').map((c: any) => c.call_index).join(', ')}`
    );
  }

  const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${intelCall.key}`);
  const prompt = raw.request?.messages?.map((m: any) => m.content).join('\n\n') || '';
  const response = raw.response?.content || '';
  const { source, bounded } = extractSourceArticles(prompt);
  if (!bounded) console.warn('  ⚠ 未找到 <articles> 标签，source 退化为整段 prompt');
  const { prose, parsedOk } = intelReportToProse(response);
  if (!source || !prose) {
    throw new Error(`missing source(${source.length}) or report prose(${prose.length}, parsedOk=${parsedOk})`);
  }
  console.log(`[intel-grounding] source=${source.length} chars, report-prose=${prose.length} chars`);

  const claims = await extractClaims(prose, JUDGE_MODEL);
  const nFactual = claims.filter((c) => c.type === 'factual').length;
  const nAnalytical = claims.length - nFactual;
  console.log(`[intel-grounding] ${claims.length} claims (${nFactual} factual, ${nAnalytical} analytical)`);

  const { factual, analytical } = await judgeAll(claims, source, JUDGE_MODEL);

  const supported = factual.filter((j) => j.verdict === 'supported').length;
  const unsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const flaggedFactual = factual.filter((j) => j.verdict !== 'supported');

  const consistent = analytical.filter((j) => j.verdict === 'consistent').length;
  const contradicting = analytical.filter((j) => j.verdict === 'contradicts_facts').length;
  const flaggedAnalytical = analytical.filter((j) => j.verdict === 'contradicts_facts');

  const report: IntelGroundingReport = {
    workflow_id: workflowId,
    story_ref: `${workflowId}#story${storyIndex}`,
    judge_model: JUDGE_MODEL,
    checked_at: new Date().toISOString(),
    source_layer: 'intel_report_vs_input_articles',
    total_claims: claims.length,
    factual_claims: factual.length,
    analytical_claims: analytical.length,
    supported,
    unsupported,
    contradicted,
    factual_groundedness: factual.length ? supported / factual.length : 0,
    gate_pass: contradicted === 0 && contradicting === 0,
    analytical_consistent: consistent,
    analytical_contradicting: contradicting,
    flagged_factual: flaggedFactual,
    flagged_analytical: flaggedAnalytical,
    factual_judgements: factual,
    analytical_judgements: analytical,
  };

  const outDir = 'eval-reports/intel-grounding';
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${workflowId}-story${storyIndex}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n========== INTEL GROUNDING ==========');
  console.log(`factual_groundedness: ${report.factual_groundedness.toFixed(3)}  (${supported}/${factual.length} factual claims grounded in source articles)`);
  console.log(`  unsupported:  ${unsupported}`);
  console.log(`  contradicted: ${contradicted}`);
  console.log(`analytical:           ${consistent} consistent / ${contradicting} contradicting-facts (of ${analytical.length})`);
  console.log(`gate: ${report.gate_pass ? 'PASS' : 'FAIL ❌'}  (fails if report contradicts source or analyzes a fabricated premise)`);

  if (flaggedFactual.length) {
    console.log('\n--- flagged FACTUAL claims (report says it, source does not / contradicts) ---');
    for (const j of flaggedFactual) {
      console.log(`\n[${j.verdict.toUpperCase()}] ${j.claim.text}`);
      console.log(`   reason: ${j.reason}`);
      if (j.evidence_quote) console.log(`   judge-quote: ${j.evidence_quote.slice(0, 120)} (verified=${j.evidence_verified})`);
    }
  }
  if (flaggedAnalytical.length) {
    console.log('\n--- flagged ANALYTICAL (built on premise the source contradicts/lacks) ---');
    for (const j of flaggedAnalytical) {
      console.log(`\n[CONTRADICTS_FACTS] ${j.claim.text}`);
      console.log(`   reason: ${j.reason}`);
    }
  }
  console.log(`\nfull report -> ${outPath}`);
}

main().catch((e) => {
  console.error('[intel-grounding] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
