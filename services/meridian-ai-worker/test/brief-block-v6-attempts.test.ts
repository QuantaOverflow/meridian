// @vitest-environment node
/**
 * 简报块 v6 的 chatJson 多次尝试行为（改动前的基准）。
 *
 * 走真实 BriefBlockV6Service，只 fake Workers AI binding 与 R2（R2 key 用来读出每次调用的 callIndex）。
 * 退避用 vitest 假时钟（只假 setTimeout），生产代码一行不改。
 * 锁住：温度 [0.1,0.3,0.3]、退避 3s → 8s、callIndex 逐次 +1、校验不过的原因拼进下一次 prompt、
 * 截断 / 复读 / 解析失败 / 调用抛错重试但不附诊断、neurons 与 llmCalls 累计、全失败的错误文案。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BriefBlockV6Service } from '../src/services/brief-block-v6'
import { retryInstruction } from '../src/utils/brief-block-v6'
import { noSentencesHint } from '../src/prompts/briefBlockV6'

const GLM = '@cf/zai-org/glm-4.7-flash'

type Step = Error | { content: string; finish?: string }
interface Seen { model: string; inputs: Record<string, any> }

function fakeEnv(steps: Step[]) {
  const seen: Seen[] = []
  const puts: string[] = []
  const AI = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs })
      const s = steps[seen.length - 1]
      if (!s) throw new Error(`unexpected call #${seen.length}`)
      if (s instanceof Error) throw s
      return {
        choices: [{ message: { content: s.content }, finish_reason: s.finish ?? 'stop' }],
        usage: { completion_tokens: 1, neurons: 10 },
      }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async (key: string) => { puts.push(key) }) } as unknown as R2Bucket
  return { env: { AI, ARTICLES_BUCKET }, seen, puts }
}

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)) }

/** 推时钟直到 promise 落定（上界 60 步，每步 1s） */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  const q = p.finally(() => { done = true })
  q.catch(() => {})
  for (let i = 0; i < 60 && !done; i++) { await vi.advanceTimersByTimeAsync(1000); await flush() }
  return q
}

const INPUT = {
  articles: [{
    id: 1,
    title: 'Alpha',
    content: 'Alpha rose 5 percent on Monday. Beta fell sharply after the report. Gamma said the plan was final.',
    publishDate: '2026-09-01',
  }],
}

const ANCHORS = JSON.stringify({ anchors: [{ topic: 'Alpha rises', sources: [{ articleId: 1, sentence: 1 }] }] })
const WRITE_OK = JSON.stringify({
  verdict: 'written', reason: 'one event', title: 'Alpha rises',
  sentences: [{ text: 'Alpha rose 5 percent on Monday.', sources: [{ articleId: 1, sentence: 1 }] }],
})
const WRITE_NO_TITLE = JSON.stringify({
  verdict: 'written', reason: 'one event', title: '',
  sentences: [{ text: 'Alpha rose 5 percent on Monday.', sources: [{ articleId: 1, sentence: 1 }] }],
})
const REPEAT = 'Alpha rose five percent on Monday in the market.'
const WRITE_REPEATED = JSON.stringify({
  verdict: 'written', reason: 'one event', title: 'Alpha rises',
  sentences: [REPEAT, REPEAT, REPEAT].map(text => ({ text, sources: [{ articleId: 1, sentence: 1 }] })),
})

