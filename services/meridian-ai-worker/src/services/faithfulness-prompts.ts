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

// Lever A：确定性抽取 claim 里的数字/日期，挑出"源里找不到原值"的，作为注意力提示喂给
// judge。不直接下判决（避免数字对齐难题与假阳性），只做高召回的注意力导向——保证不漏任何
// 数字，对齐/判决仍交 LLM。直击 NLI/LLM 对数字大小/正负不敏感的死穴（调研：正确数字注意
// 仅 1.3–5.2%）。详见 docs/eval-playbook.md。
const NUM_RE = /[£$€]?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|million|billion|trillion|pages?|°[CF]|years?|days?|months?|weeks?|hours?)?/gi;
const DATE_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s?\d{0,4}|\b(?:19|20)\d\d\b/gi;

function norm(s: string): string {
  return s.toLowerCase().replace(/,/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

const STOP = new Set(
  'the a an of to in on for and or but with by at from as is are was were be been being this that these those it its their his her over under into than then per via amid has have had will would on off out up down new'.split(
    ' '
  )
);
function contentWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w)));
}

// 数字/日期的类型——对齐只在同类内进行（钱↔钱、日期↔日期），避免 £80M 误对到年份
type SpecKind = 'currency' | 'percent' | 'date' | 'number';
function specKind(val: string, fromDateRe: boolean): SpecKind {
  if (/[£$€]/.test(val)) return 'currency';
  if (/%|percent/i.test(val)) return 'percent';
  if (fromDateRe || /[a-z]/i.test(val) || /^(?:19|20)\d\d$/.test(val.trim())) return 'date';
  return 'number';
}

// 源里所有数字/日期 + 类型 + 上下文窗口（用于按同类对齐到 claim 的同一事实）
function sourceSpecifics(source: string): Array<{ val: string; kind: SpecKind; ctx: string }> {
  const out: Array<{ val: string; kind: SpecKind; ctx: string }> = [];
  [NUM_RE, DATE_RE].forEach((re, idx) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const val = m[0].trim();
      if (norm(val).length < 2 || /^\d$/.test(norm(val))) continue;
      out.push({ val, kind: specKind(val, idx === 1), ctx: source.slice(Math.max(0, m.index - 60), m.index + val.length + 60) });
    }
  });
  return out;
}

// Lever A v2：对 claim 里"源中找不到原值"的数字/日期，确定性找出源里同一事实的对应值并排呈现。
// 对齐靠上下文词重叠（claim 的实体词 ∩ 源某数字周围的词，重叠最多且≥2 者为对应值）。
// 返回可直接打进 prompt 的 hint 行；找到对应值=强烈指向 contradicted，找不到=可能 unsupported。
export function suspectSpecifics(claim: string, source: string): string[] {
  const nsrc = norm(source);
  const claimWords = contentWords(claim);
  const srcSpecs = sourceSpecifics(source);
  const seen = new Set<string>();
  const out: string[] = [];
  [NUM_RE, DATE_RE].forEach((re, idx) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(claim)) !== null) {
      const raw = m[0].trim();
      const n = norm(raw);
      if (n.length < 2 || /^\d$/.test(n) || seen.has(n)) continue;
      seen.add(n);
      if (nsrc.includes(n)) continue; // 源里有原值 → 不可疑
      const claimKind = specKind(raw, idx === 1);
      // 找源里同一事实的对应值：同类型 + 上下文词重叠最高者
      let best: { val: string; ctx: string; score: number } | null = null;
      for (const sp of srcSpecs) {
        if (sp.kind !== claimKind || norm(sp.val) === n) continue;
        let score = 0;
        for (const w of contentWords(sp.ctx)) if (claimWords.has(w)) score++;
        if (!best || score > best.score) best = { val: sp.val, ctx: sp.ctx, score };
      }
      if (best && best.score >= 2) {
        out.push(`claim says "${raw}"; the source's value for the same fact is "${best.val}" (in: "${best.ctx.replace(/\s+/g, ' ').trim()}") -> the values differ, so this is contradicted`);
      } else {
        out.push(`claim says "${raw}"; the source states no matching value for this fact -> if the source never mentions this fact, unsupported`);
      }
    }
  });
  return out;
}

// ② 事实通道裁决（强制取证 + 逐特征比对 + Lever A 注意力提示）
export const FACTUAL_PROMPT = (claim: string, source: string, suspects: string[] = []) => `
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

${
  suspects.length
    ? `# Automatic numeric/date check (already aligned to the source for you)
${suspects.map((s) => `- ${s}`).join('\n')}
Trust these alignments. Where the source's value differs from the claim's, the
verdict is contradicted. Never return "supported" while any flagged value stands.

`
    : ''
}# Hard rule
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
