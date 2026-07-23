// intel-grounding harness 的 judge LLM 适配器：默认 qwen-max / max_tokens 1500，
// 支持 JUDGE_MODEL=claude-* 走 anthropic（跨家族判官通道，由共享层按 model 名自动路由）。
// 传输逻辑收敛到 ../_shared/judge-llm.ts；本文件只绑定默认值。下游 import 不变。
import { chat as sharedChat, parseJSON, type JudgeChatOptions } from '../_shared/judge-llm.js';

export { parseJSON };

export function chat(prompt: string, options: JudgeChatOptions = {}): Promise<string> {
  return sharedChat(prompt, { model: 'qwen-max', maxTokens: 1500, ...options });
}
