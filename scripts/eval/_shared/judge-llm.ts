// eval 判官的单一 LLM 客户端：通过 ai-worker 的 /meridian/chat 调 judge LLM。
//
// 抽此模块前，chat() + parseJSON() 在 7 个 harness 里各复制一份并已漂移（截断重试只在
// 2 份有、parseJSON 候选集/清洗规则各不相同、skipCache 靠每处手写）。commit e31fbf9
// 「8 个判官调用点补 skipCache」+ a3e4b8a「统一检测型判官指标到 _shared/metrics.ts」
// 就是缺这个共享层的直接代价。metrics/hygiene 已走这条路，LLM 传输层是明显的下一块。
//
// canonical 取值：
//   chat()      = intel-grounding/llm.ts 的超集（跨家族 provider 路由 + 截断信号
//                 'length'||'max_tokens'），是各副本里最全的一份。
//   parseJSON() = faithfulness/intel-grounding/llm.ts 那份（κ 验过的关键 harness 用的
//                 就是它）——两把验过的尺解析结果保持一字不变。

const DEFAULT_AI_WORKER_URL = 'https://meridian-ai-worker.swj299792458.workers.dev';

// qwen-max 输出上限 ~8192，留余量作为截断重试的天花板
const OUTPUT_CAP = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JudgeChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 覆盖自动 provider 路由（默认按 model 名：claude-* → anthropic，其余 → dashscope）。 */
  provider?: string;
  /** 覆盖 AI_WORKER_URL（story-validation 本地跑用 localhost:8788）。 */
  baseUrl?: string;
}

function resolveBaseUrl(options: JudgeChatOptions): string {
  return options.baseUrl || process.env.AI_WORKER_URL || DEFAULT_AI_WORKER_URL;
}

// 单次调用：返回 content + finish_reason（'length'/'max_tokens' = 输出撞 max_tokens 被截断）
async function chatOnce(
  prompt: string,
  options: JudgeChatOptions & { maxTokens: number }
): Promise<{ content: string; finishReason: string }> {
  const model = options.model || 'qwen-max';
  const body = {
    messages: [{ role: 'user', content: prompt }],
    options: {
      // JUDGE_MODEL=claude-* 时走 anthropic（跨家族判官通道），其余仍走 dashscope
      provider: options.provider || (model.startsWith('claude') ? 'anthropic' : 'dashscope'),
      model,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens,
      // eval 判官须独立采样：绕开 Gateway 默认缓存，否则重问逐字复读=样本量退化成 1
      // （见 hygiene.ts checkIndependentSamples）
      skipCache: true,
    },
  };

  const baseUrl = resolveBaseUrl(options);

  // 代理网络已知不稳，单次失败重试，避免一个 blip 拖垮整轮 eval
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/meridian/chat`, {
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

// 截断即重试：finish_reason==='length'/'max_tokens' 表示输出撞 max_tokens 被截断 →
// JSON 残缺 → 上游 parseJSON 失败 → judge 静默回退 unsupported（坏尺假象的一大来源，见
// memory: intel-grounding-judge-validated 病根之二）。检测到就放大预算重问，直到自然收尾
// 或触及模型输出上限。放大而非一律高预算：常见短输出仍走小预算省 token，只有真被截断的
// 尾部升级。截断信号跨家族：OpenAI 兼容(qwen)='length'，Anthropic='max_tokens'。
export async function chat(prompt: string, options: JudgeChatOptions = {}): Promise<string> {
  let maxTokens = options.maxTokens ?? 1500;
  for (;;) {
    const { content, finishReason } = await chatOnce(prompt, { ...options, maxTokens });
    const bumped = Math.min(maxTokens * 3, OUTPUT_CAP);
    const truncated = finishReason === 'length' || finishReason === 'max_tokens';
    // 未截断，或已到输出上限无法再放大 → 返回（后者交由上游 salvage/兜底处理）
    if (!truncated || bumped <= maxTokens) return content;
    maxTokens = bumped;
  }
}

// 从可能带 ```json fenced / 前后噪声的 LLM 输出里抠出 JSON。
// 候选顺序 = fenced → {…} → […] → 原文；清洗 = 去块注释 + 去尾逗号。
// 与 runtime parseJSONFromResponse 同精神（B 候选：将来抽到 src/utils 让 eval 与生产共享）。
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