const promptOf = (s: Seen) => s.inputs.messages[0].content as string

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('brief-block-v6 chatJson：多次尝试', () => {
  it('截断 → 重试不附诊断；校验不过 → 原因拼进下一次 prompt；温度/callIndex/退避/neurons 逐次', async () => {
    const f = fakeEnv([
      { content: ANCHORS, finish: 'length' }, // 窗口 #1：截断
      { content: ANCHORS },                   // 窗口 #2：通过
      { content: WRITE_NO_TITLE },            // 写作 #1：missing_title
      { content: WRITE_OK },                  // 写作 #2：通过
    ])
    const svc = new BriefBlockV6Service(f.env, f.env.AI, { traceId: 'trace-v', callIndex: 2 })
    const p = svc.generate(INPUT)

    await flush()
    expect(f.seen).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2999); await flush()
    expect(f.seen).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(f.seen).toHaveLength(3) // 窗口 #2 通过后写作 #1 立即发出
    await vi.advanceTimersByTimeAsync(2999); await flush()
    expect(f.seen).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(f.seen).toHaveLength(4)

    const r = await p
    expect(f.seen.map(s => s.model)).toEqual(Array(4).fill(GLM))
    expect(f.seen.map(s => s.inputs.temperature)).toEqual([0.1, 0.3, 0.1, 0.3])
    expect(f.seen.map(s => s.inputs.max_tokens)).toEqual([8000, 8000, 8000, 8000])
    expect(f.seen.map(s => s.inputs.response_format?.type)).toEqual(Array(4).fill('json_schema'))
    expect(f.puts).toEqual([800, 801, 802, 803].map(i => `llm-calls/trace-v/brief_block_v6-${i}.json`))

    expect(promptOf(f.seen[1])).toBe(promptOf(f.seen[0]))
    expect(promptOf(f.seen[3])).toBe(
      `${promptOf(f.seen[2])}\n\n${retryInstruction(['missing_title'], { no_sentences: noSentencesHint(undefined) })}`
    )

    expect(r.verdict).toBe('written')
    expect(r.block?.title).toBe('Alpha rises')
    expect(r.trace).toMatchObject({
      windows: 1, anchors: 1, windowFailures: 0, writeRejects: ['#1 missing_title'], llmCalls: 4, neurons: 40,
    })
  })

  it('复读 → 重试不附诊断', async () => {
    const f = fakeEnv([{ content: ANCHORS }, { content: WRITE_REPEATED }, { content: WRITE_OK }])
    const svc = new BriefBlockV6Service(f.env, f.env.AI, {})
    const r = await settle(svc.generate(INPUT))

    expect(f.seen).toHaveLength(3)
    expect(promptOf(f.seen[2])).toBe(promptOf(f.seen[1]))
    expect(f.seen.map(s => s.inputs.temperature)).toEqual([0.1, 0.1, 0.3])
    expect(r.trace).toMatchObject({ writeRejects: [], llmCalls: 3, neurons: 30 })
  })

  it('窗口三次全失败（抛错 / 解不出 / 截断）→ 退避 3s、8s，整块报 all 1 window(s) failed', async () => {
    const f = fakeEnv([
      new Error('boom'),
      { content: 'not json' },
      { content: ANCHORS, finish: 'length' },
    ])
    const svc = new BriefBlockV6Service(f.env, f.env.AI, {})
    const p = svc.generate(INPUT)
    p.catch(() => {})

    await flush()
    expect(f.seen).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2999); await flush()
    expect(f.seen).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(f.seen).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(7999); await flush()
    expect(f.seen).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(f.seen).toHaveLength(3)

    await expect(p).rejects.toThrow('all 1 window(s) failed')
    expect(f.seen.map(s => s.inputs.temperature)).toEqual([0.1, 0.3, 0.3])
    expect(new Set(f.seen.map(promptOf)).size).toBe(1)
  })

  it('写作三次都校验不过 → 抛 write: all model attempts failed validation；原因逐次累进 writeRejects 的 prompt', async () => {
    const f = fakeEnv([{ content: ANCHORS }, { content: WRITE_NO_TITLE }, { content: WRITE_NO_TITLE }, { content: WRITE_NO_TITLE }])
    const svc = new BriefBlockV6Service(f.env, f.env.AI, {})
    await expect(settle(svc.generate(INPUT))).rejects.toThrow('write: all model attempts failed validation')
    expect(f.seen).toHaveLength(4)
    const suffix = `\n\n${retryInstruction(['missing_title'], { no_sentences: noSentencesHint(undefined) })}`
    expect(promptOf(f.seen[2])).toBe(promptOf(f.seen[1]) + suffix)
    expect(promptOf(f.seen[3])).toBe(promptOf(f.seen[1]) + suffix)
  })
})
