/**
 * Reasoning 模型的思维链开关——单一真源。
 *
 * 两处依赖它，必须同源否则会漂移（现都在 services/workers-ai.ts）：
 * - `chat()` 按 `thinkingOffKwargs` 决定给哪些模型下发哪组 `chat_template_kwargs`
 * - `mapResponse()` 按 `readsReasoningAsContent` 决定哪些模型允许在 content 为空时用 reasoning 字段兜底
 *
 * 为什么要"允许兜底"这件事必须限定名单，而不是全局生效：
 * 思维链吃光 max_tokens 时，模型同样会返回 content=null + 一堆 reasoning。若无条件兜底，
 * 这类真故障就会被当成正常输出静默放行（正是 mapResponse 那段"空正文必须响亮地失败"要防的）。
 * 只有在**我们明确关掉了 thinking、且实测过正文落在 reasoning 字段**的前提下，reasoning 里装的才是正文。
 *
 * 各模型关掉 thinking 后正文落在哪个字段并不统一，必须逐个实测：
 * - `@cf/zai-org/glm-*`  关掉后正文进 `content`（2026-08-12 实测：completion_tokens 950→183、10.7s→2.7s）
 * - `@cf/qwen/qwen3-*`   关掉后正文进 `reasoning_content`，`content` 恒为 null
 *   （2026-08-13 A/B，23 篇生产文章 ×2 轮：thinking OFF 时 content 非空 0/23，
 *    而 reasoning 里是完整的 9 字段 JSON 23/23）
 * - deepseek-v4-pro / qwen3.8（写作–核查循环，ADR 0010）：原型经 REST 下发
 *   `{ enable_thinking: false, thinking: false }`（deepseek 的模板读 `thinking`），只读 `content` 就全部拿到正文，
 *   所以不进兜底名单。注意 `qwen3.8` 不匹配 `@cf/qwen/qwen3-` 前缀，要单列。
 */
const THINKING_OFF_FAMILIES = ['@cf/zai-org/glm-', '@cf/qwen/qwen3-']
const THINKING_OFF_BOTH_KEYS = ['@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/qwen/qwen3.8-27b']

/** 关掉思维链要下发的 `chat_template_kwargs`；不由我们关思维链的模型返回 null（不下发）。 */
export function thinkingOffKwargs(modelName: string): Record<string, boolean> | null {
  if (THINKING_OFF_BOTH_KEYS.includes(modelName)) return { enable_thinking: false, thinking: false }
  if (THINKING_OFF_FAMILIES.some(prefix => modelName.startsWith(prefix))) return { enable_thinking: false }
  return null
}

/** content 为空时能否把 reasoning 字段当正文：只限实测过的老家族（见文件头） */
export function readsReasoningAsContent(modelName: string): boolean {
  return THINKING_OFF_FAMILIES.some(prefix => modelName.startsWith(prefix))
}
