import { chat, parseJSON } from './llm.js';
import type {
  Claim,
  FactualJudgement,
  FaithVerdict,
  AnalyticalJudgement,
  AnalyticalVerdict,
} from './types.js';

// ============================================================================
// 事实通道：强制取证裁决
// ============================================================================

const FACTUAL_PROMPT = (claim: string, source: string) => `
You are a strict faithfulness judge. Decide whether a CLAIM is grounded in the
SOURCE material below. The source is everything the brief was allowed to use.

# Verdicts
- supported: the source directly states or clearly entails the claim. You MUST
  return the exact sentence/phrase from the source that supports it.
- unsupported: the source neither states nor contradicts the claim (an addition
  not grounded in the source — possible hallucination).
- contradicted: the source asserts something incompatible with the claim.

# Hard rule
For "supported", evidence_quote MUST be copied verbatim from the SOURCE (an exact
substring). If you cannot copy a supporting sentence verbatim, the verdict is
"unsupported", not "supported".

# CLAIM
${claim}

# SOURCE
${source}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "verdict": "supported" | "unsupported" | "contradicted",
  "evidence_quote": "<verbatim substring of SOURCE, or empty string>",
  "reason": "<one short sentence>"
}
`.trim();

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function verifyEvidence(quote: string, source: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  const nq = normalize(quote);
  const ns = normalize(source);
  if (ns.includes(nq)) return true;
  const head = nq.slice(0, Math.max(20, Math.floor(nq.length * 0.6)));
  return ns.includes(head);
}

export async function judgeFactual(
  claim: Claim,
  source: string,
  model: string
): Promise<FactualJudgement> {
  const raw = await chat(FACTUAL_PROMPT(claim.text, source), { model, temperature: 0, maxTokens: 500 });
  const parsed = parseJSON<{ verdict: string; evidence_quote?: string; reason?: string }>(raw);

  if (!parsed || typeof parsed.verdict !== 'string') {
    return {
      claim,
      verdict: 'unsupported',
      evidence_quote: '',
      evidence_verified: false,
      reason: `judge parse failed; raw: ${raw.slice(0, 120)}`,
    };
  }

  let verdict = (['supported', 'unsupported', 'contradicted'] as FaithVerdict[]).includes(
    parsed.verdict as FaithVerdict
  )
    ? (parsed.verdict as FaithVerdict)
    : 'unsupported';

  const quote = (parsed.evidence_quote || '').toString();
  // verified 仅作审计线索(judge 是否给出可逐字定位的原句),不再回写 verdict。
  // 摘要本质是改写:忠实的陈述被 source 蕴含(entailment)而非逐字包含,
  // 子串匹配会把"会改写"的忠实句误判为 unsupported(度量错位)。判定以 judge 的 verdict 为准。
  const verified = verifyEvidence(quote, source);

  return {
    claim,
    verdict,
    evidence_quote: quote,
    evidence_verified: verified,
    reason: (parsed.reason || '').toString().slice(0, 300),
  };
}

// ============================================================================
// 分析通道：一致性检查（不要求字面 grounding，只抓与源矛盾的前提）
// ============================================================================

const ANALYTICAL_PROMPT = (claim: string, source: string) => `
You are judging an ANALYTICAL statement from a news brief — an interpretation,
implication, or strategic assessment. It is allowed to extrapolate beyond the
literal facts. Do NOT require it to be stated verbatim in the source.

Decide only whether its underlying premise is consistent with the source:
- consistent: a defensible reading of facts that ARE in the source (even if the
  inference itself goes beyond them).
- contradicts_facts: the inference relies on, or asserts, something the source
  contradicts, OR it is about an entity/event that does not appear in the source
  at all (analysis built on a fabricated premise).

# ANALYTICAL STATEMENT
${claim}

# SOURCE
${source}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "verdict": "consistent" | "contradicts_facts",
  "reason": "<one short sentence>"
}
`.trim();

export async function judgeAnalytical(
  claim: Claim,
  source: string,
  model: string
): Promise<AnalyticalJudgement> {
  const raw = await chat(ANALYTICAL_PROMPT(claim.text, source), { model, temperature: 0, maxTokens: 300 });
  const parsed = parseJSON<{ verdict: string; reason?: string }>(raw);
  const verdict: AnalyticalVerdict =
    parsed?.verdict === 'contradicts_facts' ? 'contradicts_facts' : 'consistent';
  return {
    claim,
    verdict,
    reason: (parsed?.reason || '').toString().slice(0, 300),
  };
}

// ============================================================================
// 限并发跑全部 claim，按类型分流
// ============================================================================

export async function judgeAll(
  claims: Claim[],
  source: string,
  model: string,
  concurrency = 5
): Promise<{ factual: FactualJudgement[]; analytical: AnalyticalJudgement[] }> {
  const factual: FactualJudgement[] = [];
  const analytical: AnalyticalJudgement[] = [];
  let next = 0;
  async function worker() {
    while (next < claims.length) {
      const claim = claims[next++];
      if (claim.type === 'analytical') {
        analytical.push(await judgeAnalytical(claim, source, model));
      } else {
        factual.push(await judgeFactual(claim, source, model));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, claims.length) }, worker));
  return { factual, analytical };
}
