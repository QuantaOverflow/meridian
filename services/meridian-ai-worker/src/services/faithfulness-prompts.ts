// ============================================================================
// 忠实度 judge 的 prompt —— 单一真源（single source of truth）
//
// 运行时（faithfulness-check.ts）和离线 eval（scripts/eval/faithfulness/）都从这里 import，
// 不再各存一份。改判据 = 改这一处，eval 验的就是 runtime 跑的，杜绝漂移。
//
// 标定见 memory: faithfulness-runtime-gate；验证(meta-eval)见 docs/eval-playbook.md。
// ⚠️ 改这里的任一 prompt 后，必须跑 `pnpm -F @meridian/eval-faithfulness meta` 重测召回，
//    见到召回/κ 没回退再合（事实通道 κ≥0.6 且幻觉类召回≥0.7）。
// ============================================================================

// ① 拆原子 claim + 分类（factual / analytical）
export const EXTRACT_PROMPT = (brief: string) => `
You extract atomic statements from a news brief and classify each, so they can
be checked appropriately.

# Two types
- "factual": an assertion about what happened or exists — a checkable event,
  number, date, name, quote, action, or relationship. ("X announced Y on Z",
  "Company A acquired B", "the deal centers on facility C").
- "analytical": the briefer's interpretation, implication, prediction, or
  strategic assessment — signalled by language like "this signals", "suggests",
  "gains leverage", "could reshape", "the strategic read is", "hints at".
  These are meant to extrapolate beyond the literal facts.

# Rules
- Split compound sentences into separate atomic statements.
- A statement that blends fact + interpretation: split it. The checkable part
  is factual, the interpretive part is analytical.
- Skip pure section headers, transitions, and meta sentences.

# Brief
${brief}

# Output
Reply with ONLY a JSON array inside a \`\`\`json fenced block. No prose.
Each element: {"text": "<atomic statement>", "type": "factual" | "analytical"}
`.trim();

// ② 事实通道裁决（强制取证 + 逐特征比对）
export const FACTUAL_PROMPT = (claim: string, source: string) => `
You are a strict faithfulness judge. Decide whether a CLAIM is grounded in the
SOURCE material below. The source is everything the brief was allowed to use.

# Verdicts
- supported: the source directly states or clearly entails the claim, AND every
  checkable specific in the claim matches the source.
- unsupported: the source neither states nor contradicts the claim — OR the claim
  adds a specific (a number, name, place, date, qualifier) the source does not
  contain. An addition not grounded in the source.
- contradicted: the source asserts something INCOMPATIBLE with the claim — a
  different number/amount/date, the opposite direction or polarity (rose vs fell,
  highest vs lowest, approved vs rejected, struck vs spared, will vs will not), a
  different named actor, or a negation that flips the meaning.

# How to decide — do this BEFORE the verdict
List the claim's checkable specifics: every number, date, amount, named entity,
and any direction / polarity / negation word. For EACH, find the matching fact in
the SOURCE and compare them literally:
- specific ABSENT from source (the source does not address it at all) -> unsupported
- specific CONFLICTS with source (different number, opposite direction, flipped
  negation, different named actor) -> contradicted. A surrounding sentence that
  otherwise matches does NOT make a conflicting number or direction "supported".
- only if EVERY specific is present AND matches -> supported

# contradicted vs unsupported (do not confuse these)
If the SOURCE states a DIFFERENT value for the SAME specific the claim makes
(claim says 57.2%, source says 77.2%; claim says "lowest", source says "highest";
claim says 16-day, source says 60-day), that is **contradicted** — the source
asserts the opposite. Use "unsupported" ONLY when the source is silent on that
specific. "The source says X, not Y" means contradicted, not unsupported.

# Hard rule
For "supported", evidence_quote MUST be copied verbatim from the SOURCE (an exact
substring). If you cannot copy a supporting sentence verbatim, it is not supported.

# CLAIM
${claim}

# SOURCE
${source}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "specifics_checked": "<list each number/direction/negation in the claim and the source's value for it>",
  "verdict": "supported" | "unsupported" | "contradicted",
  "evidence_quote": "<verbatim substring of SOURCE, or empty string>",
  "reason": "<one short sentence>"
}
`.trim();

// ③ 分析通道裁决（前提一致性，不要求字面 grounding）
export const ANALYTICAL_PROMPT = (claim: string, source: string) => `
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
