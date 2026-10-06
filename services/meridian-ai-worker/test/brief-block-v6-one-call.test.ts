// @vitest-environment node
/**
 * 一次调用核查（ADR 0012）在块接口上的行为：走真实 BriefBlockV6Service.generate，`BRIEF_CHECK_MODE=one_call`。
 * 做法同 brief-block-v6-loop.test.ts：只假外部服务——Workers AI binding（标重点 / 写作 / 改写 / 回退的 agent 步 / bge-m3 向量）
 * 与一个本机 HTTP 服务假冒 DashScope（`DASHSCOPE_BASE_URL` 指过去）。不 mock fetch，也不 mock 内部函数。
 *
 * 簇是 test/fixtures/one-call-cluster.json（水坝溃坝）：被核的第 2 句说「2015 年开始修」，原文 14:1 说 2014，
 * 而 14:1 与那一句没有共同的词，只有按意思搜带得进来（向量是夹具里按夹角合成的）。
 * 断言只看返回的块、它的 check 记录、以及两个假服务收到的请求。
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/one-call-cluster.json'
import { BriefBlockV6Service } from '../src/services/brief-block-v6'

const GLM = '@cf/zai-org/glm-4.7-flash'
const V4PRO = '@cf/deepseek-ai/deepseek-v4-pro-0813'
const QWEN38 = '@cf/qwen/qwen3.8-27b'
const BGE = '@cf/baai/bge-m3'
/** 每次调用的 neurons，按模型取不同的数，好从合计里分得出谁花的 */
const NEURONS: Record<string, number> = { [GLM]: 1, [V4PRO]: 10, [QWEN38]: 100 }
/** 假 DashScope 每次回的用量：4200 入 + 600 出 = ¥0.00498 = $0.00070141 = 63.7644 等价 neurons（算法见 dashscope.test.ts） */
const DASH_USAGE = { prompt_tokens: 4200, completion_tokens: 600, total_tokens: 4800 }
const DASH_USD = 0.00070141
const DASH_NEURONS = 63.7644

const INPUT = { articles: fixture.articles.map(a => ({ id: a.id, title: a.title, publishDate: a.publishDate, content: a.sentences.join(' ') })) }
const CLUSTER_TEXTS = [...fixture.articles].sort((a, b) => a.id - b.id).flatMap(a => a.sentences)

const ANCHORS = JSON.stringify({
  anchors: [
    { topic: 'Dam fails', sources: [{ articleId: 12, sentence: 1 }, { articleId: 13, sentence: 3 }] },
    { topic: 'Political fallout', sources: [{ articleId: 13, sentence: 4 }] },
  ],
})

type Cite = [number, number]
const blockOf = (title: string, sentences: Array<[string, Cite[]]>) => ({
  title,
  sentences: sentences.map(([text, cites]) => ({ text, sources: cites.map(([articleId, sentence]) => ({ articleId, sentence })) })),
})
const reply = (title: string, sentences: Array<[string, Cite[]]>) =>
  JSON.stringify({ verdict: 'written', reason: 'one event', ...blockOf(title, sentences) })

const S1 = 'A dam in northern Varnia failed on Tuesday night.'
const S2 = 'The dam, which engineers began repairing in 2015, failed on Tuesday night, killing 57 people.'
const S3 = 'Opposition leaders demanded the minister resign.'
/** 材料池里特意没有 11:1：补出处会因为 "Tuesday" 把它补给第 2 句，而 golden 的那份 prompt 里第 2 句只引 13:3 */
const DRAFT: Array<[string, Cite[]]> = [[S1, [[12, 1]]], [S2, [[13, 3]]], [S3, [[13, 4]]]]
const DRAFT_REPLY = reply('Dam failure in Varnia', DRAFT)
const DRAFT_BLOCK = blockOf('Dam failure in Varnia', DRAFT)

