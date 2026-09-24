import type { AIGatewayService } from './ai-gateway';
import type { AIResponse, ChatMessage, CloudflareEnv } from '../types';
import { loggedChat, type LLMCallPhase, type TraceContext } from './llm-call-logger';
import { recordSensor } from './sensor-log';

// 「调 LLM」的单一配置入口（候选 A）。抽此层前，provider/model/temperature/skipCache 散在
// 各 service 的 callAI/callJudge helper 里各写一份并已漂移：temperature 默认 `?? 0.1` 五份副本、
// skipCache 忘传(story_validation/brief/tldr/faithfulness 全没传)、model/provider 四处重抄。
//
// 形状：phase 给一套默认，caller 只覆盖真不同的（确定性子调用传 temperature:0、主生成传 model）。
// 只管配置解析；观测落盘仍是下一层 loggedChat 的职责（各司一职）。
//
// skipCache=true 是 Q6-B 的「填对」：原本忘传的 DashScope phase 现在恒 skipCache——因 DashScope
// 的正向缓存 cache_ttl 从未接通(custom-path 绕开 enhancementService)，此刻是 no-op(行为不变)，
// 但把「判官/生成须独立采样」的正确性锁死，防将来缓存修活时旧「忘传」复发。
//
// 未收编：article_analysis（index.ts strategy-driven，provider/model/temp 每次重试换，
// 不适合 phase-default）、/meridian/chat（外部透传口）。

interface PhaseDefault {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  skipCache: boolean;
  /** 复读抑制，按 phase 配。不填就不下发（保持原行为）。 */
  frequencyPenalty?: number;
}

// 2026-08-12：简报管线五个 phase 从 DashScope 迁到 Workers AI（CF 原生），摆脱阿里云凭证依赖。
// 背景：DashScope key 自 2026-07-29 起 401，文章管线已靠 Workers AI 兜底恢复，但这五个 phase
// 无兜底 → 简报完全生成不了。选 glm-4.7-flash：131k 上下文 + $0.0605/M 输入（同档最便宜）。
//
// maxTokens 全部沿用迁移前的值——本地实测（真实 prompt，服务端日志判定）各 phase 实际 completion_tokens：
//   intelligence_analysis 1510-1618 / 8192、story_validation 609-793 / 4000、
//   brief_generation 429-563 / 8000、tldr 40-42 / 8000、faithfulness 172-196 / 800，均 4x 以上余量。
//
// ⚠️ glm-4.7-flash 是 reasoning 模型且**默认开思维链**，thinking token 计入 max_tokens 且先于正文生成
// ——不关的话 faithfulness 的 800 预算会被思维链吃光、正文为空。关闭动作在 ai-gateway.ts
// executeWorkersAIViaBinding（THINKING_OFF_MODELS），不在这层。
const PHASE_DEFAULTS: Record<LLMCallPhase, PhaseDefault> = {
  brief_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000, skipCache: true },
  tldr_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000, skipCache: true },
  // 散文摘要只有 2-3 句（实测 completion 60-120 token），800 有 6 倍以上余量；
  // temperature 0 —— 摘要要可复现，不需要创造性。
  tldr_prose_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 800, skipCache: true },
  cluster_judge: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 1200, skipCache: true },
  // 故事排序：一次看当期全部候选标题（46-51 条约 1400 词），输出前 12 + 5 条落选。
  // maxTokens 3000 沿用离线实测值（两期各 3 轮，6 次调用 completion 全部在预算内，无截断）。
  // skipCache 必须为 true：三轮洗牌虽然 prompt 不同不会互相命中，但跨期若有相同候选集
  // 会静默复用旧排序——Gateway 默认缓存曾把一次 eval 的样本量退化成 1。
  story_rank: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 3000, skipCache: true },
  // 简报块 v6：窗口标重点 + 一次写作，两种调用共用这个 phase（callIndex 区分 R2 key）。
  // maxTokens 8000 与 temperature 0.1 沿用原型实测值（原型 chatJson 的 max_tokens=8000）。
  // **不设 frequency_penalty**：原型没有它，而 v6 与生产的那份对比读数（同 3 簇，写作层
  // 缺陷 0/12 对 5/14）就是在没有它的配置下测出来的。移植时曾按本仓 glm-4.7-flash 的既有
  // 防复读约定加到 0.4，c12 随即出现窗口 3 三次全被 anchorOk 拒（模型引窗口外 articleId 或
  // 越界句号）、丢掉 4 篇材料，而原型同一输入 4 窗全过。是不是它导致的没有验，但这里的取舍
  // 很清楚：实测过的配置优先于未实测的约定。复读由解析处的 detectRepetition 挡（见
  // services/brief-block-v6.ts），那才是真正拦得住的那层。
  brief_block_v6: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000, skipCache: true },
  // 未迁移，占位（strategy-driven，各值由 index.ts 的 analysisStrategies 每次给）
  article_analysis: { provider: 'workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', temperature: 0, maxTokens: 6000, skipCache: false },
  other: { provider: 'dashscope', model: 'qwen-plus', temperature: 0.1, maxTokens: 4000, skipCache: false },
};

