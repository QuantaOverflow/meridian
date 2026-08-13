/**
 * Reasoning 模型的思维链开关——单一真源。
 *
 * 两处依赖它，必须同源否则会漂移：
 * - ai-gateway.ts 决定给哪些模型下发 `chat_template_kwargs.enable_thinking=false`
 * - capabilities/chat.ts 决定哪些模型允许在 content 为空时用 reasoning 字段兜底
 *
 * 为什么要"允许兜底"这件事必须限定名单，而不是全局生效：
 * 思维链吃光 max_tokens 时，模型同样会返回 content=null + 一堆 reasoning。若无条件兜底，
 * 这类真故障就会被当成正常输出静默放行（正是 chat.ts 那段"空正文必须响亮地失败"要防的）。
 * 只有在**我们明确关掉了 thinking** 的前提下，reasoning 里装的才是正文而非思考链。
 *
 * 各模型关掉 thinking 后正文落在哪个字段并不统一，必须逐个实测：
 * - `@cf/zai-org/glm-*`  关掉后正文进 `content`（2026-08-12 实测：completion_tokens 950→183、10.7s→2.7s）
 * - `@cf/qwen/qwen3-*`   关掉后正文进 `reasoning_content`，`content` 恒为 null
 *   （2026-08-13 A/B，23 篇生产文章 ×2 轮：thinking OFF 时 content 非空 0/23，
 *    而 reasoning 里是完整的 9 字段 JSON 23/23）
 */
export const THINKING_OFF_MODELS = ['@cf/zai-org/glm-', '@cf/qwen/qwen3-']

/** 该模型是否由我们显式关闭了思维链 */
export function isThinkingDisabled(modelName: string): boolean {
  return THINKING_OFF_MODELS.some(prefix => modelName.startsWith(prefix))
}
