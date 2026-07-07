// 通过 ai-worker 的 /meridian/chat 调 judge LLM（DashScope），复用 faithfulness 同款模式。
const AI_WORKER_URL = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  prompt: string,
  options: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const body = {
    messages: [{ role: 'user', content: prompt }],
    options: {
      provider: 'dashscope',
      model: options.model || 'qwen-long',
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 4000,
    },
  };

  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${AI_WORKER_URL}/meridian/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`chat call failed: ${resp.status} ${txt.slice(0, 200)}`);
      }
      const data = (await resp.json()) as {
        data?: { choices?: Array<{ message?: { content?: string } }> };
      };
      return data?.data?.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
  }
  throw new Error(`chat failed after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

// 从可能带 ```json fenced / 前后噪声的 LLM 输出里抠出 JSON（与 runtime parseJSONFromResponse 同精神）
export function parseJSON<T = any>(raw: string): T | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const f = raw.indexOf('{');
  const lb = raw.lastIndexOf('}');
  if (f >= 0 && lb > f) candidates.push(raw.slice(f, lb + 1));
  candidates.push(raw);
  for (const c of candidates) {
    const cleaned = c
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      /* next */
    }
  }
  return null;
}