// —— 输出语言传感器 ——
// 这五个 phase 产出的是英文（生产历史如此：reports 表全英文），但**没有任何 prompt 约束语言**
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

function checkOutputLanguage(phase: LLMCallPhase, content: string): { cjk: number; ratio: number } | null {
  if (content.length < CJK_ALARM_MIN_CHARS) return null;
  const cjk = content.match(/[一-鿿]/g)?.length ?? 0;
  const ratio = cjk / content.length;
  if (ratio <= CJK_ALARM_RATIO) return null;
  console.error(
    `[LangSensor] ${phase} 输出疑似切换到中文：CJK ${cjk}/${content.length} 字符 ` +
    `(${(ratio * 100).toFixed(1)}% > ${CJK_ALARM_RATIO * 100}%)。样本: ${JSON.stringify(content.slice(0, 200))}`
  );
  return { cjk, ratio };
}

export interface CallLLMOverrides {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  skipCache?: boolean;
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
  /**
   * 复读抑制。glm-4.7-flash 的模型页列了 frequency_penalty / presence_penalty，
   * 2026-09-09 实测确认真下发：同 prompt、temperature 0、seed 42，带与不带产出不同
   * （72 → 113 token）。确定性设置下输出还变，说明参数到了模型而不是被静默丢弃。
   *
   * 为什么需要：写作调用会偶发打满 maxTokens 复读同一句（实测 25 块里 1 块，
   * 12,407 字符 / 同句 80 遍）。
   *
   * ⚠️ 生效 ≠ 有益：penalty 会一并压制**正常的重复**（专有名词、当事方名字在一段里
   * 反复出现是新闻文体的常态）。调大到伤文风的临界点没测过，别随手往上调。
   */
  frequencyPenalty?: number;
  presencePenalty?: number;
}

// phase 默认 + caller 覆盖 → 建 chat 请求 → loggedChat（观测+发送）→ 返回 AIResponse。
// caller 保持自己对返回的处理（读 choices / finish_reason / 截断重试），故返回原始 AIResponse。
export function callLLM(
  aiGateway: AIGatewayService,
  env: CloudflareEnv,
  trace: TraceContext,
  phase: LLMCallPhase,
  messages: ChatMessage[],
  overrides: CallLLMOverrides = {}
): Promise<AIResponse> {
  const d = PHASE_DEFAULTS[phase];
  const request = {
    capability: 'chat' as const,
    messages,
    provider: overrides.provider ?? d.provider,
    model: overrides.model ?? d.model,
    // ?? 而非 ||：确定性子调用显式传 temperature:0，|| 会吞成默认
    temperature: overrides.temperature ?? d.temperature,
    max_tokens: overrides.maxTokens ?? d.maxTokens,
    skipCache: overrides.skipCache ?? d.skipCache,
    ...(overrides.responseFormat ? { response_format: overrides.responseFormat } : {}),
    // 先 overrides 后 phase 默认——只读 overrides 会让写在 PHASE_DEFAULTS 里的值静默不下发
    // （2026-09-10 加 intelligence_analysis 的 frequencyPenalty 时就踩了这个）。
    ...((overrides.frequencyPenalty ?? d.frequencyPenalty) != null
      ? { frequency_penalty: overrides.frequencyPenalty ?? d.frequencyPenalty } : {}),
    ...(overrides.presencePenalty != null ? { presence_penalty: overrides.presencePenalty } : {}),
    metadata: overrides.metadata ?? { requestId: `${phase}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, timestamp: Date.now() },
  };
  const t: TraceContext = overrides.callIndex != null ? { ...trace, callIndex: overrides.callIndex } : trace;
  return loggedChat(aiGateway, env, t, phase, request).then(async res => {
    if ('choices' in res) {
      const content = res.choices?.[0]?.message?.content ?? '';
      const alarm = checkOutputLanguage(phase, content);
      // 只在报警时落 R2：语言正确是常态，每次调用都写一条会把 sensors/ 目录淹了，
      // 而"没有记录"在这里等价于"没报警"（与卫生检查器不同——那个零命中也有信息量）。
      if (alarm) {
        await recordSensor(env, t, 'output_language', {
          phase, ...alarm, contentChars: content.length, sample: content.slice(0, 300),
        }, t.callIndex ?? 0);
      }
    }
    return res;
  });
}
