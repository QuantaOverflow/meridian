// @vitest-environment node
/**
 * callLLMUntilAccepted：「调 LLM 直到拿到合格结果」的单一实现（services/call-llm.ts）。
 * 只 fake Workers AI binding（外部边界）；退避由 policy 注入 0 毫秒。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  callLLMUntilAccepted,
  isTransientLLMError,
  LLMAttemptsExhausted,
  neuronsOf,
  type AttemptVerdict,
} from '../src/services/call-llm'

const GLM = '@cf/zai-org/glm-4.7-flash'
const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8'

type Step = Error | string
interface Seen { model: string; inputs: Record<string, any> }

function fakeAi(steps: Step[]) {
  const seen: Seen[] = []
  const ai = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs })
      const s = steps[Math.min(seen.length - 1, steps.length - 1)]
      if (s instanceof Error) throw s
      return { choices: [{ message: { content: s }, finish_reason: 'stop' }], usage: { neurons: 7 } }
    }),
  } as unknown as Ai
  return { ai, seen, env: { AI: ai } }
}

const acceptOk = (res: { choices: Array<{ message: { content: string } }> }): AttemptVerdict<string> => {
  const c = res.choices[0].message.content
  return c.startsWith('ok') ? { ok: true, value: c } : { ok: false, reasons: [`bad:${c}`] }
}

describe('callLLMUntilAccepted', () => {
  it('每次尝试用各自的 overrides；accept 通过即返回，neurons 累加', async () => {
    const f = fakeAi(['nope', 'ok!'])
    const r = await callLLMUntilAccepted(f.ai, f.env, {}, 'article_analysis', {
      attempts: 2,
      overrides: i => [
        { model: QWEN, temperature: 0.1, maxTokens: 4000 },
        { model: GLM, temperature: 0.2, maxTokens: 3000 },
      ][i],
      prompt: () => 'P',
      accept: acceptOk,
      retryOnError: () => true,
      backoffMs: () => 0,
    })
    expect(r).toEqual({ value: 'ok!', attempts: 2, neurons: 14 })
    expect(f.seen.map(s => [s.model, s.inputs.temperature, s.inputs.max_tokens])).toEqual([
      [QWEN, 0.1, 4000],
      [GLM, 0.2, 3000],
    ])
  })

  it('accept 拒绝时把 reasons 带进下一次 prompt；调用抛错后 reasons 清空', async () => {
    const f = fakeAi(['nope', new Error('boom'), 'ok'])
    const calls: Array<[number, string[]]> = []
    await callLLMUntilAccepted(f.ai, f.env, {}, 'brief_block_v6', {
      attempts: 3,
      overrides: () => ({}),
      prompt: (i, reasons) => { calls.push([i, reasons]); return `P${i}|${reasons.join(',')}` },
      accept: acceptOk,
      retryOnError: () => true,
      backoffMs: () => 0,
    })
    expect(calls).toEqual([[0, []], [1, ['bad:nope']], [2, []]])
    expect(f.seen.map(s => s.inputs.messages[0].content)).toEqual(['P0|', 'P1|bad:nope', 'P2|'])
  })

  it('retryOnError=false 时首个错误即抛 LLMAttemptsExhausted，带 lastError', async () => {
    const f = fakeAi([new Error('fatal')])
    const err = await callLLMUntilAccepted(f.ai, f.env, {}, 'tldr_prose_generation', {
      attempts: 4,
      overrides: () => ({}),
      prompt: () => 'P',
      accept: acceptOk,
      retryOnError: () => false,
      backoffMs: () => 0,
    }).catch(e => e)
    expect(f.seen).toHaveLength(1)
    expect(err).toBeInstanceOf(LLMAttemptsExhausted)
    expect(err.attempts).toBe(1)
    expect((err.lastError as Error).message).toBe('Workers AI binding failed: fatal')
  })

  it('全部失败 → LLMAttemptsExhausted；最后一次是拒绝时 lastError 的文案是 reasons；已花的 neurons 也带出', async () => {
    const f = fakeAi([new Error('x'), 'nope'])
    const err = await callLLMUntilAccepted(f.ai, f.env, {}, 'brief_block_v6', {
      attempts: 2,
      overrides: () => ({}),
      prompt: () => 'P',
      accept: acceptOk,
      retryOnError: () => true,
      backoffMs: () => 0,
    }).catch(e => e)
    expect(err).toBeInstanceOf(LLMAttemptsExhausted)
    expect(err.attempts).toBe(2)
    expect((err.lastError as Error).message).toBe('bad:nope')
    expect(err.neurons).toBe(7)
  })

  it('accept 抛错 = 不可重试，原样抛出', async () => {
    const f = fakeAi(['x', 'ok'])
    await expect(callLLMUntilAccepted(f.ai, f.env, {}, 'tldr_prose_generation', {
      attempts: 4,
      overrides: () => ({}),
      prompt: () => 'P',
      accept: () => { throw new Error('模型返回空摘要') },
      retryOnError: () => true,
      backoffMs: () => 0,
    })).rejects.toThrow('模型返回空摘要')
    expect(f.seen).toHaveLength(1)
  })

  it('退避按 backoffMs 给的时长，最后一次失败后不退避', async () => {
    const f = fakeAi([new Error('x')])
    const asked: number[] = []
    await callLLMUntilAccepted(f.ai, f.env, {}, 'brief_block_v6', {
      attempts: 3,
      overrides: () => ({}),
      prompt: () => 'P',
      accept: acceptOk,
      retryOnError: () => true,
      backoffMs: i => { asked.push(i); return 0 },
    }).catch(() => {})
    expect(asked).toEqual([0, 1])
  })
})

describe('neuronsOf / isTransientLLMError', () => {
  it('neuronsOf 读 usage.neurons，缺省 0', () => {
    expect(neuronsOf({ usage: { neurons: 3 } } as any)).toBe(3)
    expect(neuronsOf({} as any)).toBe(0)
  })

  it('可自愈判据', () => {
    expect(isTransientLLMError(new Error('Workers AI binding failed: 3046: Request timeout'))).toBe(true)
    expect(isTransientLLMError(new Error('invalid api key'))).toBe(false)
  })
})