/** 改写：第 2 句去掉没有出处的「2015 年开始修」，其余两句原样 */
const S2_FIXED = 'The dam failed on Tuesday night, killing 57 people.'
const R1: Array<[string, Cite[]]> = [[S1, [[12, 1]]], [S2_FIXED, [[12, 1], [13, 3]]], [S3, [[13, 4]]]]
const R1_REPLY = reply('Dam failure in Varnia', R1)
const R1_BLOCK = blockOf('Dam failure in Varnia', R1)

// ── 一次调用核查的回复：先 CHECKS 再 RESULT ───────────────────────────────
const OK_REPLY = 'CHECKS\nEvery part of the sentence matches its source.\nRESULT\n{"ok": true}'
const FLAG_S2 = { ok: false, type: 'detail', problem: 'The sources say the cracks were first patched in 2014, not 2015.', evidence: [[14, 1]], fix: S2_FIXED }
const FLAG_REPLY = `CHECKS\nSentence says: began repairing in 2015 / Source [14:1] says: first patched across 2014 summer. Different year.\nRESULT\n${JSON.stringify(FLAG_S2)}`
const FLAG_FINDING = { type: 'detail', problem: FLAG_S2.problem, evidence: [[14, 1]], fix: S2_FIXED }

// ── 回退时 agent 的回复（ReAct 文本协议） ──────────────────────────────────
const AGENT_OK = 'Thought: every part matches its sources.\nAction: verdict\nArgs: {"ok": true}'
/** 证据是它引的 13:3（一开始就看过），一步收下 */
const AGENT_FLAG_S2 = { ok: false, type: 'detail', problem: 'No source says repairs began in 2015.', evidence: [[13, 3]], fix: S2_FIXED }
const AGENT_FLAG = `Thought: 2015 is unsupported.\nAction: verdict\nArgs: ${JSON.stringify(AGENT_FLAG_S2)}`

// ── 假 DashScope ───────────────────────────────────────────────────────────
type DashReply = string | { content: string; finish: string } | { status: number; body: unknown }
interface DashQuery {
  /** 被核的那句原文 */
  text: string
  /** 同一份请求的第几次到达（0 起）：重试、多个 epoch 的请求体相同，只能按到达先后分 */
  arrival: number
}
interface DashSeen { headers: http.IncomingHttpHeaders; body: any; text: string; system: string; user: string }
const errorBody = (message: string, code: string) => ({ error: { message, type: code, code } })
const INVALID_KEY: DashReply = { status: 401, body: errorBody('Incorrect API key provided.', 'invalid_api_key') }
const FILTERED: DashReply = { status: 400, body: errorBody('<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content.', 'data_inspection_failed') }

let server: http.Server
let baseUrl: string
let dashSeen: DashSeen[]
let dash: (q: DashQuery) => DashReply

// ── 假 binding ─────────────────────────────────────────────────────────────
type Reply = string | Error
interface Msg { role: string; content: string }
interface Seen { model: string; inputs: Record<string, any> }
interface Script {
  mode?: string
  epochs?: string
  /** 不给 key：DashScope 没配好 */
  noKey?: boolean
  write: Reply[]
  revise?: Reply[]
  /** 回退到 agent 时它每一步的回复 */
  agent?: (q: { text: string; step: number }) => Reply
  /** bge-m3 报一个不会过去的错 */
  embedFails?: boolean
}

/** 夹具里的合成向量：夹角（度）→ (cos, sin, 0)，故意不归一（×2），归一是 embedTexts 的事；夹具没给的文本放在 90° */
const ANGLES = new Map<string, number>([
  ...fixture.articles.flatMap(a => a.sentences.map((t, i): [string, number] => [t, (fixture.embeddings.sentences as Record<string, number>)[`${a.id}:${i + 1}`]])),
  ...Object.entries(fixture.embeddings.queries),
])
const vectorOf = (text: string) => {
  const rad = ((ANGLES.get(text) ?? 90) * Math.PI) / 180
  return [2 * Math.cos(rad), 2 * Math.sin(rad), 0]
}

