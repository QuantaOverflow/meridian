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
// 不适合 phase-default）、/meridian/chat（外部/eval 透传口，由 eval 侧 _shared/judge-llm.ts 管）。

export interface PhaseDefault {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  skipCache: boolean;
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
export const PHASE_DEFAULTS: Record<LLMCallPhase, PhaseDefault> = {
  story_validation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 4000, skipCache: true },
  intelligence_analysis: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8192, skipCache: true },
  // 去重确认 + 起标题：输出只有一个布尔加一句标题，300 token 绰绰有余。
  // temperature 0 —— 同一组故事每次都该得到同一个判定，这是判定不是创作。
  story_merge: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 300, skipCache: true },
  // 环1 RARR 接地校验：与情报分析同模型（需长上下文喂全部源），但 temp 0（edit-list 要确定性）。
  // maxTokens 维持 4000——2026-08-15 run 实测未截断响应的 completion_tokens 是 217..1853（21 条 edit
  // 已是最长的一份），4000 有 2 倍余量。**打满 4000 的那 4 份不是"清单太长"而是复读退化**
  // （span 去重后只剩 1/1/3/3 条，最高一条重复 64 次），加预算只会让循环跑更久，故不加。
  intel_grounding_verify: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 4000, skipCache: true },
  brief_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000, skipCache: true },
  tldr_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.1, maxTokens: 8000, skipCache: true },
  // 散文摘要只有 2-3 句（实测 completion 60-120 token），800 有 6 倍以上余量；
  // temperature 0 —— 摘要要可复现，不需要创造性。
  tldr_prose_generation: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 800, skipCache: true },
  faithfulness_check: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 800, skipCache: true },
  faithfulness_revise: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0, maxTokens: 800, skipCache: true },
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
    metadata: overrides.metadata ?? { requestId: `${phase}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, timestamp: Date.now() },
  };
  const t: TraceContext = overrides.callIndex != null ? { ...trace, callIndex: overrides.callIndex } : trace;
  return loggedChat(aiGateway, env, t, phase, request).then(async res => {
    // AIResponse 是联合类型（含 EmbeddingResponse），这里恒为 chat 分支，故用 in 收窄
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
