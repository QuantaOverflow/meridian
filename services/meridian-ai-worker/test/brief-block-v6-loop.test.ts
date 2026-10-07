// @vitest-environment node
/**
 * 写作–核查循环（ADR 0010；用词见 GLOSSARY.md「写作–核查循环」）在块接口上的行为：
 * 走真实 BriefBlockV6Service.generate，只假 Workers AI binding 与记 key 的 R2。
 *
 * 假模型按模型与 prompt 形状应答：glm = 标重点；v4-pro 只有一条 user = 写作、带更早轮次 = 改写；
 * qwen3.8 = 逐句核查 agent 的一步（从 user prompt 的 `Check S<n>: …` 认句子，从轮数认第几步）。
 * 等待（写作/改写的退避、限流）用 vitest 假时钟（只假 setTimeout）。
 * 断言只看返回的块、它的 check 记录、以及假模型收到的请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BriefBlockV6Service } from '../src/services/brief-block-v6'

const GLM = '@cf/zai-org/glm-4.7-flash'
const V4PRO = '@cf/deepseek-ai/deepseek-v4-pro-0813'
const QWEN38 = '@cf/qwen/qwen3.8-27b'
/** 每次调用的 neurons，按模型取不同的数，好从合计里分得出谁花的 */
const NEURONS: Record<string, number> = { [GLM]: 1, [V4PRO]: 10, [QWEN38]: 100 }

// ── 簇：两篇报道同一场风暴，第二篇更晚、死亡人数已更新 ─────────────────────
const A1 = {
  id: 101,
  title: 'Storm hits coast',
  publishDate: '2026-10-02T08:00:00.000Z',
  content: 'A storm hit the coast of Freedonia on Wednesday. At least 12 people were killed, officials said. Rescue teams searched for survivors in flooded villages.',
}
const A2 = {
  id: 102,
  title: 'Storm toll rises',
  publishDate: '2026-10-03T06:30:00.000Z',
  content: 'The death toll from the Freedonia storm rose to 15 on Thursday. Another 11 people were injured, the health ministry said. Power was restored to most homes by Thursday evening.',
}
const INPUT = { articles: [A1, A2] }

/** 标重点：材料池 = 101:1、102:1、101:2、102:3（102:2 与 101:3 不在材料里） */
const ANCHORS = JSON.stringify({
  anchors: [
    { topic: 'Storm hits coast', sources: [{ articleId: 101, sentence: 1 }, { articleId: 102, sentence: 1 }] },
    { topic: 'Death toll', sources: [{ articleId: 101, sentence: 2 }] },
    { topic: 'Power restored', sources: [{ articleId: 102, sentence: 3 }] },
  ],
})

type Cite = [number, number]
const src = (cites: Cite[]) => cites.map(([articleId, sentence]) => ({ articleId, sentence }))
const blockOf = (title: string, sentences: Array<[string, Cite[]]>) => ({
  title,
  sentences: sentences.map(([text, cites]) => ({ text, sources: src(cites) })),
})
/** 写作 / 改写的回复（JSON 正文） */
const reply = (title: string, sentences: Array<[string, Cite[]]>) =>
  JSON.stringify({ verdict: 'written', reason: 'one event', ...blockOf(title, sentences) })

const S1 = 'A storm killed at least 12 people in Freedonia on Wednesday.'
const S2 = 'Power was restored to most homes by Thursday evening.'
const DRAFT: Array<[string, Cite[]]> = [[S1, [[101, 1], [101, 2]]], [S2, [[102, 3]]]]
const DRAFT_REPLY = reply('Storm kills 12 in Freedonia', DRAFT)
const DRAFT_BLOCK = blockOf('Storm kills 12 in Freedonia', DRAFT)

/** 改写 1：S1 改成后一篇的 15 人，S2 原样 */
const S1_FIXED = 'The death toll from the storm that hit Freedonia on Wednesday rose to 15.'
const R1: Array<[string, Cite[]]> = [[S1_FIXED, [[101, 1], [102, 1]]], [S2, [[102, 3]]]]
const R1_REPLY = reply('Storm kills 15 in Freedonia', R1)
const R1_BLOCK = blockOf('Storm kills 15 in Freedonia', R1)

// ── 核查 agent 的回复（ReAct 文本协议） ─────────────────────────────────────
const OK = 'Thought: every part matches its sources.\nAction: verdict\nArgs: {"ok": true}'
const act = (action: string, args: unknown) => `Thought: next step.\nAction: ${action}\nArgs: ${JSON.stringify(args)}`
const FLAG_S1 = {
  ok: false,
  type: 'number',
  problem: 'The toll rose to 15 in a later report.',
  evidence: [[102, 1]],
  fix: 'A storm that hit Freedonia on Wednesday killed 15 people.',
}
/**
 * 先引一句没看过的（被拒）→ 检索 → 再给结论。两次结论的 args 不能一字不差：一字不差的第二次
 * 会被当成重复动作（原型 runAgent 的规则，对 verdict 也一样）。
 */
const flagS1Steps = (step: number) =>
  step === 1
    ? act('verdict', { ...FLAG_S1, problem: 'The toll is stale.' })
    : step === 2
      ? act('search', { query: 'death toll' })
      : act('verdict', FLAG_S1)

/** 发回写作的意见的收尾（原型 loop.mts findingsMessage 的原文） */
const FINDINGS_CLOSING = `Write the whole item again and answer in full, in the same JSON format. Fix every problem listed, so that each part
of each sentence is supported by the sources; when reports from different times disagree, use the latest. You may
cite the evidence sentences listed here as well as the material. If a part cannot be supported, leave it out rather
than guess. Write each figure as a source sentence gives it: do not add up or convert numbers yourself, even when the
suggested wording does. Keep the sentences without problems as they are unless a fix requires changing them. All the
earlier instructions still apply: the length, one connected paragraph, each fact said once, attribution,
word-for-word quotes, and never the [articleId:sentence] labels inside text.`