function fakeEnv(script: Script) {
  const seen: Seen[] = []
  const puts: string[] = []
  const unscripted: string[] = []
  let writes = 0
  let revises = 0
  const AI = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs: structuredClone(inputs) })
      if (model === BGE) {
        if (script.embedFails) throw new Error('5006: Error: invalid input')
        return { shape: [inputs.text.length, 3], data: (inputs.text as string[]).map(vectorOf) }
      }
      const msgs = inputs.messages as Msg[]
      let r: Reply | undefined
      if (model === GLM) r = ANCHORS
      else if (model === V4PRO) r = msgs.length === 1 ? script.write[writes++] : script.revise?.[revises++]
      else if (model === QWEN38) {
        const m = /^Check S\d+: (.*)$/m.exec(msgs[1].content)
        if (m && script.agent) r = script.agent({ text: m[1], step: msgs.length / 2 })
      }
      if (r === undefined) {
        unscripted.push(`${model} #${seen.length}`)
        throw new Error(`fake: no reply scripted for ${model} call #${seen.length}`)
      }
      if (r instanceof Error) throw r
      return { choices: [{ message: { content: r }, finish_reason: 'stop' }], usage: { completion_tokens: 1, neurons: NEURONS[model] } }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async (key: string) => { puts.push(key) }) } as unknown as R2Bucket
  const env = {
    AI,
    ARTICLES_BUCKET,
    DASHSCOPE_BASE_URL: baseUrl,
    ...(script.noKey ? {} : { DASHSCOPE_API_KEY: 'sk-test' }),
    ...('mode' in script ? (script.mode === undefined ? {} : { BRIEF_CHECK_MODE: script.mode }) : { BRIEF_CHECK_MODE: 'one_call' }),
    ...(script.epochs === undefined ? {} : { BRIEF_CHECK_EPOCHS: script.epochs }),
  }
  return { env, seen, puts, unscripted }
}

const service = (f: ReturnType<typeof fakeEnv>, callIndex = 0) =>
  new BriefBlockV6Service(f.env, f.env.AI, { traceId: 'trace-one-call', callIndex })

const agentCalls = (f: ReturnType<typeof fakeEnv>) => f.seen.filter(s => s.model === QWEN38)
const embedCalls = (f: ReturnType<typeof fakeEnv>) => f.seen.filter(s => s.model === BGE).map(s => s.inputs.text as string[])
const dashFor = (text: string) => dashSeen.filter(d => d.text === text)
/** 请求里列了几句原文：`Source sentences from the cluster (17 of 19; …` */
const shownIn = (d: DashSeen) => Number(/Source sentences from the cluster \((\d+) of 19;/.exec(d.user)![1])

const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)) }

/** 推假时钟直到 promise 落定（上界 3000 步，每步 1s）；真实的本机 HTTP 往返靠 flush 让出事件循环 */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  const q = p.finally(() => { done = true })
  q.catch(() => {})
  for (let i = 0; i < 3000 && !done; i++) { await vi.advanceTimersByTimeAsync(1000); await flush() }
  return q
}

const warnLines = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.map(c => JSON.parse(String(c[0])))

