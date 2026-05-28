import { chat, parseJSON } from './llm.js';
import type { Claim } from './types.js';

const EXTRACT_PROMPT = (brief: string) => `
You extract atomic factual claims from a news brief, so each can be fact-checked
independently against source material.

# What counts as a claim
- ONE concrete, verifiable statement of fact: a single subject-predicate-object.
- Split compound sentences into separate claims.
- A claim must assert something checkable (who did what, when, how much, where).

# What to EXCLUDE (do not extract)
- Opinions, editorializing, predictions ("this could reshape...", "analysts worry").
- Section headers, transitions, meta sentences ("In other news", "This brief covers").
- Vague framing with no checkable fact.

# Brief
${brief}

# Output
Reply with ONLY a JSON array of strings inside a \`\`\`json fenced block. No prose.
Each string is one atomic claim, copied/paraphrased minimally from the brief.
Example: ["X announced Y on date Z", "Company A acquired B for $C"]
`.trim();

export async function extractClaims(brief: string, model: string): Promise<Claim[]> {
  const raw = await chat(EXTRACT_PROMPT(brief), { model, temperature: 0, maxTokens: 4000 });
  const arr = parseJSON<string[]>(raw);
  if (!Array.isArray(arr)) {
    throw new Error(`claim extraction failed to parse; raw head: ${raw.slice(0, 200)}`);
  }
  return arr
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .map((text, i) => ({ id: i, text: text.trim() }));
}
