import { chat, parseJSON } from './llm.js';
import type { Claim, ClaimType } from './types.js';

const EXTRACT_PROMPT = (brief: string) => `
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

// 从可能被截断的 JSON 文本里逐个抠出完整的 {...} 对象
function salvageObjects(raw: string): Array<{ text?: string; type?: string }> {
  const out: Array<{ text?: string; type?: string }> = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o.text === 'string') out.push(o);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function extractClaims(brief: string, model: string): Promise<Claim[]> {
  const raw = await chat(EXTRACT_PROMPT(brief), { model, temperature: 0, maxTokens: 8000 });
  let arr = parseJSON<Array<{ text?: string; type?: string }>>(raw);
  // 截断容错：完整解析失败时，从残缺数组里抢救出所有完整的 {...} 对象
  if (!Array.isArray(arr)) {
    arr = salvageObjects(raw);
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`claim extraction failed to parse; raw head: ${raw.slice(0, 200)}`);
  }
  return arr
    .filter((c) => c && typeof c.text === 'string' && c.text.trim().length > 0)
    .map((c, i) => ({
      id: i,
      text: (c.text as string).trim(),
      type: (c.type === 'analytical' ? 'analytical' : 'factual') as ClaimType,
    }));
}
