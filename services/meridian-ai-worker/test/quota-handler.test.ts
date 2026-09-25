import { describe, expect, it } from 'vitest'
import { QuotaHandler } from '../src/utils/quota-handler'

/** 数 operation 被调了几次：1 次 = 没重试，maxRetries+1 次 = 重试到头 */
async function attempts(message: string): Promise<number> {
  let calls = 0
  await QuotaHandler.retryWithBackoff(async () => {
    calls++
    throw new Error(message)
  }, 2, 0).catch(() => {})
  return calls
}

describe('QuotaHandler.retryWithBackoff', () => {
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
