import type { AIResponse, ChatMessage, ChatResponse, CloudflareEnv } from '../types';
import { loggedChat, type LLMCallPhase, type TraceContext } from './llm-call-logger';
import { recordSensor } from './sensor-log';
import { Logger } from '../utils/logger';

const logger = new Logger({ component: 'call-llm' });

// 「调 LLM」的单一配置入口（候选 A）。抽此层前，provider/model/temperature 散在
// 各 service 的 callAI/callJudge helper 里各写一份并已漂移：temperature 默认 `?? 0.1` 五份副本、
// model/provider 四处重抄。
//
// 形状：phase 给一套默认，caller 只覆盖真不同的（确定性子调用传 temperature:0、主生成传 model）。
// 只管配置解析；观测落盘仍是下一层 loggedChat 的职责（各司一职）。
//
// 未收编：/meridian/chat（外部透传口）。article_analysis 经 callLLMUntilAccepted 进来，
// 但 provider/model/temp 每档都由 index.ts 的 analysisStrategies 给全，phase 默认值对它不生效。

interface PhaseDefault {
  model: string;
  temperature: number;
  maxTokens: number;
}

// 2026-08-12：简报管线 phase 从 DashScope 迁到 Workers AI（CF 原生），摆脱阿里云凭证依赖。
// 选 glm-4.7-flash：131k 上下文 + $0.0605/M 输入（同档最便宜）。
//
// maxTokens 沿用迁移前的值——本地实测（真实 prompt，服务端日志判定）实际 completion_tokens：
//   brief_generation 429-563 / 8000，4x 以上余量。
//
// ⚠️ glm-4.7-flash 是 reasoning 模型且**默认开思维链**，thinking token 计入 max_tokens 且先于正文生成
// ——不关的话小预算 phase 会被思维链吃光、正文为空。关闭名单在 config/thinking.ts，
// 下发动作在 services/workers-ai.ts 的 chat()，不在这层。
const PHASE_DEFAULTS: Record<LLMCallPhase, PhaseDefault> = {
  brief_generation: { model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000 },
  // 散文摘要只有 2-3 句（实测 completion 60-120 token），800 有 6 倍以上余量；
  // temperature 0 —— 摘要要可复现，不需要创造性。
  tldr_prose_generation: { model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 800 },
  cluster_judge: { model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 1200 },
  // 故事排序：一次看当期全部候选标题（46-51 条约 1400 词），输出前 12 + 5 条落选。
  // maxTokens 3000 沿用离线实测值（两期各 3 轮，6 次调用 completion 全部在预算内，无截断）。
  story_rank: { model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 3000 },
  // 简报块 v6：窗口标重点 + 一次写作，两种调用共用这个 phase（callIndex 区分 R2 key）。
  // maxTokens 8000 与 temperature 0.1 沿用原型实测值（原型 chatJson 的 max_tokens=8000）。
  // **不设 frequency_penalty**：原型没有它，而 v6 与生产的那份对比读数（同 3 簇，写作层
  // 缺陷 0/12 对 5/14）就是在没有它的配置下测出来的。移植时曾按本仓 glm-4.7-flash 的既有
  // 防复读约定加到 0.4，c12 随即出现窗口 3 三次全被 anchorOk 拒（模型引窗口外 articleId 或
  // 越界句号）、丢掉 4 篇材料，而原型同一输入 4 窗全过。是不是它导致的没有验，但这里的取舍
  // 很清楚：实测过的配置优先于未实测的约定。复读由解析处的 detectRepetition 挡（见
  // services/brief-block-v6.ts），那才是真正拦得住的那层。
  brief_block_v6: { model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000 },
  // 占位（strategy-driven，各值由 index.ts 的 analysisStrategies 每次给）
  article_analysis: { model: '@cf/qwen/qwen3-30b-a3b-fp8', temperature: 0, maxTokens: 6000 },
};