beforeEach(async () => {
  dashSeen = []
  dash = () => OK_REPLY
  const arrivals = new Map<string, number>()
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw)
      const user: string = body.messages[1].content
      const n = /\n\nCheck S(\d+)\. The other sentences are context\.$/.exec(user)![1]
      const text = new RegExp(`^S${n}: (.*)$`, 'm').exec(user)![1]
      dashSeen.push({ headers: req.headers, body, text, system: body.messages[0].content, user })
      const arrival = arrivals.get(user) ?? 0
      arrivals.set(user, arrival + 1)
      const r = dash({ text, arrival })
      if (typeof r === 'object' && 'status' in r) {
        res.writeHead(r.status, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify(r.body))
      }
      const { content, finish } = typeof r === 'string' ? { content: r, finish: 'stop' } : r
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'chatcmpl-1', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: DASH_USAGE }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/compatible-mode/v1`
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

describe('一次调用核查：块接口', () => {
  it('clean：每句一个 DashScope 请求，没有 agent 调用；记录里有方式、各路次数、证据包大小与按厂商分的花费', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY] })
    const r = await settle(service(f).generate(INPUT))

    expect(dashSeen.map(d => d.text).sort()).toEqual([S1, S2, S3].sort())
    expect(agentCalls(f)).toHaveLength(0)
    for (const d of dashSeen) {
      expect({ ...d.body, messages: undefined }).toEqual({ model: 'qwen3.8-flash', temperature: 0.2, max_tokens: 8000, enable_thinking: false })
      expect(d.headers['cf-aig-skip-cache']).toBe('true')
    }
    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toEqual({
      epochs: 1, outcome: 'clean', revisions: 0, unchecked: [], stillFlagged: [], draft: null,
      rounds: [{ round: 0, flagged: [], noVerdict: [] }],
      calls: 3, neurons: expect.closeTo(3 * DASH_NEURONS, 3), ms: expect.any(Number),
      mode: 'one_call', paths: { oneCall: 3, agent: 0 }, fallbacks: [], meaningSearch: true,
      maxEvidence: Math.max(...dashSeen.map(shownIn)),
      dashscope: { calls: 3, usd: expect.closeTo(3 * DASH_USD, 7) },
    })
    // 合计含两条通道：标重点 1 + 写作 1 + 核查 3
    expect(r.trace.llmCalls).toBe(5)
    expect(r.trace.neurons).toBeCloseTo(11 + 3 * DASH_NEURONS, 3)
    expect(f.unscripted).toEqual([])
  })

  it('请求带的是证据包而不是整簇：引用句与邻句、词搜命中、分句按意思搜到的 14:1；简报日期取最新一篇的 UTC 日期', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY] })
    await settle(service(f).generate(INPUT))

    const [s2] = dashFor(S2)
    // 与取证 / 提示词的 golden 是同一句、同一簇、同一组向量：整段 user 应当一字不差
    await expect(s2.user).toMatchFileSnapshot('./golden/one-call-prompt/user.txt')
    expect(s2.user).toContain('(17 of 19;')
    expect(s2.user).toContain('[14:1] (published 2026-09-20 10:00 UTC) Maintenance crews first patched spillway cracks across 2014 summer.')
    expect(s2.user).not.toContain('[11:4]')
    expect(s2.system).toContain('You check one sentence of a news brief item')
    expect(s2.system).toContain('This brief was published on 2026-10-02 and covers about the day before.')
    expect(s2.body.messages.map((m: Msg) => m.role)).toEqual(['system', 'user'])
  })

  it('向量：整簇每句在这一块里只算一次（并发的几句共用），被核的那句与它的分句每次核查一批算', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], revise: [R1_REPLY] })
    dash = q => (q.text === S2 ? FLAG_REPLY : OK_REPLY)
    await settle(service(f).generate(INPUT))

    const batches = embedCalls(f)
    expect(batches.filter(b => b.length === 19)).toEqual([CLUSTER_TEXTS])
    // 草稿三句 + 改过的一句，各一批查询；整簇不因改写再算
    expect(batches.filter(b => b.length !== 19).map(b => b[0]).sort()).toEqual([S1, S2, S2_FIXED, S3].sort())
    expect(batches.find(b => b[0] === S2)).toEqual([S2, 'engineers began repairing in 2015', 'failed on Tuesday night', 'killing 57 people.'])
  })

  it('fixed：被标出的句子发回写作改写，只有改过的那一句再核一次（一次调用）', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], revise: [R1_REPLY] })
    dash = q => (q.text === S2 ? FLAG_REPLY : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(R1_BLOCK)
    expect(dashSeen.map(d => d.text)).toHaveLength(4)
    expect(dashSeen[3].text).toBe(S2_FIXED)
    expect(agentCalls(f)).toHaveLength(0)
    expect(r.trace.check).toMatchObject({
      outcome: 'fixed', revisions: 1, unchecked: [], stillFlagged: [], draft: DRAFT_BLOCK,
      rounds: [
        { round: 0, flagged: [{ sentence: 2, text: S2, findings: [FLAG_FINDING] }], noVerdict: [], revise: { accepted: true, attempts: 1, rejects: [] } },
        { round: 1, flagged: [], noVerdict: [] },
      ],
      // 核查 4 次 + 改写 1 次
      calls: 5, paths: { oneCall: 4, agent: 0 }, fallbacks: [], dashscope: { calls: 4 },
    })
    // 意见照旧带着证据原句发回写作的对话
    const revise = f.seen.find(s => s.model === V4PRO && s.inputs.messages.length > 1)!
    expect(revise.inputs.messages[2].content).toContain(`Sentence 2: ${S2}\n- Problem (detail): ${FLAG_S2.problem}`)
    expect(revise.inputs.messages[2].content).toContain('[14:1] (published 2026-09-20 10:00 UTC) Maintenance crews first patched spillway cracks across 2014 summer.')
    expect(f.unscripted).toEqual([])
  })

  it('回复漏了右花括号：照样读成它本来的 flag', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], revise: [R1_REPLY] })
    dash = q => (q.text === S2 ? FLAG_REPLY.slice(0, -1) : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(r.trace.check!.rounds[0].flagged).toEqual([{ sentence: 2, text: S2, findings: [FLAG_FINDING] }])
    expect(r.trace.check).toMatchObject({ outcome: 'fixed', fallbacks: [] })
    expect(dashFor(S2)).toHaveLength(1)
  })

  it('读不出的回复重试：第二次读得出就用它，不回退', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY] })
    dash = q => (q.text === S2 && q.arrival === 0 ? 'I compared the sentence with the sources and it looks fine.' : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(dashFor(S2)).toHaveLength(2)
    expect(dashFor(S2)[1].body).toEqual(dashFor(S2)[0].body)
    expect(agentCalls(f)).toHaveLength(0)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', unchecked: [], paths: { oneCall: 3, agent: 0 }, fallbacks: [], dashscope: { calls: 4 } })
  })

  // 逐部分核对本来就会把同一句原文、同一句成稿抄好几遍：这不是复读退化，照常读结论。
  // 写作那边的复读检测（同句 ≥3 次 / 12 词片段 ≥4 次）拿来判这种回复，在 152 条实测回复里误拒 10–11 条（2026-10-06 干跑）。
  it('核对过程里同一句话抄了好几遍的回复照常读，不重试', async () => {
    const REPEATED = 'The sentence says the dam failed on Tuesday night and so does the source. '
    const f = fakeEnv({ write: [DRAFT_REPLY] })
    dash = q => (q.text === S2 ? `CHECKS\n${REPEATED.repeat(4)}\nRESULT\n{"ok": true}` : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(dashFor(S2)).toHaveLength(1)
    expect(agentCalls(f)).toHaveLength(0)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', paths: { oneCall: 3, agent: 0 }, fallbacks: [], dashscope: { calls: 3 } })
  })

  it.each<[string, DashReply, string]>([
    ['解不出结论', 'I compared the sentence with the sources and it looks fine.', 'it looks fine.'],
    ['被 token 上限截断（finish_reason length）', { content: OK_REPLY, finish: 'length' }, '{"ok": true}'],
  ])('三次回复都读不出（%s）：这一句改由 agent 核查，记一条 unreadable', async (_name, bad, tail) => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ write: [DRAFT_REPLY], agent: () => AGENT_OK })
    dash = q => (q.text === S2 ? bad : OK_REPLY)
    const r = await settle(service(f, 7).generate(INPUT))

    expect(dashFor(S2)).toHaveLength(3)
    expect(dashSeen).toHaveLength(5)
    // agent 拿到的就是 agent 模式的那份 prompt
    expect(agentCalls(f)).toHaveLength(1)
    expect(agentCalls(f)[0].inputs.messages[1].content).toContain(`Check S2: ${S2}\nIt cites:\n[13:3]`)
    expect(r.block).toEqual(DRAFT_BLOCK)
    const check = r.trace.check!
    expect(check).toMatchObject({
      outcome: 'clean', unchecked: [], paths: { oneCall: 2, agent: 1 },
      // DashScope 5 次 + agent 1 步
      calls: 6, dashscope: { calls: 5, usd: expect.closeTo(5 * DASH_USD, 7) },
    })
    expect(check.neurons).toBeCloseTo(5 * DASH_NEURONS + 100, 3)
    expect(check.fallbacks).toEqual([{ sentence: 2, round: 0, reason: 'unreadable', message: expect.stringMatching(new RegExp(`${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)) }])
    expect(check.fallbacks![0].message.length).toBeLessThanOrEqual(300)
    // 每次回退一行 warn
    const lines = warnLines(warn).filter(l => l.component === 'brief-block-v6' && l.reason === 'unreadable')
    expect(lines).toEqual([expect.objectContaining({ level: 'warn', block: 7, sentence: 2, round: 0 })])
    expect(f.unscripted).toEqual([])
  })

  it('key 无效：不重试，句子交给 agent；这一块之后的核查不再去 DashScope；回退都记成 auth', async () => {
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [R1_REPLY],
      agent: q => (q.text === S2 ? AGENT_FLAG : AGENT_OK),
    })
    dash = () => INVALID_KEY
    const r = await settle(service(f).generate(INPUT))

    // 草稿的三句同时起跑，各撞一次 401（没有一句发第二次）；改写后的那一句不再发请求
    expect(dashSeen.map(d => d.text).sort()).toEqual([S1, S2, S3].sort())
    expect(agentCalls(f)).toHaveLength(4)
    expect(r.block).toEqual(R1_BLOCK)
    const check = r.trace.check!
    expect(check).toMatchObject({ outcome: 'fixed', revisions: 1, unchecked: [], paths: { oneCall: 0, agent: 4 }, dashscope: { calls: 3, usd: 0 } })
    const fallbacks = [...check.fallbacks!].sort((a, b) => a.round - b.round || a.sentence - b.sentence)
    expect(fallbacks.map(x => [x.sentence, x.round, x.reason])).toEqual([[1, 0, 'auth'], [2, 0, 'auth'], [3, 0, 'auth'], [2, 1, 'auth']])
    for (const x of fallbacks) expect(x.message).toContain('Incorrect API key provided.')
    expect(f.unscripted).toEqual([])
  })

  it('没配 key：一个请求都不发，全部句子由 agent 核查', async () => {
    const f = fakeEnv({ noKey: true, write: [DRAFT_REPLY], agent: () => AGENT_OK })
    const r = await settle(service(f).generate(INPUT))

    expect(dashSeen).toHaveLength(0)
    expect(agentCalls(f)).toHaveLength(3)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', unchecked: [], paths: { oneCall: 0, agent: 3 } })
    expect(r.trace.check!.fallbacks!.map(x => x.reason)).toEqual(['auth', 'auth', 'auth'])
  })

  it('内容审核拒绝：不重试，这一句交给 agent，记成 content_filter；别的句子照走一次调用', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], agent: () => AGENT_OK })
    dash = q => (q.text === S2 ? FILTERED : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(dashFor(S2)).toHaveLength(1)
    expect(dashSeen).toHaveLength(3)
    expect(agentCalls(f)).toHaveLength(1)
    const check = r.trace.check!
    expect(check).toMatchObject({ outcome: 'clean', unchecked: [], paths: { oneCall: 2, agent: 1 } })
    expect(check.fallbacks).toEqual([{ sentence: 2, round: 0, reason: 'content_filter', message: expect.stringContaining('DataInspectionFailed') }])
    // 花费按厂商分：DashScope 两次有回包的调用是分项，neurons 合计里还有 agent 的 100
    expect(check.dashscope).toEqual({ calls: 3, usd: expect.closeTo(2 * DASH_USD, 7) })
    expect(check.neurons).toBeCloseTo(2 * DASH_NEURONS + 100, 3)
  })

  it('5xx 之后回了好的：通道里重发一次，不回退', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ write: [DRAFT_REPLY] })
    dash = q => (q.text === S2 && q.arrival === 0 ? { status: 503, body: errorBody('Service unavailable', 'service_unavailable') } : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    expect(dashFor(S2)).toHaveLength(2)
    expect(dashSeen).toHaveLength(4)
    expect(agentCalls(f)).toHaveLength(0)
    // 重发在通道里，不算一次新的核查调用
    expect(r.trace.check).toMatchObject({ outcome: 'clean', paths: { oneCall: 3, agent: 0 }, fallbacks: [], calls: 3, dashscope: { calls: 3 } })
    expect(warnLines(warn).filter(l => l.component === 'dashscope')).toHaveLength(1)
  })

  it('回退的 agent 也没给出结论：这一句记成没核到、照发草稿，打降级的 warn', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ write: [DRAFT_REPLY], agent: () => new Error('5006: Error: invalid input') })
    dash = q => (q.text === S2 ? FILTERED : OK_REPLY)
    const r = await settle(service(f, 5).generate(INPUT))

    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toMatchObject({
      outcome: 'clean', revisions: 0, unchecked: [2], stillFlagged: [], draft: null,
      rounds: [{ round: 0, flagged: [], noVerdict: [2] }],
      paths: { oneCall: 2, agent: 1 },
    })
    const lines = warnLines(warn).filter(l => l.component === 'brief-block-v6' && l.sentences)
    expect(lines).toEqual([expect.objectContaining({ block: 5, outcome: 'clean', sentences: [2], reason: expect.stringContaining('5006') })])
  })

  it('向量算不出来：照常核查，只是不按意思搜（14:1 不在证据里），记录 meaningSearch = false', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ write: [DRAFT_REPLY], embedFails: true })
    const r = await settle(service(f).generate(INPUT))

    const [s2] = dashFor(S2)
    expect(s2.user).toContain('(12 of 19;')
    expect(s2.user).not.toContain('[14:1]')
    expect(dashSeen).toHaveLength(3)
    expect(agentCalls(f)).toHaveLength(0)
    // 整簇那一次失败之后不再为每句去算查询的向量
    expect(embedCalls(f)).toHaveLength(1)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', unchecked: [], meaningSearch: false, paths: { oneCall: 3, agent: 0 }, fallbacks: [], maxEvidence: Math.max(...dashSeen.map(shownIn)) })
    expect(warnLines(warn).filter(l => l.component === 'brief-block-v6' && /向量/.test(l.message))).toHaveLength(1)
  })

  it('epochs 0：两条通道都没有核查调用，也不算向量；记录只有方式与各路次数', async () => {
    const f = fakeEnv({ epochs: '0', write: [DRAFT_REPLY] })
    const r = await settle(service(f).generate(INPUT))

    expect(dashSeen).toHaveLength(0)
    expect(f.seen.map(s => s.model)).toEqual([GLM, V4PRO])
    expect(r.trace.check).toEqual({
      epochs: 0, outcome: 'off', revisions: 0, unchecked: [], stillFlagged: [], draft: null, rounds: [], calls: 0, neurons: 0, ms: 0,
      mode: 'one_call', paths: { oneCall: 0, agent: 0 },
    })
  })

  it('epochs 2：每句两个独立的 DashScope 请求，只要一次判有问题就算被标出', async () => {
    const f = fakeEnv({ epochs: '2', write: [DRAFT_REPLY], revise: [R1_REPLY] })
    dash = q => (q.text === S2 && q.arrival === 1 ? FLAG_REPLY : OK_REPLY)
    const r = await settle(service(f).generate(INPUT))

    for (const s of [S1, S2, S3, S2_FIXED]) expect(dashFor(s)).toHaveLength(2)
    expect(dashFor(S2)[0].body).toEqual(dashFor(S2)[1].body)
    expect(r.block).toEqual(R1_BLOCK)
    expect(r.trace.check).toMatchObject({ epochs: 2, outcome: 'fixed', revisions: 1, paths: { oneCall: 8, agent: 0 }, dashscope: { calls: 8 } })
    expect(r.trace.check!.rounds[0].flagged).toEqual([{ sentence: 2, text: S2, findings: [FLAG_FINDING] }])
    // 整簇的向量仍只算一次
    expect(embedCalls(f).filter(b => b.length === 19)).toHaveLength(1)
  })

  it('调用日志的 key 在一次 run 里不撞：两块同时在飞，一次调用、回退的 agent、向量各按块 × 1000 编号', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY, DRAFT_REPLY], agent: () => AGENT_OK })
    dash = q => (q.text === S2 ? FILTERED : OK_REPLY)
    await settle(Promise.all([service(f, 3).generate(INPUT), service(f, 4).generate(INPUT)]))

    expect(new Set(f.puts).size).toBe(f.puts.length)
    const keys = f.puts.map(k => /^llm-calls\/trace-one-call\/(.+)\.json$/.exec(k)![1]).sort()
    expect(keys).toEqual([
      'brief_block_v6-900', 'brief_block_v6-901', 'brief_block_v6-1000', 'brief_block_v6-1001',
      'brief_block_v6_check-3000', 'brief_block_v6_check-4000',
      ...[3000, 3001, 3002, 4000, 4001, 4002].map(i => `brief_block_v6_check_one_call-${i}`),
      // 每块：整簇一次 + 三句各一批查询
      ...[3000, 3001, 3002, 3003, 4000, 4001, 4002, 4003].map(i => `brief_block_v6_embed-${i}`),
    ].sort())
  })
})