/** 第 1 轮发回写作的意见（原型 loop.mts findingsMessage 的原文，按本簇展开） */
const FINDINGS_S1 = `A fact checker compared each sentence of your item with all the reporting on this story, including reports
that are not in the material above, and found problems in sentence 1:

Sentence 1: A storm killed at least 12 people in Freedonia on Wednesday.
- Problem (number): The toll rose to 15 in a later report.
  Suggested wording, only a hint (check it against the sources): A storm that hit Freedonia on Wednesday killed 15 people.
  Evidence, oldest report first:
  [102:1] (published 2026-10-03 06:30 UTC) The death toll from the Freedonia storm rose to 15 on Thursday.

${FINDINGS_CLOSING}`

/** 改写后仍有毛病的两种 S1（词与数字都在所引原句里，不会被补出处改动） */
const S1_V2 = 'A storm hit Freedonia on Wednesday and the death toll rose to 15.'
const S1_V3 = 'The storm that hit Freedonia on Wednesday raised the death toll to 15.'
const versionWith = (s1: string, title = 'Storm kills 15 in Freedonia') => {
  const sentences: Array<[string, Cite[]]> = [[s1, [[101, 1], [102, 1]]], [S2, [[102, 3]]]]
  return { reply: reply(title, sentences), block: blockOf(title, sentences) }
}
/** 一步给结论：证据就是它引的 102:1（一开始就看过） */
const FLAG_V2 = { ok: false, type: 'detail', problem: 'The toll rose on Thursday, not Wednesday.', evidence: [[102, 1]], fix: S1_FIXED }
const FLAG_V3 = { ok: false, type: 'relation', problem: 'No source says the storm raised the toll.', evidence: [[102, 1]], fix: S1_FIXED }

// ── 假 binding ─────────────────────────────────────────────────────────────
type Reply = string | Error | { content: string; finish?: string }
interface Msg { role: string; content: string }
interface Seen { model: string; inputs: Record<string, any> }
interface CheckQuery {
  /** 被核的那句原文 */
  text: string
  /** 这个 agent 的第几步（1 起） */
  step: number
  /** 同一句同一份 prompt 的第几个 agent（0 起；epoch 之间 prompt 相同，只能按到达先后分） */
  arrival: number
}
interface Script {
  epochs?: string
  /** 标重点的回复；给数组就按调用先后逐个用 */
  anchors?: Reply | Reply[]
  write: Reply[]
  revise?: Reply[]
  check?: (q: CheckQuery) => Reply
}

function fakeEnv(script: Script) {
  const seen: Seen[] = []
  const puts: string[] = []
  const unscripted: string[] = []
  let anchorCalls = 0
  let writes = 0
  let revises = 0
  const arrivals = new Map<string, number>()
  const AI = {
    run: vi.fn(async (model: string, inputs: Record<string, any>) => {
      seen.push({ model, inputs: structuredClone(inputs) })
      const msgs = inputs.messages as Msg[]
      let r: Reply | undefined
      if (model === GLM) r = Array.isArray(script.anchors) ? script.anchors[anchorCalls++] : script.anchors ?? ANCHORS
      else if (model === V4PRO) r = msgs.length === 1 ? script.write[writes++] : script.revise?.[revises++]
      else if (model === QWEN38) {
        const m = /^Check S\d+: (.*)$/m.exec(msgs[1].content)
        if (m && script.check) {
          const step = msgs.length / 2
          const arrival = arrivals.get(msgs[1].content) ?? 0
          if (step === 1) arrivals.set(msgs[1].content, arrival + 1)
          r = script.check({ text: m[1], step, arrival })
        }
      }
      if (r === undefined) {
        unscripted.push(`${model} #${seen.length}`)
        throw new Error(`fake: no reply scripted for ${model} call #${seen.length}`)
      }
      if (r instanceof Error) throw r
      const { content, finish = 'stop' } = typeof r === 'string' ? { content: r } : r
      return { choices: [{ message: { content }, finish_reason: finish }], usage: { completion_tokens: 1, neurons: NEURONS[model] } }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async (key: string) => { puts.push(key) }) } as unknown as R2Bucket
  const env = { AI, ARTICLES_BUCKET, ...(script.epochs === undefined ? {} : { BRIEF_CHECK_EPOCHS: script.epochs }) }
  return { env, seen, puts, unscripted }
}

const service = (f: ReturnType<typeof fakeEnv>, callIndex = 0) =>
  new BriefBlockV6Service(f.env, f.env.AI, { traceId: 'trace-loop', callIndex })

const checkCalls = (f: ReturnType<typeof fakeEnv>) => f.seen.filter(s => s.model === QWEN38)
const systemOf = (s: Seen) => s.inputs.messages[0].content as string
const userOf = (s: Seen) => s.inputs.messages[1].content as string

const flush = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)) }

