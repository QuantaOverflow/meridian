/**
 * DashScope 通道（一次调用核查，ADR 0012）。DashScope / AI Gateway 是外部服务，用一个本机 HTTP 服务假冒：
 * `DASHSCOPE_BASE_URL` 指过去，断言它收到的请求与通道交回的结果。不 mock fetch，也不 mock 内部函数。
 * 调用一律从「调模型」的入口 callLLM 进，和生产一样。
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callLLM } from '../src/services/call-llm'
import { observeMiddleware } from '../src/services/observe'
import type { CloudflareEnv } from '../src/types'

const PHASE = 'brief_block_v6_check_one_call'
const MESSAGES = [
  { role: 'system' as const, content: 'S' },
  { role: 'user' as const, content: 'U' },
]

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }
type Reply = { status: number; body: unknown } | 'drop'

const okBody = (content: string | null = 'CHECKS\n…\nRESULT\n{"ok":true}') => ({
  id: 'chatcmpl-1',
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 4200, completion_tokens: 600, total_tokens: 4800 },
})
const ok: Reply = { status: 200, body: okBody() }
const errorBody = (message: string, code: string) => ({ error: { message, type: code, code } })

/** 按次序回放的假 DashScope：`drop` = 不回包直接断开连接 */
let server: http.Server
let seen: Seen[]
let replies: Reply[]
let baseUrl: string