describe('核查方式的开关（BRIEF_CHECK_MODE）', () => {
  it('agent：全部句子由 agent 核查，不碰 DashScope 也不算向量；记录有方式与各路次数，没有 DashScope 的那几项', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ mode: 'agent', write: [DRAFT_REPLY], agent: () => AGENT_OK })
    const r = await settle(service(f).generate(INPUT))

    expect(dashSeen).toHaveLength(0)
    expect(embedCalls(f)).toHaveLength(0)
    expect(agentCalls(f)).toHaveLength(3)
    expect(r.trace.check).toEqual({
      epochs: 1, outcome: 'clean', revisions: 0, unchecked: [], stillFlagged: [], draft: null,
      rounds: [{ round: 0, flagged: [], noVerdict: [] }],
      calls: 3, neurons: 300, ms: expect.any(Number),
      mode: 'agent', paths: { oneCall: 0, agent: 3 },
    })
    expect(warnLines(warn).filter(l => /BRIEF_CHECK_MODE/.test(l.message))).toEqual([])
  })

  it('agent 与不设这个变量发给 binding 的请求完全一样（模型与入参，按先后），DashScope 一个请求都收不到', async () => {
    // 一句被标出、改写一次、复核通过：标重点、写作、核查、改写各种请求都在里面
    const run = async (mode: string | undefined) => {
      const f = fakeEnv({ mode, write: [DRAFT_REPLY], revise: [R1_REPLY], agent: q => (q.text === S2 ? AGENT_FLAG : AGENT_OK) })
      const r = await settle(service(f).generate(INPUT))
      expect(r.block).toEqual(R1_BLOCK)
      expect(f.unscripted).toEqual([])
      return f.seen
    }
    const unset = await run(undefined)
    const agent = await run('agent')

    // 标重点 1 + 写作 1 + 草稿三句各一步 + 改写 1 + 改过的一句一步
    expect(unset.map(s => s.model)).toEqual([GLM, V4PRO, QWEN38, QWEN38, QWEN38, V4PRO, QWEN38])
    expect(agent).toEqual(unset)
    expect(dashSeen).toHaveLength(0)
  })

  it.each([undefined, 'onecall', 'ONE_CALL', ''])('缺省或不认识的值（%s）按 agent，每块打一行 warn', async mode => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({ mode, write: [DRAFT_REPLY], agent: () => AGENT_OK })
    const r = await settle(service(f, 2).generate(INPUT))

    expect(dashSeen).toHaveLength(0)
    expect(embedCalls(f)).toHaveLength(0)
    expect(agentCalls(f)).toHaveLength(3)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', mode: 'agent', paths: { oneCall: 0, agent: 3 } })
    expect(r.trace.check).not.toHaveProperty('dashscope')
    const lines = warnLines(warn).filter(l => /BRIEF_CHECK_MODE/.test(l.message))
    expect(lines).toEqual([expect.objectContaining({ level: 'warn', component: 'brief-block-v6', block: 2 })])
  })
})