// —— 输出语言传感器 ——
// 这些 phase 产出的是英文（生产历史如此：reports 表全英文），但**没有任何 prompt 约束语言**
// ——一直是"模型默认恰好对上"。换模型让这份运气变成风险，而 Workers AI / OpenAI 兼容 schema
// 里**没有任何控制输出语言的参数**（查过 31 个入参，无 language/lang/locale；chat_template_kwargs
// 只管 thinking）。故不改 prompt（改了要重跑 eval，且给已验证正确的行为加约束本身有扰动风险），
// 改为事后检测：纯传感器，只告警不改行为。
//
// 阈值 20%：源里有约 1.2% 的中文文章（近 90 天 212/17483），情报报告的 date_source 要求逐字抄原文，
// 因此少量 CJK 是**合法**的；而模型真的切换语言时占比是 60-80%（实测 glm 正常输出为 0%）。
// 20% 落在两者之间，留足余量。
const CJK_ALARM_RATIO = 0.2;
const CJK_ALARM_MIN_CHARS = 40; // 短输出里几个汉字不足以判断，避免噪声告警
// 文章分析不挂这个传感器：它的输入本来就可能是中文文章，且它历史上直接调 loggedChat、
// 从没过这层——收进 callLLMUntilAccepted 时保持原样，不新增告警与 R2 写入。
const LANG_SENSOR_SKIP: ReadonlySet<LLMCallPhase> = new Set(['article_analysis']);

function checkOutputLanguage(phase: LLMCallPhase, content: string): { cjk: number; ratio: number } | null {
  if (content.length < CJK_ALARM_MIN_CHARS) return null;
  const cjk = content.match(/[一-鿿]/g)?.length ?? 0;
  const ratio = cjk / content.length;
  if (ratio <= CJK_ALARM_RATIO) return null;
  logger.error(`[LangSensor] ${phase} 输出疑似切换到中文：CJK ${cjk}/${content.length} 字符 ` +
    `(${(ratio * 100).toFixed(1)}% > ${CJK_ALARM_RATIO * 100}%)。样本: ${JSON.stringify(content.slice(0, 200))}`);
  return { cjk, ratio };
}

export interface CallLLMOverrides {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: any;
  /** 合并进 trace 的 callIndex（同 phase 多次调用去重 R2 key）。 */
  callIndex?: number;
  /**
   * 约束式解码（Workers AI JSON mode）。不传就是原行为，向后兼容。
   * 加它是因为实测的头号报废形态是**模型压根没开始写 JSON**：28 份抽取响应里 17 份把
   * 8192 token 全烧在标签外的散文草稿上。约束式解码下这种形态结构上不可能。
   * ⚠️ 逐模型的支持情况官方没给列表，不支持的模型是静默忽略还是报错未知——
   * 调用方必须自己核验产出是否真被约束住，不能因为返回 200 就当它生效。
   */
  responseFormat?: { type: 'json_schema'; json_schema: Record<string, unknown> } | { type: 'json_object' };
}

