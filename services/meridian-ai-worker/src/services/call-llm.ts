import type { AIGatewayService } from './ai-gateway';
import type { AIResponse, ChatMessage, CloudflareEnv } from '../types';
import { loggedChat, type LLMCallPhase, type TraceContext } from './llm-call-logger';

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

// 各值照迁移前现状推导（行为不变）；skipCache 见上（Q6-B）。
export const PHASE_DEFAULTS: Record<LLMCallPhase, PhaseDefault> = {
  story_validation: { provider: 'dashscope', model: 'qwen-plus', temperature: 0.1, maxTokens: 4000, skipCache: true },
  intelligence_analysis: { provider: 'dashscope', model: 'qwen-long', temperature: 0.1, maxTokens: 8192, skipCache: true },
  brief_generation: { provider: 'dashscope', model: 'qwen-plus', temperature: 0.1, maxTokens: 8000, skipCache: true },
  tldr_generation: { provider: 'dashscope', model: 'qwen-plus', temperature: 0.1, maxTokens: 8000, skipCache: true },
  faithfulness_check: { provider: 'dashscope', model: 'qwen-max', temperature: 0, maxTokens: 800, skipCache: true },
  faithfulness_revise: { provider: 'dashscope', model: 'qwen-max', temperature: 0, maxTokens: 800, skipCache: true },
  // 未迁移，占位（strategy-driven，各值由 index.ts 的 analysisStrategies 每次给）
  article_analysis: { provider: 'workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', temperature: 0, maxTokens: 6000, skipCache: false },
  other: { provider: 'dashscope', model: 'qwen-plus', temperature: 0.1, maxTokens: 4000, skipCache: false },
};

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
  return loggedChat(aiGateway, env, t, phase, request);
}