/** 推假时钟直到 promise 落定（上界 3000 步，每步 1s） */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  const q = p.finally(() => { done = true })
  q.catch(() => {})
  for (let i = 0; i < 3000 && !done; i++) { await vi.advanceTimersByTimeAsync(1000); await flush() }
  return q
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('写作–核查循环：块接口', () => {
  it('epochs 0：不核查、不改写，记录 off；写作仍是 v4-pro', async () => {
    const f = fakeEnv({ epochs: '0', write: [DRAFT_REPLY] })
    const r = await settle(service(f).generate(INPUT))

    expect(f.seen.map(s => s.model)).toEqual([GLM, V4PRO])
    expect(r.verdict).toBe('written')
    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toEqual({
      epochs: 0, outcome: 'off', revisions: 0, unchecked: [], stillFlagged: [], draft: null, rounds: [], calls: 0, neurons: 0, ms: 0,
      mode: 'agent', paths: { oneCall: 0, agent: 0 },
    })
    expect(r.trace).toMatchObject({ llmCalls: 2, neurons: 11 })
    expect(f.unscripted).toEqual([])
  })

  it('写作三次都回 not_a_single_event：收下最后一次（块不出），没有句子可核，不进循环，trace 里没有 check', async () => {
    const refuse = (reason: string) => JSON.stringify({ verdict: 'not_a_single_event', reason, title: '', sentences: [] })
    const f = fakeEnv({ write: [refuse('A topic bag'), refuse('Still a topic bag'), refuse('Two storms')] })
    const r = await settle(service(f).generate(INPUT))

    expect(r).toMatchObject({ verdict: 'not_a_single_event', reason: 'Two storms', block: null })
    expect(r.trace.check).toBeUndefined()
    expect(r.trace.writeRejects).toEqual(['#1 not_written', '#2 not_written'])
    expect(f.seen.map(s => s.model)).toEqual([GLM, V4PRO, V4PRO, V4PRO])
  })

  it('写作回 not_a_single_event：先不收，下一次在写作 prompt 后接「这几篇已判定是同一件新闻」的提示；再写出来就照常进循环', async () => {
    // 10-03 期第 14 块：4 篇都讲美澳暂停驻巴西领事服务，v4-pro 却判「杂烩」；带上这句提示后 3/3 写出了正事
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({
      write: [JSON.stringify({ verdict: 'not_a_single_event', reason: 'A topic bag', title: '', sentences: [] }), DRAFT_REPLY],
      check: () => OK,
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.verdict).toBe('written')
    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.writeRejects).toEqual(['#1 not_written'])
    expect(r.trace.check).toMatchObject({ outcome: 'clean' })
    const writes = f.seen.filter(s => s.model === V4PRO).map(s => s.inputs.messages[0].content as string)
    expect(writes[1]).toBe(`${writes[0]}

Your previous answer was rejected by a mechanical check. Fix these and answer again in full:
- these articles were already judged to be one news story: keep verdict "written" and write the item about its most important development.
Do not repeat the rejected wording; write the item again from the material above.`)
    // 拒写打一行 warn：块号、第几次、模型给的理由（理由只进日志，不回喂模型）
    const lines = warn.mock.calls.map(c => JSON.parse(String(c[0]))).filter(l => l.component === 'brief-block-v6' && l.reason === 'A topic bag')
    expect(lines).toEqual([expect.objectContaining({ level: 'warn', block: 0, attempt: 1 })])
    expect(f.unscripted).toEqual([])
  })

  it.each([undefined, '1', 'two', '-1'])('clean（BRIEF_CHECK_EPOCHS=%s 按 1 次）：草稿没有句子被标出 → 照发草稿', async epochs => {
    const f = fakeEnv({ epochs, write: [DRAFT_REPLY], check: () => OK })
    const r = await settle(service(f).generate(INPUT))

    const checks = checkCalls(f)
    expect(checks).toHaveLength(2)
    expect(checks.map(c => [c.inputs.temperature, c.inputs.max_tokens])).toEqual([[0.2, 3000], [0.2, 3000]])
    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toEqual({
      epochs: 1, outcome: 'clean', revisions: 0, unchecked: [], stillFlagged: [], draft: null,
      rounds: [{ round: 0, flagged: [], noVerdict: [] }],
      calls: 2, neurons: 200, ms: expect.any(Number),
      mode: 'agent', paths: { oneCall: 0, agent: 2 },
    })
    // 合计含核查：标重点 1 + 写作 1 + 核查 2
    expect(r.trace).toMatchObject({ llmCalls: 4, neurons: 211 })
    expect(f.unscripted).toEqual([])
  })

  it('核查 agent 拿到的是整簇（按切句编号、带发布时间）、整块与被核的那句；简报日期取最新一篇的 UTC 日期', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], check: () => OK })
    await settle(service(f).generate(INPUT))

    const s1 = checkCalls(f).find(c => userOf(c).includes('Check S1:'))!
    expect(userOf(s1)).toBe(`The articles in this cluster, oldest first (6 sentences; look them up with the tools):
[101] published 2026-10-02 08:00 UTC: Storm hits coast
[102] published 2026-10-03 06:30 UTC: Storm toll rises

The brief item, for context — title: Storm kills 12 in Freedonia
S1: A storm killed at least 12 people in Freedonia on Wednesday.
S2: Power was restored to most homes by Thursday evening.

Check S1: A storm killed at least 12 people in Freedonia on Wednesday.
It cites:
[101:1] (published 2026-10-02 08:00 UTC) A storm hit the coast of Freedonia on Wednesday.
[101:2] (published 2026-10-02 08:00 UTC) At least 12 people were killed, officials said.`)
    const system = systemOf(s1)
    expect(system).toContain('   - Time: when did the event happen? This brief was published on 2026-10-03 and covers about the day before. An\n')
    expect(system.endsWith('You have at most 20 actions.')).toBe(true)
  })

  it('fixed（一轮）：被标出的句子连同证据发回写作的同一个对话，改写一次后复核通过', async () => {
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [R1_REPLY],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(R1_BLOCK)
    expect(r.trace.check).toEqual({
      epochs: 1, outcome: 'fixed', revisions: 1, unchecked: [], stillFlagged: [],
      draft: DRAFT_BLOCK,
      rounds: [
        {
          round: 0,
          flagged: [{ sentence: 1, text: S1, findings: [{ type: 'number', problem: 'The toll rose to 15 in a later report.', evidence: [[102, 1]], fix: 'A storm that hit Freedonia on Wednesday killed 15 people.' }] }],
          noVerdict: [],
          revise: { accepted: true, attempts: 1, rejects: [] },
        },
        { round: 1, flagged: [], noVerdict: [] },
      ],
      // 核查：S1 三步 + S2 一步 + 改过的 S1 一步；改写一次
      calls: 6, neurons: 510, ms: expect.any(Number),
      mode: 'agent', paths: { oneCall: 0, agent: 3 },
    })
    expect(r.trace).toMatchObject({ llmCalls: 8, neurons: 521 })

    // 改写接着写作的对话：写作 prompt → 草稿原文 → 意见；用写作同一个模型与 schema
    const write = f.seen.find(s => s.model === V4PRO && s.inputs.messages.length === 1)!
    const revise = f.seen.find(s => s.model === V4PRO && s.inputs.messages.length > 1)!
    expect(revise.inputs.messages).toEqual([
      { role: 'user', content: write.inputs.messages[0].content },
      { role: 'assistant', content: DRAFT_REPLY },
      { role: 'user', content: FINDINGS_S1 },
    ])
    expect(revise.inputs.response_format).toEqual(write.inputs.response_format)
    expect([revise.inputs.temperature, revise.inputs.max_tokens]).toEqual([0.1, 8000])

    // 核查 agent 引了没看过的句子 → 被拒，看过之后才收下
    const s1Steps = checkCalls(f).filter(c => userOf(c).includes(`Check S1: ${S1}`))
    expect(s1Steps).toHaveLength(3)
    expect(s1Steps[1].inputs.messages[3]).toEqual({
      role: 'user',
      content: 'Observation:\nREJECTED: [102:1] has not been shown to you yet; look at it first; cite the evidence sentence(s) that show the problem.',
    })
    expect(s1Steps[2].inputs.messages[5]).toEqual({
      role: 'user',
      content: 'Observation:\n[102:1] (published 2026-10-03 06:30 UTC) The death toll from the Freedonia storm rose to 15 on Thursday.',
    })
    expect(f.unscripted).toEqual([])
  })

  it('fixed（两轮）：第一次改写后仍被标出，第二次改写后复核通过；发第二次改写', async () => {
    const v2 = versionWith(S1_V2)
    const fixed = versionWith(S1_FIXED, 'Storm toll rises to 15')
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [v2.reply, fixed.reply],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : q.text === S1_V2 ? act('verdict', FLAG_V2) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(fixed.block)
    const check = r.trace.check!
    expect(check).toMatchObject({ epochs: 1, outcome: 'fixed', revisions: 2, unchecked: [], stillFlagged: [], draft: DRAFT_BLOCK })
    expect(check.rounds.map(x => [x.round, x.flagged.map(g => [g.sentence, g.text]), x.revise?.accepted])).toEqual([
      [0, [[1, S1]], true],
      [1, [[1, S1_V2]], true],
      [2, [], undefined],
    ])
    expect(check.rounds[1].flagged[0].findings).toEqual([
      { type: 'detail', problem: 'The toll rose on Thursday, not Wednesday.', evidence: [[102, 1]], fix: S1_FIXED },
    ])
    expect(f.unscripted).toEqual([])
  })

  it('still_flagged：两次改写后仍有句子被标出 → 发最后一版并记下仍被标出的句号', async () => {
    const v2 = versionWith(S1_V2)
    const v3 = versionWith(S1_V3)
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [v2.reply, v3.reply],
      check: q =>
        q.text === S1 ? flagS1Steps(q.step) : q.text === S1_V2 ? act('verdict', FLAG_V2) : q.text === S1_V3 ? act('verdict', FLAG_V3) : OK,
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(v3.block)
    const check = r.trace.check!
    expect(check).toMatchObject({ outcome: 'still_flagged', revisions: 2, unchecked: [], stillFlagged: [1], draft: DRAFT_BLOCK })
    // 改满两次：最后一轮没有改写
    expect(check.rounds.map(x => [x.round, x.flagged.map(g => g.sentence), x.revise?.accepted])).toEqual([
      [0, [1], true],
      [1, [1], true],
      [2, [1], undefined],
    ])
    // 只改了两次：写作 1 + 改写 2
    expect(f.seen.filter(s => s.model === V4PRO)).toHaveLength(3)
    expect(f.unscripted).toEqual([])
  })

  it('revise_failed（第 1 次改写）：三次尝试全被拒 → 发草稿；每次被拒记一条原因', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [
        reply('Storm kills 15 in Freedonia', [[S1_FIXED, [[101, 3]]], [S2, [[102, 3]]]]), // 101:3 既不在材料里也不是证据
        { content: R1_REPLY, finish: 'length' },
        new Error('boom'),
      ],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : OK),
    })
    const r = await settle(service(f, 7).generate(INPUT))

    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toMatchObject({ outcome: 'revise_failed', revisions: 0, unchecked: [], stillFlagged: [1], draft: null })
    expect(r.trace.check!.rounds).toHaveLength(1)
    expect(r.trace.check!.rounds[0].revise).toEqual({
      accepted: false,
      attempts: 3,
      rejects: ['#1 sentence 1: bad_source', '#2 finish_length', '#3 error: Workers AI binding failed: boom'],
    })
    // 降级打一行 warn：块号、outcome、句号、原因
    const lines = warn.mock.calls.map(c => JSON.parse(String(c[0]))).filter(l => l.outcome === 'revise_failed')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ block: 7, outcome: 'revise_failed', sentences: [1] })
    expect(lines[0].reason).toContain('#1 sentence 1: bad_source')
  })

  it('revise_failed（第 2 次改写）：留第 1 次改写，草稿仍记在 draft 里', async () => {
    const v2 = versionWith(S1_V2)
    const repeated = reply('Storm kills 15 in Freedonia', [[S2, [[102, 3]]], [S2, [[102, 3]]], [S2, [[102, 3]]]])
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [
        'not json', v2.reply, // 第 1 次改写：第二次尝试才过
        repeated, JSON.stringify({ verdict: 'not_a_single_event', reason: 'two stories', title: '', sentences: [] }), versionWith(S1_FIXED, '').reply,
      ],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : q.text === S1_V2 ? act('verdict', FLAG_V2) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(v2.block)
    const check = r.trace.check!
    expect(check).toMatchObject({ outcome: 'revise_failed', revisions: 1, stillFlagged: [1], draft: DRAFT_BLOCK })
    expect(check.rounds.map(x => x.revise)).toEqual([
      { accepted: true, attempts: 2, rejects: ['#1 json_parse'] },
      { accepted: false, attempts: 3, rejects: ['#1 repetition', '#2 revise_not_written', '#3 missing_title'] },
    ])
    expect(f.unscripted).toEqual([])
  })

  it('改写回 not_a_single_event 被拒：下一次只在意见后面接诊断（不回传被拒的原文），再写就收下', async () => {
    const notEvent = JSON.stringify({ verdict: 'not_a_single_event', reason: 'Two separate storms are mixed here', title: '', sentences: [] })
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [notEvent, R1_REPLY],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block).toEqual(R1_BLOCK)
    expect(r.trace.check).toMatchObject({ outcome: 'fixed', revisions: 1 })
    expect(r.trace.check!.rounds[0].revise).toEqual({ accepted: true, attempts: 2, rejects: ['#1 revise_not_written'] })
    const attempts = f.seen.filter(s => s.model === V4PRO && s.inputs.messages.length > 1)
    expect(attempts).toHaveLength(2)
    expect(attempts.map(a => a.inputs.temperature)).toEqual([0.1, 0.3])
    const second = attempts[1].inputs.messages as Msg[]
    expect(second.slice(0, 2)).toEqual(attempts[0].inputs.messages.slice(0, 2))
    expect(second[2]).toEqual({
      role: 'user',
      content: `${FINDINGS_S1}

Your previous answer was rejected by a mechanical check. Fix these and answer again in full:
- this item was already accepted as one story: keep verdict "written" and write it again.
Do not repeat the rejected wording; write the item again from the material above.`,
    })
    expect(JSON.stringify(second)).not.toContain('Two separate storms')
  })

  it('只复核改过的句子：没改的句子（换了位置也算没改）沿用上一轮结论，被标出的照样算被标出', async () => {
    // 第 1 次改写：S2 挪到前面、S1 改成 S1_V2；第 2 次改写：一字不改
    const moved = reply('Storm kills 15 in Freedonia', [[S2, [[102, 3]]], [S1_V2, [[101, 1], [102, 1]]]])
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [moved, moved],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : q.text === S1_V2 ? act('verdict', FLAG_V2) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    // 每个文本只核一次：S1 三步、S2 一步、S1_V2 一步；第 2 次改写后一句都不用再核
    const checkedTexts = checkCalls(f).map(c => /^Check S\d+: (.*)$/m.exec(userOf(c))![1])
    expect(checkedTexts).toEqual([S1, S2, S1, S1, S1_V2])
    expect(userOf(checkCalls(f)[4])).toContain(`Check S2: ${S1_V2}`)
    const check = r.trace.check!
    expect(check).toMatchObject({ outcome: 'still_flagged', revisions: 2, stillFlagged: [2] })
    expect(check.rounds[2]).toEqual({
      round: 2,
      flagged: [{ sentence: 2, text: S1_V2, findings: [{ type: 'detail', problem: 'The toll rose on Thursday, not Wednesday.', evidence: [[102, 1]], fix: S1_FIXED }] }],
      noVerdict: [],
    })
    expect(f.unscripted).toEqual([])
  })

  it('证据句可以引：改写引了材料外、但作为证据发给它的那句，照样收下', async () => {
    const S1_INJ = 'The storm that hit Freedonia on Wednesday killed 15 people and injured 11.'
    const flag = { ok: false, type: 'number', problem: 'The toll is stale and the injured are left out.', evidence: [[102, 1], [102, 2]], fix: S1_INJ }
    const cites102_2 = reply('Storm kills 15 in Freedonia', [[S1_INJ, [[101, 1], [102, 1], [102, 2]]], [S2, [[102, 3]]]])
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [cites102_2],
      check: q => (q.text === S1 ? (q.step === 1 ? act('search', { query: 'death toll injured' }) : act('verdict', flag)) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    // 102:2 不在材料池里；它是第 0 轮的证据句，所以 writeOk 认它
    expect(r.trace.check).toMatchObject({ outcome: 'fixed', revisions: 1 })
    expect(r.trace.check!.rounds[0].revise).toEqual({ accepted: true, attempts: 1, rejects: [] })
    expect(r.block!.sentences[0]).toEqual({ text: S1_INJ, sources: src([[101, 1], [102, 1], [102, 2]]) })
    const findings = f.seen.find(s => s.model === V4PRO && s.inputs.messages.length > 1)!.inputs.messages[2].content as string
    expect(findings).toContain(`  Evidence, oldest report first:
  [102:1] (published 2026-10-03 06:30 UTC) The death toll from the Freedonia storm rose to 15 on Thursday.
  [102:2] (published 2026-10-03 06:30 UTC) Another 11 people were injured, the health ministry said.`)
    expect(f.unscripted).toEqual([])
  })

  it('数字检查：改写照抄核查员加出来的数（15 + 11 → 26）被拒，提示里列出那个数；重写成原句里的数就收下（年份不算）', async () => {
    const S1_SUM = 'The storm that hit Freedonia on Wednesday killed 15 people and left 26 people hurt.'
    const S1_OK = 'The storm that hit Freedonia on Wednesday, the worst since 1998, killed 15 people and injured 11.'
    const flag = { ok: false, type: 'number', problem: 'The toll is stale.', evidence: [[102, 1], [102, 2]], fix: 'The storm killed 15 people and wounded 26.' }
    const cites: Cite[] = [[101, 1], [102, 1], [102, 2]]
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      revise: [
        reply('Storm kills 15 in Freedonia', [[S1_SUM, cites], [S2, [[102, 3]]]]),
        reply('Storm kills 15 in Freedonia', [[S1_OK, cites], [S2, [[102, 3]]]]),
      ],
      check: q => (q.text === S1 ? (q.step === 1 ? act('search', { query: 'death toll injured' }) : act('verdict', flag)) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.trace.check).toMatchObject({ outcome: 'fixed', revisions: 1 })
    expect(r.trace.check!.rounds[0].revise).toEqual({ accepted: true, attempts: 2, rejects: ['#1 sentence 1: number_not_in_sources'] })
    expect(r.block!.sentences[0]).toEqual({ text: S1_OK, sources: src(cites) })
    const attempts = f.seen.filter(s => s.model === V4PRO && s.inputs.messages.length > 1)
    const findings = attempts[0].inputs.messages[2].content as string
    expect(attempts[1].inputs.messages[2].content).toBe(`${findings}

Your previous answer was rejected by a mechanical check. Fix these and answer again in full:
- sentence 1: the figure(s) 26 appear in no source sentence it cites; write each figure as a source sentence gives it, without adding up or converting numbers, and cite that sentence.
Do not repeat the rejected wording; write the item again from the material above.`)
    expect(f.unscripted).toEqual([])
  })

  it('数字检查只查改过的句子：没改的那句带着所引原句里没有的数，不拦改写', async () => {
    // 草稿 S2 写了 40,000（所引的 102:3 里没有数），核查判它没问题；改写只改被标出的 S1，S2 原样带回
    const S2_NUM = 'Power was restored to 40,000 homes by Thursday evening.'
    const f = fakeEnv({
      write: [reply('Storm kills 12 in Freedonia', [[S1, [[101, 1], [101, 2]]], [S2_NUM, [[102, 3]]]])],
      revise: [reply('Storm kills 15 in Freedonia', [[S1_FIXED, [[101, 1], [102, 1]]], [S2_NUM, [[102, 3]]]])],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    expect(r.trace.check).toMatchObject({ outcome: 'fixed', revisions: 1 })
    expect(r.trace.check!.rounds[0].revise).toEqual({ accepted: true, attempts: 1, rejects: [] })
    expect(r.block!.sentences.map(s => s.text)).toEqual([S1_FIXED, S2_NUM])
    expect(f.unscripted).toEqual([])
  })

  it('数字检查只管改写：草稿里有所引原句没有的数也照收（草稿与测过的一次写成保持一致）', async () => {
    const S1_13 = 'A storm killed at least 13 people in Freedonia on Wednesday.'
    const f = fakeEnv({ epochs: '0', write: [reply('Storm kills 13 in Freedonia', [[S1_13, [[101, 1], [101, 2]]], [S2, [[102, 3]]]])] })
    const r = await settle(service(f).generate(INPUT))

    expect(r.block!.sentences[0].text).toBe(S1_13)
    expect(r.trace.writeRejects).toEqual([])
    expect(f.seen.filter(s => s.model === V4PRO)).toHaveLength(1)
  })

  it('改写的请求按顺序带着整段对话：写作通过那次实际发的 prompt（含诊断）→ 草稿原文 → 每轮意见（含诊断）与改写原文 → 新意见', async () => {
    const draftNoTitle = reply('', DRAFT)
    const v2 = versionWith(S1_V2)
    const v2BadSource = reply('Storm kills 15 in Freedonia', [[S1_V2, [[101, 3]]], [S2, [[102, 3]]]])
    const fixed = versionWith(S1_FIXED)
    const f = fakeEnv({
      write: [draftNoTitle, DRAFT_REPLY],
      revise: [v2BadSource, v2.reply, fixed.reply],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : q.text === S1_V2 ? act('verdict', FLAG_V2) : OK),
    })
    const r = await settle(service(f).generate(INPUT))
    expect(r.trace.check).toMatchObject({ outcome: 'fixed', revisions: 2 })

    const writes = f.seen.filter(s => s.model === V4PRO && s.inputs.messages.length === 1)
    const revises = f.seen.filter(s => s.model === V4PRO && s.inputs.messages.length > 1)
    expect(writes).toHaveLength(2)
    expect(revises).toHaveLength(3)
    const writePrompt = writes[0].inputs.messages[0].content as string
    const writeSent = `${writePrompt}

Your previous answer was rejected by a mechanical check. Fix these and answer again in full:
- title was missing or empty; give the story a short headline.
Do not repeat the rejected wording; write the item again from the material above.`
    expect(writes[1].inputs.messages[0].content).toBe(writeSent)
    const findings1Sent = `${FINDINGS_S1}

Your previous answer was rejected by a mechanical check. Fix these and answer again in full:
- sentence 1: a cited [articleId:sentence] coordinate is not in the material above; cite only sentences shown there.
Do not repeat the rejected wording; write the item again from the material above.`
    const findings2 = `A fact checker compared each sentence of your item with all the reporting on this story, including reports
that are not in the material above, and found problems in sentence 1:

Sentence 1: A storm hit Freedonia on Wednesday and the death toll rose to 15.
- Problem (detail): The toll rose on Thursday, not Wednesday.
  Suggested wording, only a hint (check it against the sources): The death toll from the storm that hit Freedonia on Wednesday rose to 15.
  Evidence, oldest report first:
  [102:1] (published 2026-10-03 06:30 UTC) The death toll from the Freedonia storm rose to 15 on Thursday.

${FINDINGS_CLOSING}`
    expect(revises[2].inputs.messages).toEqual([
      { role: 'user', content: writeSent },
      { role: 'assistant', content: DRAFT_REPLY },
      { role: 'user', content: findings1Sent },
      { role: 'assistant', content: v2.reply },
      { role: 'user', content: findings2 },
    ])
    // 被拒的原文从不回传：没标题的草稿、引错出处的那次改写都不在任何后续请求里
    for (const s of [...writes.slice(1), ...revises]) {
      const sent = JSON.stringify(s.inputs.messages)
      expect(sent).not.toContain(JSON.stringify(draftNoTitle).slice(1, -1))
      expect(sent).not.toContain('101,\\"sentence\\":3')
    }
    expect(f.unscripted).toEqual([])
  })

  it('核查出错或动作用完：句子记成没核到、照发草稿，整块按降级记录并打 warn', async () => {
    const warn = vi.spyOn(console, 'warn')
    const f = fakeEnv({
      write: [DRAFT_REPLY],
      check: q =>
        q.text === S1
          ? new Error('3040: Capacity temporarily exceeded, please try again.')
          : q.step === 1
            ? 'I think this sentence is fine.' // 读不懂的回复：不算动作
            : act('search', { query: `storm ${q.step}` }), // 每步换一个检索，永远不给结论
    })
    const r = await settle(service(f, 5).generate(INPUT))

    expect(r.block).toEqual(DRAFT_BLOCK)
    expect(r.trace.check).toEqual({
      epochs: 1, outcome: 'clean', revisions: 0, unchecked: [1, 2], stillFlagged: [], draft: null,
      rounds: [{ round: 0, flagged: [], noVerdict: [1, 2] }],
      // S1：一步三次调用都失败；S2：1 条读不懂 + 21 个动作
      calls: 25, neurons: 2200, ms: expect.any(Number),
      mode: 'agent', paths: { oneCall: 0, agent: 2 },
    })
    const s2 = checkCalls(f).filter(c => userOf(c).includes(`Check S2: ${S2}`))
    expect(s2).toHaveLength(22)
    const lastUser = (c: Seen) => (c.inputs.messages as Msg[]).at(-1)!.content
    expect(lastUser(s2[1])).toBe(
      'Observation:\nYour reply did not follow the format. Reply with exactly three parts: Thought: …, Action: <tool>, Args: {…}.'
    )
    expect(lastUser(s2[20]).endsWith('\n\nYou have one action left: give your verdict now.')).toBe(true)
    expect(lastUser(s2[21]).endsWith('\n\nNo actions left: give your verdict now.')).toBe(true)

    const lines = warn.mock.calls.map(c => JSON.parse(String(c[0]))).filter(l => l.component === 'brief-block-v6' && l.sentences)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ block: 5, outcome: 'clean', sentences: [1, 2] })
    expect(lines[0].reason).toContain('error: Workers AI binding failed: 3040: Capacity temporarily exceeded')
    expect(lines[0].reason).toContain('out of actions')
  })

  it('epochs 2：每句两次独立核查，只要一次判有问题就算被标出', async () => {
    const flag = { ok: false, type: 'number', problem: 'The toll rose to 15 in a later report.', evidence: [[101, 2]], fix: S1_FIXED }
    const f = fakeEnv({
      epochs: '2',
      write: [DRAFT_REPLY],
      revise: [R1_REPLY],
      // S1 的两个 agent 拿到的 prompt 一样，按到达先后分：一个说没问题，一个判有问题
      check: q => (q.text === S1 && q.arrival === 1 ? act('verdict', flag) : OK),
    })
    const r = await settle(service(f).generate(INPUT))

    const s1 = checkCalls(f).filter(c => userOf(c).includes(`Check S1: ${S1}`))
    expect(s1).toHaveLength(2)
    expect(s1[0].inputs.messages).toEqual(s1[1].inputs.messages)
    expect(r.block).toEqual(R1_BLOCK)
    const check = r.trace.check!
    expect(check).toMatchObject({ epochs: 2, outcome: 'fixed', revisions: 1, unchecked: [], stillFlagged: [] })
    expect(check.rounds[0].flagged).toEqual([
      { sentence: 1, text: S1, findings: [{ type: 'number', problem: 'The toll rose to 15 in a later report.', evidence: [[101, 2]], fix: S1_FIXED }] },
    ])
    // 核查：草稿 2 句 × 2 + 改过的 1 句 × 2；改写 1
    expect(check.calls).toBe(7)
    expect(f.unscripted).toEqual([])
  })

  it('请求里没有带日期的文章：检查清单去掉「简报发布于…」那一句，其余照留', async () => {
    const f = fakeEnv({ write: [DRAFT_REPLY], check: () => OK })
    await settle(service(f).generate({ articles: [{ ...A1, publishDate: undefined }, { ...A2, publishDate: undefined }] }))

    const system = systemOf(checkCalls(f)[0])
    expect(system).not.toContain('This brief was published on')
    expect(system).toContain('   - Time: when did the event happen? An\n     event from before that must be dated or marked as earlier in the sentence; otherwise it reads as new.\n')
    expect(userOf(checkCalls(f)[0])).toContain('[101] published time unknown: Storm hits coast')
  })

  it('限流：v4-pro 与 qwen3.8 报限流（3021 / rate limit）就等 15s、25s… 后原样重发，不占尝试、不占步数；glm 照旧算一次失败', async () => {
    const f = fakeEnv({
      anchors: [new Error('3021: Rate limit exceeded'), ANCHORS],
      write: [new Error('AiError: 3021: too many requests'), new Error('Rate Limit reached for this model'), DRAFT_REPLY],
      // S1 的第一步第一次被限流；重发的那次是同一个请求，按到达先后是第 2 个
      check: q => (q.text === S1 && q.arrival === 0 ? new Error('3021: too many requests') : OK),
    })
    const writes = () => f.seen.filter(s => s.model === V4PRO).length
    const p = service(f).generate(INPUT)

    await flush()
    expect(f.seen.map(s => s.model)).toEqual([GLM])
    // glm 不等限流：这次算失败的尝试，按原来的 3s 退避进第 2 次（温度 0.3）
    await vi.advanceTimersByTimeAsync(3000); await flush()
    expect(f.seen.map(s => s.model)).toEqual([GLM, GLM, V4PRO])
    await vi.advanceTimersByTimeAsync(14_999); await flush()
    expect(writes()).toBe(1)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(writes()).toBe(2)
    await vi.advanceTimersByTimeAsync(24_999); await flush()
    expect(writes()).toBe(2)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(writes()).toBe(3)
    const r = await settle(p)

    expect(f.seen.filter(s => s.model === GLM).map(s => s.inputs.temperature)).toEqual([0.1, 0.3])
    const sends = f.seen.filter(s => s.model === V4PRO)
    expect(sends.map(s => s.inputs.temperature)).toEqual([0.1, 0.1, 0.1])
    expect(sends[1].inputs).toEqual(sends[0].inputs)
    expect(sends[2].inputs).toEqual(sends[0].inputs)
    expect(r.trace.writeRejects).toEqual([])
    // 核查：S1 被限流的那步重发后照样给了结论，一步就完
    const s1 = checkCalls(f).filter(c => userOf(c).includes(`Check S1: ${S1}`))
    expect(s1).toHaveLength(2)
    expect(s1[1].inputs).toEqual(s1[0].inputs)
    expect(r.trace.check).toMatchObject({ outcome: 'clean', unchecked: [], calls: 2 })
    // 一次逻辑调用一条日志：等待重发的不另记
    expect(r.trace.llmCalls).toBe(5)
    expect([...f.puts].sort()).toEqual(
      ['brief_block_v6-600', 'brief_block_v6-601', 'brief_block_v6-602', 'brief_block_v6_check-000', 'brief_block_v6_check-001'].map(
        k => `llm-calls/trace-loop/${k}.json`
      )
    )
  })

  it('限流等满 8 次（共 400s）还被限流：照原来的报错处理，写作这一次尝试算失败、退避后进下一次', async () => {
    const warn = vi.spyOn(console, 'warn')
    const limited = Array.from({ length: 9 }, () => new Error('3021: Rate limit exceeded'))
    const f = fakeEnv({ epochs: '0', write: [...limited, DRAFT_REPLY] })
    const writes = () => f.seen.filter(s => s.model === V4PRO).length
    const p = service(f).generate(INPUT)

    await flush()
    expect(writes()).toBe(1)
    // 第 n 次等待 15 + 10(n-1) 秒：重发时刻 15、40、75、120、175、240、315、400
    await vi.advanceTimersByTimeAsync(399_999); await flush()
    expect(writes()).toBe(8)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(writes()).toBe(9)
    await vi.advanceTimersByTimeAsync(2_999); await flush()
    expect(writes()).toBe(9)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(writes()).toBe(10)
    const r = await settle(p)

    expect(f.seen.filter(s => s.model === V4PRO).map(s => s.inputs.temperature)).toEqual([...Array(9).fill(0.1), 0.3])
    expect(r.block).toEqual(DRAFT_BLOCK)
    const waits = warn.mock.calls.map(c => JSON.parse(String(c[0]))).filter(l => l.component === 'workers-ai')
    expect(waits).toHaveLength(8)
    expect(waits[0]).toMatchObject({ model: V4PRO })
  })

  it('R2 key 在一次 run 里不撞：两块同时在飞，写作 / 改写在各自 100 槽位里连号，核查调用按块 × 1000 另编号', async () => {
    // 同一个 trace、同一个桶；两块各自一轮改写（写作、改写的回复按到达先后两块共用）
    const f = fakeEnv({
      write: [DRAFT_REPLY, DRAFT_REPLY],
      revise: [R1_REPLY, R1_REPLY],
      check: q => (q.text === S1 ? flagS1Steps(q.step) : OK),
    })
    const [a, b] = await settle(Promise.all([service(f, 3).generate(INPUT), service(f, 4).generate(INPUT)]))
    expect([a.trace.check!.outcome, b.trace.check!.outcome]).toEqual(['fixed', 'fixed'])

    expect(new Set(f.puts).size).toBe(f.puts.length)
    const keys = f.puts.map(k => /^llm-calls\/trace-loop\/(.+)\.json$/.exec(k)![1]).sort()
    // 每块：标重点 1 + 写作 1 + 改写 1；核查 S1 三步 + S2 一步 + 改过的 S1 一步
    expect(keys).toEqual([
      'brief_block_v6-1000', 'brief_block_v6-1001', 'brief_block_v6-1002',
      'brief_block_v6-900', 'brief_block_v6-901', 'brief_block_v6-902',
      ...[3000, 3001, 3002, 3003, 3004, 4000, 4001, 4002, 4003, 4004].map(i => `brief_block_v6_check-${i}`),
    ])
    expect(f.unscripted).toEqual([])
  })
})
