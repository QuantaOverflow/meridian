// @vitest-environment node
/**
 * 文章分析端点的多次尝试行为（改动前的基准）。
 *
 * 走真实 Hono 路由，只 fake 外部边界：Workers AI binding（`env.AI.run`）与 R2（`ARTICLES_BUCKET.put`）。
 * 锁住：两档模型的顺序与参数、第 1 档解析失败 → 第 2 档、两档都失败时回给 backend 的 500 文案、
 * 两档之间不退避（真时钟下跑完）、不挂输出语言传感器。
 */
import { describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const QWEN = '@cf/qwen/qwen3-30b-a3b-fp8'
const GLM = '@cf/zai-org/glm-4.7-flash'

type Step = string | Error
interface Seen { model: string; inputs: Record<string, any> }

function fakeEnv(steps: Step[]) {
  const seen: Seen[] = []
  const puts: string[] = []
  const AI = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs })
      const s = steps[seen.length - 1]
      if (s instanceof Error) throw s
      return { choices: [{ message: { content: s }, finish_reason: 'stop' }], usage: { completion_tokens: 1 } }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async (key: string) => { puts.push(key) }) } as unknown as R2Bucket
  return { env: { AI, ARTICLES_BUCKET }, seen, puts }
}

async function analyze(env: object, headers: Record<string, string> = {}) {
  const res = await app.request('/meridian/article/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ title: 'Some title', content: 'Some body text.' }),
  }, env)
  return { status: res.status, body: await res.json() as any }
}

describe('文章分析：两档模型', () => {
  it('第 1 档 JSON 解析失败 → 第 2 档成功；两档同一 prompt、参数逐档', async () => {
    const f = fakeEnv(['this is not json at all', '{"language":"en","primary_location":"GLOBAL"}'])
    const r = await analyze(f.env)

    expect(r.status).toBe(200)
    expect(r.body).toEqual({ success: true, data: { language: 'en', primary_location: 'GLOBAL' } })
    expect(f.seen.map(s => s.model)).toEqual([QWEN, GLM])
    expect(f.seen.map(s => s.inputs.temperature)).toEqual([0.1, 0.1])
    expect(f.seen.map(s => s.inputs.max_tokens)).toEqual([4000, 4000])
    expect(f.seen.map(s => 'response_format' in s.inputs)).toEqual([false, false])
    expect(f.seen[0].inputs.messages).toEqual(f.seen[1].inputs.messages)
    expect(f.seen[0].inputs.messages).toHaveLength(1)
    expect(f.seen[0].inputs.messages[0].role).toBe('user')
  })

  it('第 1 档成功就只调一次', async () => {
    const f = fakeEnv(['{"language":"en"}'])
    const r = await analyze(f.env)
    expect(r.status).toBe(200)
    expect(f.seen.map(s => s.model)).toEqual([QWEN])
  })

  it('两档都解析失败 → 500 + 最终错误文案', async () => {
    const f = fakeEnv(['nope', 'still nope'])
    const r = await analyze(f.env)
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ success: false, error: '文章分析失败（2 档均失败）: JSON 解析失败或返回非对象' })
    expect(f.seen).toHaveLength(2)
  })

  it('最后一档抛配额类错误 → 文案带「API 配额或限制错误」前缀', async () => {
    const f = fakeEnv(['nope', new Error('3040: Capacity temporarily exceeded, please try again.')])
    const r = await analyze(f.env)
    expect(r.status).toBe(500)
    expect(r.body.error).toBe(
      '文章分析失败（2 档均失败）: API 配额或限制错误: Workers AI binding failed: 3040: Capacity temporarily exceeded, please try again.'
    )
  })

  it('最后一档抛普通错误 → 文案是错误原文；前一档的配额错误不影响最终文案', async () => {
    const f = fakeEnv([new Error('429 Too Many Requests'), new Error('boom')])
    const r = await analyze(f.env)
    expect(r.status).toBe(500)
    expect(r.body.error).toBe('文章分析失败（2 档均失败）: Workers AI binding failed: boom')
    expect(f.seen).toHaveLength(2)
  })

  it('前一档抛错、最后一档解析失败 → 以最后一档为准', async () => {
    const f = fakeEnv([new Error('429 Too Many Requests'), 'nope'])
    const r = await analyze(f.env)
    expect(r.body.error).toBe('文章分析失败（2 档均失败）: JSON 解析失败或返回非对象')
  })

  it('R2 只落 llm-calls（callIndex 取请求头），中文输出也不落语言传感器', async () => {
    const zh = '{"summary":"' + '这是一段完全由中文组成的摘要内容用于触发语言传感器'.repeat(4) + '"}'
    const f = fakeEnv([zh])
    const r = await analyze(f.env, { 'x-trace-id': 'trace-a', 'x-call-index': '7' })
    expect(r.status).toBe(200)
    expect(f.puts).toEqual(['llm-calls/trace-a/article_analysis-007.json'])
  })
})
