import { chat, parseJSON } from './llm.js';
import type { Claim, ClaimType } from './types.js';
// 复用 faithfulness 的 claim 抽取 prompt（单一真源）。情报报告 prose 与 brief 同样混合 fact+解读，
// 同一套原子化 + factual/analytical 分类规则适用，避免再造一份易漂移的 prompt。
import { EXTRACT_PROMPT } from '../../../services/meridian-ai-worker/src/services/faithfulness-prompts.js';

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

export async function extractClaims(reportProse: string, model: string): Promise<Claim[]> {
  const raw = await chat(EXTRACT_PROMPT(reportProse), { model, temperature: 0, maxTokens: 8000 });
  let arr = parseJSON<Array<{ text?: string; type?: string }>>(raw);
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
