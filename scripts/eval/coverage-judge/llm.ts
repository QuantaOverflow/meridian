// coverage-judge harness 的 judge LLM 适配器：默认 qwen-long / max_tokens 4000。
// 传输逻辑收敛到 ../_shared/judge-llm.ts（此处随之补齐原本缺失的截断重试）；本文件只绑
// 定默认值。下游 import { chat, parseJSON } from './llm.js' 不变。
import { chat as sharedChat, parseJSON, type JudgeChatOptions } from '../_shared/judge-llm.js';

export { parseJSON };

export function chat(prompt: string, options: JudgeChatOptions = {}): Promise<string> {
  return sharedChat(prompt, { model: 'qwen-long', maxTokens: 4000, ...options });
}
