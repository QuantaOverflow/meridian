/**
 * 句子向量（一次调用核查按意思搜用，ADR 0012）：bge-m3 经 Workers AI binding。binding 是外部服务边界，
 * 照 workers-ai.test.ts 的做法给一个只实现 run() 的假对象。
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedTexts } from '../src/services/embed-texts'
import { observeMiddleware } from '../src/services/observe'
import type { CloudflareEnv } from '../src/types'

const BGE = '@cf/baai/bge-m3'

/** 假 binding：每条文本回一个没归一化的二维向量 [3·k, 4·k]（k = 文本里的数字 + 1），记下每次收到的输入 */
function fakeAi(steps: Array<Error | 'ok'> = [], usage?: Record<string, number>) {
  const calls: Array<{ model: string; text: string[] }> = []
  let n = 0
  const ai = {
    run: async (model: string, inputs: { text: string[] }) => {
      const step = steps[n++] ?? 'ok'
      if (step instanceof Error) throw step
      calls.push({ model, text: inputs.text })
      return { shape: [inputs.text.length, 2], data: inputs.text.map(t => { const k = Number(t.replace(/\D/g, '') || 0) + 1; return [3 * k, 4 * k] }), ...(usage ? { usage } : {}) }
    },
  } as unknown as Ai
  return { ai, calls, attempts: () => n }
}
const env = (ai: Ai, extra: Partial<CloudflareEnv> = {}): CloudflareEnv => ({ AI: ai, ...extra })

describe('embedTexts', () => {
  it('每批最多 50 条，向量按输入顺序交回、长度归一', async () => {
    const f = fakeAi()
    const texts = Array.from({ length: 120 }, (_, i) => `sentence ${i}`)
    const vecs = await embedTexts(f.ai, env(f.ai), {}, texts)

    expect(f.calls.map(c => c.model)).toEqual([BGE, BGE, BGE])
    expect(f.calls.map(c => c.text.length)).toEqual([50, 50, 20])
    expect(f.calls.flatMap(c => c.text)).toEqual(texts)
    expect(vecs).toHaveLength(120)
    // [3k, 4k] 归一后都是 [0.6, 0.8]
    for (const v of vecs) {
      expect(v[0]).toBeCloseTo(0.6, 10)
      expect(v[1]).toBeCloseTo(0.8, 10)
    }
  })

  it('顺序同输入：不同文本的向量不串位', async () => {
    const ai = { run: async (_m: string, inputs: { text: string[] }) => ({ data: inputs.text.map(t => (t === 'a' ? [2, 0] : [0, 5])) }) } as unknown as Ai
    expect(await embedTexts(ai, env(ai), {}, ['a', 'b', 'a'])).toEqual([[1, 0], [0, 1], [1, 0]])
  })

  it('每条文本截到 1500 字符', async () => {
    const f = fakeAi()
    await embedTexts(f.ai, env(f.ai), {}, ['x'.repeat(4000), 'short'])
    expect(f.calls[0].text.map(t => t.length)).toEqual([1500, 5])
  })

  it('没有文本就不调 binding', async () => {
    const f = fakeAi()
    expect(await embedTexts(f.ai, env(f.ai), {}, [])).toEqual([])
    expect(f.attempts()).toBe(0)
  })

  it('回的向量条数对不上就抛错，不交回错位的结果', async () => {
    const ai = { run: async () => ({ data: [[1, 0]] }) } as unknown as Ai
    await expect(embedTexts(ai, env(ai), {}, ['a', 'b'])).rejects.toThrow('bge-m3')
  })

  it('记进 R2 调用日志与 inline 观测：模型、条数、批数、binding 报的用量', async () => {
    const f = fakeAi([], { prompt_tokens: 100, neurons: 2 })
    const puts: Array<{ key: string; record: any }> = []
    const bucket = { put: async (key: string, value: string) => { puts.push({ key, record: JSON.parse(value) }) } } as unknown as R2Bucket
    const app = new Hono<{ Bindings: CloudflareEnv }>()
    app.use('*', observeMiddleware)
    app.post('/', async c => {
      await embedTexts(f.ai, c.env, { traceId: 'wf-1', callIndex: 3 }, Array.from({ length: 60 }, (_, i) => `s ${i}`))
      return c.json({})
    })

    const res = await app.request('/', { method: 'POST', headers: { 'x-observe': 'inline' } }, env(f.ai, { ARTICLES_BUCKET: bucket }))
    const { observation } = (await res.json()) as { observation: { spans: Array<{ kind: string; status: string; attributes: Record<string, unknown> }> } }

    const spans = observation.spans.filter(s => s.kind === 'llm')
    expect(spans).toHaveLength(1)
    expect(spans[0].status).toBe('ok')
    expect(spans[0].attributes).toMatchObject({
      phase: 'brief_block_v6_embed', provider: 'workers-ai', model: BGE,
      params: { texts: 60, batches: 2 }, usage: { prompt_tokens: 200, neurons: 4 },
    })
    expect(puts).toHaveLength(1)
    expect(puts[0].key).toBe('llm-calls/wf-1/brief_block_v6_embed-003.json')
    expect(puts[0].record).toMatchObject({
      trace_id: 'wf-1', phase: 'brief_block_v6_embed', call_index: 3,
      request: { provider: 'workers-ai', model: BGE, texts: 60, batches: 2 },
      response: { vectors: 60, dimensions: 2, usage: { prompt_tokens: 200, neurons: 4 } },
    })
  })
})

/** 会过去的故障照付费模型的规矩重发（services/workers-ai.ts）：等 2s、4s、8s 各加 0–1s 抖动，最多 3 次 */
describe('embedTexts：服务故障重发', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('连接中断一次 → 等 2–3s 后重发同一批，成功', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fakeAi([new Error('Network connection lost.'), 'ok'])
    const p = embedTexts(f.ai, env(f.ai), {}, ['a 1', 'b 2'])
    await vi.advanceTimersByTimeAsync(1999)
    expect(f.attempts()).toBe(1)
    await vi.advanceTimersByTimeAsync(1001)
    expect(f.attempts()).toBe(2)
    expect(await p).toHaveLength(2)
    expect(f.calls[0].text).toEqual(['a 1', 'b 2'])
  })

  it('连着 4 次容量不足 → 等满 3 次后抛错，错误也记进观测', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const busy = () => new Error('3040: Capacity temporarily exceeded, please try again.')
    const f = fakeAi([busy(), busy(), busy(), busy()])
    const puts: any[] = []
    const bucket = { put: async (_key: string, value: string) => { puts.push(JSON.parse(value)) } } as unknown as R2Bucket
    const p = embedTexts(f.ai, env(f.ai, { ARTICLES_BUCKET: bucket }), { traceId: 'wf-2' }, ['a'])
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(3000 + 5000 + 9000)
    await expect(p).rejects.toThrow('3040: Capacity temporarily exceeded')
    expect(f.attempts()).toBe(4)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ response: null, error: expect.stringContaining('3040') })
  })

  it('重发也没用的错误（参数错）立刻抛', async () => {
    const f = fakeAi([new Error('5006: Error: invalid input')])
    await expect(embedTexts(f.ai, env(f.ai), {}, ['a'])).rejects.toThrow('5006')
    expect(f.attempts()).toBe(1)
  })
})
