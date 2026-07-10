// 通过 ai-worker 的 /meridian/chat 调 judge LLM（DashScope），复用现有 eval 框架的模式。
const AI_WORKER_URL = process.env.AI_WORKER_URL || 'https://meridian-ai-worker.swj299792458.workers.dev';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// qwen-max 输出上限 ~8192，留余量作为截断重试的天花板
const OUTPUT_CAP = 8000;

// 单次调用：返回 content + finish_reason（'length' = 输出撞 max_tokens 被截断）
async function chatOnce(
  prompt: string,
  options: { model?: string; temperature?: number; maxTokens?: number }
): Promise<{ content: string; finishReason: string }> {
  const model = options.model || 'qwen-max';
  const body = {
    messages: [{ role: 'user', content: prompt }],
    options: {
      // JUDGE_MODEL=claude-* 时走 anthropic（跨家族判官通道），其余仍走 dashscope
      provider: model.startsWith('claude') ? 'anthropic' : 'dashscope',
      model,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 1500,
    },
  };

  // 代理网络已知不稳，单次失败重试，避免一个 blip 拖垮整轮 eval
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
        data?: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
      };
      const choice = data?.data?.choices?.[0];
      return { content: choice?.message?.content || '', finishReason: choice?.finish_reason || 'stop' };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
  }
  throw new Error(`chat failed after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

// 截断即重试：finish_reason==='length' 表示输出撞 max_tokens 被截断 → JSON 残缺 →
// 上游 parseJSON 失败 → judge 静默回退 unsupported（坏尺假象的一大来源，见 memory:
// intel-grounding-judge-validated 病根之二）。检测到就放大预算重问，直到自然收尾或触及
// 模型输出上限。放大而非一律高预算：常见短输出仍走小预算省 token，只有真被截断的尾部升级。
export async function chat(
  prompt: string,
  options: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  let maxTokens = options.maxTokens ?? 1500;
  for (;;) {
    const { content, finishReason } = await chatOnce(prompt, { ...options, maxTokens });
    const bumped = Math.min(maxTokens * 3, OUTPUT_CAP);
    // 截断信号跨家族：OpenAI 兼容(qwen)='length'，Anthropic='max_tokens'
    const truncated = finishReason === 'length' || finishReason === 'max_tokens';
    // 未截断，或已到输出上限无法再放大 → 返回（后者交由上游 salvage/兜底处理）
    if (!truncated || bumped <= maxTokens) return content;
    maxTokens = bumped;
  }
}

// 从可能带 ```json fenced / 前后噪声的 LLM 输出里抠出 JSON
export function parseJSON<T = any>(raw: string): T | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const f = raw.indexOf('{');
  const lb = raw.lastIndexOf('}');
  if (f >= 0 && lb > f) candidates.push(raw.slice(f, lb + 1));
  const fa = raw.indexOf('[');
  const la = raw.lastIndexOf(']');
  if (fa >= 0 && la > fa) candidates.push(raw.slice(fa, la + 1));
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