// phase 默认 + caller 覆盖 → 建 chat 请求 → loggedChat（观测+发送）→ 返回 AIResponse。
// caller 保持自己对返回的处理（读 choices / finish_reason / 截断重试），故返回原始 AIResponse。
export function callLLM(
  ai: Ai,
  env: CloudflareEnv,
  trace: TraceContext,
  phase: LLMCallPhase,
  messages: ChatMessage[],
  overrides: CallLLMOverrides = {}
): Promise<AIResponse> {
  const d = PHASE_DEFAULTS[phase];
  const request = {
    messages,
    provider: overrides.provider,
    model: overrides.model ?? d.model,
    // ?? 而非 ||：确定性子调用显式传 temperature:0，|| 会吞成默认
    temperature: overrides.temperature ?? d.temperature,
    max_tokens: overrides.maxTokens ?? d.maxTokens,
    ...(overrides.responseFormat ? { response_format: overrides.responseFormat } : {}),
    metadata: overrides.metadata ?? { requestId: `${phase}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, timestamp: Date.now() },
  };
  const t: TraceContext = overrides.callIndex != null ? { ...trace, callIndex: overrides.callIndex } : trace;
  return loggedChat(ai, env, t, phase, request).then(async res => {
    const content = res.choices?.[0]?.message?.content ?? '';
    const alarm = LANG_SENSOR_SKIP.has(phase) ? null : checkOutputLanguage(phase, content);
    // 只在报警时落 R2：语言正确是常态，每次调用都写一条会把 sensors/ 目录淹了，
    // 而"没有记录"在这里等价于"没报警"（与卫生检查器不同——那个零命中也有信息量）。
    if (alarm) {
      await recordSensor(env, t, 'output_language', {
        phase, ...alarm, contentChars: content.length, sample: content.slice(0, 300),
      }, t.callIndex ?? 0);
    }
    return res;
  });
}

// ============================================================================
// 多次尝试：「调 LLM 直到拿到合格结果」的单一实现
// ============================================================================
// 此前文章分析（2 档模型）、简报块 v6 的 chatJson（3 次温度 + 诊断回传）、散文摘要
// （只重试可自愈错误、指数退避）各写一套循环。三者的差异全在 policy 里，循环只有这一份。

/** usage.neurons 是 Workers AI 的计费单位，类型里没有（各 provider 的 usage 字段不同），运行时有。 */
export function neuronsOf(res: ChatResponse): number {
  return Number((res.usage as { neurons?: number } | undefined)?.neurons ?? 0);
}

/**
 * 这次失败值不值得重试。
 *
 * 除配额/限流，还覆盖 Workers AI 两类会自愈的失败：
 * `3040: Capacity temporarily exceeded`、`3046: Request timeout`。
 *
 * 2026-09-25 去掉了原来的 `ai gateway` / `no response received` 两条：Gateway 已不在调用链上，
 * 而 brief-generation 把**所有**错误都包成 "AI Gateway request failed: …"，于是任何失败
 * （含空正文这类重试也不会变的）都被当成配额错误退避重试 4 次。
 * `invalid api key` 这类永不自愈的错误有意不认：让它立刻失败、立刻可见
 * （这个仓库为它付过代价：一次 key 失效让整条管线静默停摆 12 天）。
 */
export function isTransientLLMError(error: any): boolean {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorString = JSON.stringify(error).toLowerCase();

  return (
    errorMessage.includes('quota') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('resource exhausted') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('capacity temporarily exceeded') ||
    errorMessage.includes('request timeout') ||
    errorString.includes('quota') ||
    errorString.includes('rate_limit') ||
    errorString.includes('429')
  );
}

export type AttemptVerdict<T> = { ok: true; value: T } | { ok: false; reasons: string[] };

/**
 * 全部尝试都没拿到合格结果。
 * `lastError`：最后一次尝试的失败——调用抛的错原样；accept 拒绝则是 `new Error(reasons.join(' | '))`。
 * `neurons`：失败的尝试也花了钱，调用方要记账。
 */
export class LLMAttemptsExhausted extends Error {
  constructor(public lastError: unknown, public attempts: number, public neurons: number) {
    super(`LLM attempts exhausted after ${attempts}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    this.name = 'LLMAttemptsExhausted';
  }
}

export interface AttemptPolicy<T> {
  /** 最多尝试几次。 */
  attempts: number;
  /**
   * 第 attempt 次（0 起）的 callLLM 覆盖项。是函数不是数组：v6 的 callIndex 取自多个窗口共用的
   * 计数器、摘要每次要新 requestId，都得在发出这一次调用的时刻算。
   */
  overrides: (attempt: number) => CallLLMOverrides;
  /** 这一次的 prompt。lastReasons = 上一次 accept 拒绝的原因（调用抛错 / 首次为空）。 */
  prompt: (attempt: number, lastReasons: string[]) => string;
  /** 解析 + 校验（含截断、复读）。拒绝 → 下一次；**抛错 = 不可重试，原样抛出**。 */
  accept: (res: ChatResponse, attempt: number) => AttemptVerdict<T>;
  /** 调用抛错时是否进下一次。 */
  retryOnError: (error: unknown, attempt: number) => boolean;
  /** 第 attempt 次失败后、下一次之前等多久；最后一次失败后不问。0 = 不等。 */
  backoffMs: (attempt: number) => number;
}

export async function callLLMUntilAccepted<T>(
  ai: Ai,
  env: CloudflareEnv,
  trace: TraceContext,
  phase: LLMCallPhase,
  policy: AttemptPolicy<T>
): Promise<{ value: T; attempts: number; neurons: number }> {
  let neurons = 0;
  let lastReasons: string[] = [];
  let lastError: unknown = null;
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    const overrides = policy.overrides(attempt);
    const prompt = policy.prompt(attempt, lastReasons);
    let res: ChatResponse | null = null;
    try {
      res = await callLLM(ai, env, trace, phase, [{ role: 'user', content: prompt }], overrides);
    } catch (e) {
      lastError = e;
      lastReasons = [];
      if (!policy.retryOnError(e, attempt)) throw new LLMAttemptsExhausted(e, attempt + 1, neurons);
    }
    if (res) {
      neurons += neuronsOf(res);
      const verdict = policy.accept(res, attempt);
      if (verdict.ok) return { value: verdict.value, attempts: attempt + 1, neurons };
      lastReasons = verdict.reasons;
      lastError = new Error(verdict.reasons.join(' | '));
    }
    if (attempt < policy.attempts - 1) {
      const ms = policy.backoffMs(attempt);
      if (ms > 0) await new Promise(r => setTimeout(r, ms));
    }
  }
  throw new LLMAttemptsExhausted(lastError, policy.attempts, neurons);
}
