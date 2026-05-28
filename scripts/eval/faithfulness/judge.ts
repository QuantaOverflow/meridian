import { chat, parseJSON } from './llm.js';
import type { Claim, ClaimJudgement, FaithVerdict } from './types.js';

const JUDGE_PROMPT = (claim: string, source: string) => `
You are a strict faithfulness judge. Decide whether a CLAIM is grounded in the
SOURCE material below. The source is everything the brief was allowed to use.

# Verdicts
- supported: the source directly states or clearly entails the claim. You MUST
  return the exact sentence/phrase from the source that supports it.
- unsupported: the source neither states nor contradicts the claim. It is an
  addition not grounded in the source (possible hallucination).
- contradicted: the source asserts something incompatible with the claim
  (e.g. claim says "rose", source says "fell"; claim gives a number the source
  does not, and asserts a different one).

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

// judge 说 supported 不算数，evidence_quote 必须真能在 source 里找到
function verifyEvidence(quote: string, source: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  const nq = normalize(quote);
  const ns = normalize(source);
  if (ns.includes(nq)) return true;
  // 容错：允许引文里多了省略号/截断，取较长的连续片段再试
  const head = nq.slice(0, Math.max(20, Math.floor(nq.length * 0.6)));
  return ns.includes(head);
}

export async function judgeClaim(
  claim: Claim,
  source: string,
  model: string
): Promise<ClaimJudgement> {
  const raw = await chat(JUDGE_PROMPT(claim.text, source), { model, temperature: 0, maxTokens: 500 });
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
  const verified = verifyEvidence(quote, source);

  // 核心防线：judge 说 supported 但引文在 source 里找不到 → 降级 unsupported
  if (verdict === 'supported' && !verified) {
    verdict = 'unsupported';
  }

  return {
    claim,
    verdict,
    evidence_quote: quote,
    evidence_verified: verified,
    reason: (parsed.reason || '').toString().slice(0, 300),
  };
}

// 限并发跑全部 claim
export async function judgeAll(
  claims: Claim[],
  source: string,
  model: string,
  concurrency = 5
): Promise<ClaimJudgement[]> {
  const results: ClaimJudgement[] = new Array(claims.length);
  let next = 0;
  async function worker() {
    while (next < claims.length) {
      const i = next++;
      results[i] = await judgeClaim(claims[i], source, model);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, claims.length) }, worker));
  return results;
}
