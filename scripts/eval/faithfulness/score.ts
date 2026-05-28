import { writeFileSync, mkdirSync } from 'node:fs';
import { extractClaims } from './claims.js';
import { judgeAll } from './judge.js';
import type { FaithfulnessReport } from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';

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

  const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${briefCall.key}`);
  const source = messagesToSource(raw.request?.messages || []);
  const brief = raw.response?.content || '';
  if (!source || !brief) {
    throw new Error(`missing source(${source.length}) or brief(${brief.length}) content`);
  }
  console.log(`[faithfulness] source=${source.length} chars, brief=${brief.length} chars`);

  const claims = await extractClaims(brief, JUDGE_MODEL);
  const nFactual = claims.filter((c) => c.type === 'factual').length;
  const nAnalytical = claims.length - nFactual;
  console.log(`[faithfulness] ${claims.length} claims (${nFactual} factual, ${nAnalytical} analytical)`);

  const { factual, analytical } = await judgeAll(claims, source, JUDGE_MODEL);

  // 事实通道
  const supported = factual.filter((j) => j.verdict === 'supported').length;
  const unsupported = factual.filter((j) => j.verdict === 'unsupported').length;
  const contradicted = factual.filter((j) => j.verdict === 'contradicted').length;
  const flaggedFactual = factual.filter((j) => j.verdict !== 'supported');

  // 分析通道
  const consistent = analytical.filter((j) => j.verdict === 'consistent').length;
  const contradicting = analytical.filter((j) => j.verdict === 'contradicts_facts').length;
  const flaggedAnalytical = analytical.filter((j) => j.verdict === 'contradicts_facts');

  const report: FaithfulnessReport = {
    workflow_id: workflowId,
    judge_model: JUDGE_MODEL,
    checked_at: new Date().toISOString(),
    source_layer: 'brief_vs_intel_input',
    total_claims: claims.length,
    factual_claims: factual.length,
    analytical_claims: analytical.length,
    supported,
    unsupported,
    contradicted,
    factual_faithfulness: factual.length ? supported / factual.length : 0,
    gate_pass: contradicted === 0 && contradicting === 0,
    analytical_consistent: consistent,
    analytical_contradicting: contradicting,
    flagged_factual: flaggedFactual,
    flagged_analytical: flaggedAnalytical,
    factual_judgements: factual,
    analytical_judgements: analytical,
  };

  const outDir = 'eval-reports/faithfulness';
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${workflowId}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n========== FAITHFULNESS ==========');
  console.log(`factual_faithfulness: ${report.factual_faithfulness.toFixed(3)}  (${supported}/${factual.length} factual claims grounded)`);
  console.log(`  unsupported:  ${unsupported}`);
  console.log(`  contradicted: ${contradicted}`);
  console.log(`analytical:           ${consistent} consistent / ${contradicting} contradicting-facts (of ${analytical.length})`);
  console.log(`gate: ${report.gate_pass ? 'PASS' : 'FAIL ❌'}  (fails if any factual contradiction or analysis on a fabricated premise)`);

  if (flaggedFactual.length) {
    console.log('\n--- flagged FACTUAL claims ---');
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
  console.error('[faithfulness] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