beforeEach(async () => {
  seen = []
  replies = []
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) })
      const reply = replies.shift() ?? { status: 500, body: errorBody(`unexpected request #${seen.length}`, 'test') }
      if (reply === 'drop') return void req.socket.destroy()
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/compatible-mode/v1`
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

/** binding 一次都不该被调到 */
const ai = { run: async () => { throw new Error('binding must not be called') } } as unknown as Ai
const envWith = (extra: Partial<CloudflareEnv> = {}): CloudflareEnv => ({ AI: ai, DASHSCOPE_BASE_URL: baseUrl, DASHSCOPE_API_KEY: 'sk-test', ...extra })
const call = (env: CloudflareEnv = envWith(), overrides = {}) => callLLM(ai, env, {}, PHASE, MESSAGES, overrides)

describe('DashScope 通道：请求与回包', () => {
  it('一次调用核查的 phase 发到 DashScope：模型、温度、上限、关 thinking、关网关缓存', async () => {
    replies = [ok]
    await call()

    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].url).toBe('/compatible-mode/v1/chat/completions')
    expect(seen[0].body).toEqual({ model: 'qwen3.8-flash', messages: MESSAGES, temperature: 0.2, max_tokens: 8000, enable_thinking: false })
    expect(seen[0].headers.authorization).toBe('Bearer sk-test')
    expect(seen[0].headers['cf-aig-skip-cache']).toBe('true')
    expect(seen[0].headers['cf-aig-authorization']).toBeUndefined()
  })

  it('配了网关 token 才带 cf-aig-authorization；base URL 末尾的斜杠不重复', async () => {
    replies = [ok]
    await call(envWith({ AI_GATEWAY_TOKEN: 'gw-token', DASHSCOPE_BASE_URL: `${baseUrl}/` }))

    expect(seen[0].url).toBe('/compatible-mode/v1/chat/completions')
    expect(seen[0].headers['cf-aig-authorization']).toBe('Bearer gw-token')
  })

  it('回包映射成既有的 chat 响应；usage 带 DashScope 报的 token、美元与折算的 neurons', async () => {
    replies = [ok]
    const res = await call()

    expect(res).toMatchObject({
      capability: 'chat',
      id: 'chatcmpl-1',
      provider: 'dashscope',
      model: 'qwen3.8-flash',
      choices: [{ message: { role: 'assistant', content: 'CHECKS\n…\nRESULT\n{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4200, completion_tokens: 600, total_tokens: 4800 },
    })
    // 4200 × ¥0.8 / 百万 + 600 × ¥2.7 / 百万 = ¥0.00498；÷ 7.1 = $0.00070141；÷ $0.011 × 1000 = 63.7644 neurons
    const usage = res.usage as { usd: number; neurons: number }
    expect(usage.usd).toBeCloseTo(0.00070141, 8)
    expect(usage.neurons).toBeCloseTo(63.7644, 4)
  })

  it('正文为空算失败（provider_error），不重发', async () => {
    replies = [{ status: 200, body: okBody(null) }]
    await expect(call()).rejects.toMatchObject({ kind: 'provider_error', message: expect.stringContaining('空正文') })
    expect(seen).toHaveLength(1)
  })

  it('白名单只有 qwen3.8-flash：别的模型在发请求之前就拒绝', async () => {
    await expect(call(envWith(), { model: 'qwen-max' })).rejects.toThrow('Model not found: qwen-max')
    expect(seen).toHaveLength(0)
  })
})

describe('DashScope 通道：记进调用日志与 inline 观测', () => {
  it('R2 调用日志的 provider 是 dashscope，带 usage', async () => {
    replies = [ok]
    const puts: Array<{ key: string; record: any }> = []
    const bucket = { put: async (key: string, value: string) => { puts.push({ key, record: JSON.parse(value) }) } } as unknown as R2Bucket
    await callLLM(ai, envWith({ ARTICLES_BUCKET: bucket }), { traceId: 'wf-1', callIndex: 7 }, PHASE, MESSAGES)

    expect(puts).toHaveLength(1)
    expect(puts[0].key).toBe(`llm-calls/wf-1/${PHASE}-007.json`)
    expect(puts[0].record.request).toMatchObject({ provider: 'dashscope', model: 'qwen3.8-flash', temperature: 0.2, max_tokens: 8000 })
    expect(puts[0].record.response).toMatchObject({ provider_used: 'dashscope', finish_reason: 'stop', usage: { prompt_tokens: 4200, completion_tokens: 600 } })
  })

  it('x-observe: inline 的记录里这次调用标着 provider dashscope', async () => {
    replies = [ok]
    const app = new Hono<{ Bindings: CloudflareEnv }>()
    app.use('*', observeMiddleware)
    app.post('/', async c => { await callLLM(ai, c.env, {}, PHASE, MESSAGES); return c.json({}) })

    const res = await app.request('/', { method: 'POST', headers: { 'x-observe': 'inline' } }, envWith())
    const { observation } = (await res.json()) as { observation: { spans: Array<{ kind: string; attributes: Record<string, unknown> }> } }

    const llm = observation.spans.filter(s => s.kind === 'llm')
    expect(llm).toHaveLength(1)
    expect(llm[0].attributes).toMatchObject({ phase: PHASE, provider: 'dashscope', model: 'qwen3.8-flash', finish_reason: 'stop' })
  })
})

describe('DashScope 通道：错误分类', () => {
  it('401 invalid_api_key → auth，不重发', async () => {
    replies = [{ status: 401, body: errorBody('Incorrect API key provided.', 'invalid_api_key') }]
    await expect(call()).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('Incorrect API key provided.') })
    expect(seen).toHaveLength(1)
  })

  it('403 → auth，不重发', async () => {
    replies = [{ status: 403, body: errorBody('Access denied.', 'access_denied') }]
    await expect(call()).rejects.toMatchObject({ kind: 'auth' })
    expect(seen).toHaveLength(1)
  })

  it('没配 key 或 base URL → auth，一个请求都不发', async () => {
    await expect(call(envWith({ DASHSCOPE_API_KEY: undefined }))).rejects.toMatchObject({ kind: 'auth' })
    await expect(call(envWith({ DASHSCOPE_BASE_URL: undefined }))).rejects.toMatchObject({ kind: 'auth' })
    expect(seen).toHaveLength(0)
  })

  it('内容审核拒绝（DataInspectionFailed）→ content_filter，不重发', async () => {
    replies = [{ status: 400, body: errorBody('<400> InternalError.Algo.DataInspectionFailed: Input data may contain inappropriate content.', 'data_inspection_failed') }]
    await expect(call()).rejects.toMatchObject({ kind: 'content_filter', message: expect.stringContaining('DataInspectionFailed') })
    expect(seen).toHaveLength(1)
  })

  it('其他 4xx → provider_error，不重发', async () => {
    replies = [{ status: 400, body: errorBody('Range of max_tokens should be [1, 32768]', 'invalid_parameter_error') }]
    await expect(call()).rejects.toMatchObject({ kind: 'provider_error', message: expect.stringContaining('Range of max_tokens') })
    expect(seen).toHaveLength(1)
  })
})

/**
 * 会过去的故障（429 / 408 / 5xx / 断连）：指数退避加抖动后原样重发，最多 3 次。抖动是随机的，只断言上下界：
 * 第 n 次等 2s·2^n 到 2s·2^n + 1s。假冒服务走真实网络栈，所以只把 setTimeout 换成假的，请求到没到靠轮询。
 */
describe('DashScope 通道：等待重发', () => {
  /** 等真实 I/O：让出事件循环直到假服务收到第 n 个请求（setImmediate 没被换成假的） */
  async function arrived(n: number) {
    for (let i = 0; i < 2000 && seen.length < n; i++) await new Promise(r => setImmediate(r))
    // 再让几轮，让通道读完回包、进到下一次等待
    for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r))
    expect(seen.length).toBe(n)
  }
  const busy: Reply = { status: 503, body: errorBody('Service unavailable', 'service_unavailable') }

  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })

  it('5xx、断连各一次 → 等 2–3s、4–5s 后重发，第三次成功；每次重发打一行 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = [busy, 'drop', ok]
    const p = call()
    await arrived(1)
    await vi.advanceTimersByTimeAsync(1999)
    await arrived(1)
    await vi.advanceTimersByTimeAsync(1001)
    await arrived(2)
    await vi.advanceTimersByTimeAsync(3999)
    await arrived(2)
    await vi.advanceTimersByTimeAsync(1001)
    await arrived(3)

    await expect(p).resolves.toMatchObject({ provider: 'dashscope', choices: [{ message: { content: expect.stringContaining('RESULT') } }] })
    expect(seen[1].body).toEqual(seen[0].body)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ level: 'warn', component: 'dashscope', model: 'qwen3.8-flash', error_message: expect.stringContaining('503') })
  })

  it.each([429, 408])('%i 也等待重发', async status => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = [{ status, body: errorBody('Requests rate limit exceeded', 'limit_requests') }, ok]
    const p = call()
    await arrived(1)
    await vi.advanceTimersByTimeAsync(3000)
    await arrived(2)
    await expect(p).resolves.toMatchObject({ provider: 'dashscope' })
  })

  it('连着 4 次 5xx → 重发满 3 次后抛 provider_error，共 4 个请求', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = [busy, busy, busy, busy]
    const p = call()
    p.catch(() => {})
    await arrived(1)
    await vi.advanceTimersByTimeAsync(3000)
    await arrived(2)
    await vi.advanceTimersByTimeAsync(5000)
    await arrived(3)
    await vi.advanceTimersByTimeAsync(9000)
    await arrived(4)

    await expect(p).rejects.toMatchObject({ kind: 'provider_error', message: expect.stringContaining('Service unavailable') })
  })
})
