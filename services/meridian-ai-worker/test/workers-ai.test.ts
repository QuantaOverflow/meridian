import { describe, expect, it, vi } from 'vitest'
import { chat, WORKERS_AI_MODELS } from '../src/services/workers-ai'

const GLM = '@cf/zai-org/glm-4.7-flash'
const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8'

/** Workers AI binding 是外部服务边界，允许 fake：只实现 chat() 用到的 run()。 */
function fakeAi(run: (model: string, inputs: Record<string, unknown>) => Promise<any>) {
  return { run: vi.fn(run) } as unknown as Ai
}

describe('workers-ai.chat', () => {
  it('未知模型在调用 ai.run 之前就抛错，不产生调用（先付费）', async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }))
    const ai = { run } as unknown as Ai

    await expect(
      chat(ai, { model: 'not-a-real-model', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('Model not found: not-a-real-model')

    expect(run).not.toHaveBeenCalled()
  })

  it('模型表只含两个现行模型', () => {
    expect(WORKERS_AI_MODELS).toEqual([QWEN, GLM])
  })

  it('thinking 关闭名单内的模型会下发 chat_template_kwargs.enable_thinking=false', async () => {
    let seenInputs: Record<string, unknown> | undefined
    const ai = fakeAi(async (_model, inputs) => {
      seenInputs = inputs
      return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }
    })

    await chat(ai, { model: GLM, messages: [{ role: 'user', content: 'hi' }] })

    expect(seenInputs?.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it('qwen3 关闭 thinking 后 content 恒为 null，用 reasoning_content 兜底正文', async () => {
    const ai = fakeAi(async () => ({
      choices: [{ message: { content: null, reasoning_content: '{"key":"value"}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 10 },
    }))

    const res = await chat(ai, { model: QWEN, messages: [{ role: 'user', content: 'hi' }] })

    expect(res.choices[0].message.content).toBe('{"key":"value"}')
  })

  it('空正文（无 reasoning 兜底）响亮失败，错误文本与现 ChatCapabilityHandler 逐字一致', async () => {
    const ai = fakeAi(async () => ({
      choices: [{ message: { content: null }, finish_reason: 'length' }],
      usage: { completion_tokens: 800 },
    }))

    await expect(
      chat(ai, { model: GLM, messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(
      `Workers AI binding failed: Workers AI 返回空正文 (model=${GLM}, finish_reason=length, reasoning=0字符, completion_tokens=800)`
    )
  })

  it('ai.run 抛出的错误被包成 "Workers AI binding failed: <原 message>"', async () => {
    const ai = fakeAi(async () => {
      throw new Error('3040: Capacity temporarily exceeded, please try again.')
    })

    await expect(
      chat(ai, { model: GLM, messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('Workers AI binding failed: 3040: Capacity temporarily exceeded, please try again.')
  })
})
