// faithfulness harness 的 judge LLM 适配器：默认 qwen-max / max_tokens 1500。
// 传输逻辑（网络重试 + 截断重试 + JSON 抠取）收敛到 ../_shared/judge-llm.ts 单一真源；
// 本文件只绑定本 harness 的默认值。下游 import { chat, parseJSON } from './llm.js' 不变。
import { chat as sharedChat, parseJSON, type JudgeChatOptions } from '../_shared/judge-llm.js';

export { parseJSON };

export function chat(prompt: string, options: JudgeChatOptions = {}): Promise<string> {
  return sharedChat(prompt, { model: 'qwen-max', maxTokens: 1500, ...options });
}
