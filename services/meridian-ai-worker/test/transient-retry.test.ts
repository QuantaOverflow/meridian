import { describe, expect, it } from 'vitest'
import { callLLMUntilAccepted, isTransientLLMError } from '../src/services/call-llm'

/** 数调用了几次：1 次 = 没重试，attempts 次 = 重试到头（散文摘要的策略：只重试可自愈错误） */
async function attempts(message: string): Promise<number> {
  let calls = 0
  const ai = {
    run: async () => {
      calls++
      throw new Error(message)
    },
  } as unknown as Ai
  await callLLMUntilAccepted(ai, { AI: ai }, {}, 'tldr_prose_generation', {
    attempts: 3,
    overrides: () => ({}),
    prompt: () => 'P',
    accept: () => ({ ok: true, value: null }),
    retryOnError: isTransientLLMError,
    backoffMs: () => 0,
  }).catch(() => {})
  return calls
}

describe('isTransientLLMError 驱动的重试', () => {
  it('重试 Workers AI 会自愈的失败', async () => {
    expect(await attempts('Workers AI binding failed: 3040: Capacity temporarily exceeded, please try again.')).toBe(3)
    expect(await attempts('Workers AI binding failed: 3046: Request timeout')).toBe(3)
    expect(await attempts('429 Too Many Requests')).toBe(3)
  })

  it('重试不会变的失败立刻抛出', async () => {
    expect(await attempts('模型返回空正文')).toBe(1)
    expect(await attempts('Workers AI binding failed: Workers AI 返回空正文 (model=@cf/zai-org/glm-4.7-flash)')).toBe(1)
    // 原来 brief-generation 把所有错误包成这个前缀，于是一律被当配额错误重试
    expect(await attempts('AI Gateway request failed: 模型返回空正文')).toBe(1)
  })
})
