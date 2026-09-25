// @vitest-environment node
/**
 * 散文摘要端点的重试行为（改动前的基准）。
 *
 * 走真实 Hono 路由，只 fake Workers AI binding 与 R2。退避用 vitest 假时钟（只假 setTimeout），
 * 并把 Math.random 钉成 0 去掉抖动，这样能逐毫秒断言退避时长——生产代码一行不改。
 * 锁住：可自愈错误最多 4 次（退避 1s/2s/4s）、不可自愈错误与空摘要不重试、失败时回给 backend 的文案。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

type Step = string | Error
interface Seen { model: string; inputs: Record<string, any> }

function fakeEnv(steps: Step[]) {
  const seen: Seen[] = []
  const puts: string[] = []
  const AI = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs })
      const s = steps[Math.min(seen.length - 1, steps.length - 1)]
      if (s instanceof Error) throw s
      return { choices: [{ message: { content: s }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async (key: string) => { puts.push(key) }) } as unknown as R2Bucket
  return { env: { AI, ARTICLES_BUCKET }, seen, puts }
}

/** 真 setImmediate（没被假时钟接管）：让挂起的 promise 链走完 */
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)) }

function summarize(env: object) {
  return Promise.resolve(app.request('/meridian/generate-brief-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-s' },
    body: JSON.stringify({ briefTitle: 'T', briefContent: 'Body.' }),
  }, env)).then(async (res: Response) => ({ status: res.status, body: await res.json() as any }))
}

const TRANSIENT = new Error('3040: Capacity temporarily exceeded, please try again.')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('散文摘要：重试', () => {
  it('可自愈错误重试到第 4 次，退避 1000/2000/4000ms，然后 500', async () => {
    const f = fakeEnv([TRANSIENT])
    const p = summarize(f.env)

    await flush()
    expect(f.seen).toHaveLength(1)
    for (const [wait, n] of [[1000, 2], [2000, 3], [4000, 4]] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1)
      await flush()
      expect(f.seen).toHaveLength(n - 1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(f.seen).toHaveLength(n)
    }
    const r = await p
    expect(f.seen).toHaveLength(4)
    expect(r.status).toBe(500)
    expect(r.body).toEqual({
      success: false,
      error: 'Failed to generate brief summary',
      metadata: { details: 'Workers AI binding failed: 3040: Capacity temporarily exceeded, please try again.' },
    })
  })

  it('可自愈错误两次后成功 → 返回摘要；每次同一 prompt、temperature 0、max_tokens 800、callIndex 0', async () => {
    const f = fakeEnv([TRANSIENT, TRANSIENT, '"Two sentences of prose."'])
    const p = summarize(f.env)
    for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(1000); await flush() }
    const r = await p

    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      success: true,
      data: { tldrProse: 'Two sentences of prose.' },
      metadata: { brief_title: 'T', summary_length: 'Two sentences of prose.'.length },
    })
    expect(f.seen).toHaveLength(3)
    expect(f.seen.map(s => s.model)).toEqual(Array(3).fill('@cf/zai-org/glm-4.7-flash'))
    expect(f.seen.map(s => s.inputs.temperature)).toEqual([0, 0, 0])
    expect(f.seen.map(s => s.inputs.max_tokens)).toEqual([800, 800, 800])
    expect(new Set(f.seen.map(s => JSON.stringify(s.inputs.messages))).size).toBe(1)
    expect(f.puts).toEqual(Array(3).fill('llm-calls/trace-s/tldr_prose_generation-000.json'))
  })

  it('不可自愈错误不重试，文案是错误原文', async () => {
    const f = fakeEnv([new Error('invalid api key')])
    const r = await summarize(f.env)
    expect(f.seen).toHaveLength(1)
    expect(r.status).toBe(500)
    expect(r.body.metadata).toEqual({ details: 'Workers AI binding failed: invalid api key' })
  })

  it('去掉引号后为空 → 「模型返回空摘要」，不重试', async () => {
    const f = fakeEnv(['""'])
    const r = await summarize(f.env)
    expect(f.seen).toHaveLength(1)
    expect(r.status).toBe(500)
    expect(r.body.metadata).toEqual({ details: '模型返回空摘要' })
  })

  it('代码围栏被剥掉', async () => {
    const f = fakeEnv(['```Plain prose here.```'])
    const r = await summarize(f.env)
    expect(r.body.data).toEqual({ tldrProse: 'Plain prose here.' })
  })
})
