/**
 * 【简报块 v6 · 编排】一个簇的原文 → 一块高管简报正文（逐句带出处）。
 *
 *   1 切句     每篇正文切句，1 起编号（utils/report-v3.ts 的 splitSentences）        代码
 *   2 切窗     30,000 字符预算、相邻窗口重叠 1 篇，覆盖不变量断言                    代码
 *   3 标重点   每个窗口一次调用，只标 topic + 原文句编号，不写散文（约束式解码）     LLM × 窗口数
 *   4 写作     全部重点 + 它们指向的原句 → 一块简报（句数随 tier：lead 5–7 / more 3–5 /  LLM × 1
 *              brief 1，以 prompts/briefBlockV6.ts 的 WRITE_LEN 为准）
 *   5 补出处   句中数字/引语不在所引原句里 → 在材料池里找字面包含它的原句补上        代码
 *   6 核查改写 写作–核查循环（ADR 0010）：每句逐句核查（qwen3.8 小 agent × epoch 数），  LLM × 句数 × 步数
 *              被标出就把意见发回写作的对话整块改写，只复核改过的句子，最多改两次     + 改写 ≤ 2
 *              （services/sentence-check.ts；BRIEF_CHECK_EPOCHS=0 关掉）
 *
 * 标重点用 glm-4.7-flash，写作与改写用 deepseek-v4-pro（ADR 0010）。
 *
 * 移植自原型 `eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs`，取
 * `WRITE_AT_END=1 / WRITE_TIER=exec / WRITE_SUPPORT=1 / WRITE_REPAIR=mech` 这一条路径。
 * 纯函数在 utils/brief-block-v6.ts，prompt 在 prompts/briefBlockV6.ts。
 *
 * 相对原型补的两处（原型是本地脚本，失败就整簇抛错；Worker 里一簇 16 篇要切 4 个窗口）：
 *   · 单个窗口三次尝试全失败 → 跳过该窗口、记 windowFailures，其余窗口照跑；
 *     全部窗口失败或重点数为 0 才抛错（整块失败，由 backend 的 step 重试兜）。
 *   · 每次产出都过 detectRepetition。glm-4.7-flash 的复读退化在本仓已发作四次，
 *     frequency_penalty 是缓解不是解药，真正挡住要靠解析处的重复检测（memory
 *     repetition-guard-always-on）。检出 → 本次尝试算失败，进下一次。
 */
import { callLLMUntilAccepted, LLMAttemptsExhausted } from './call-llm';
import type { TraceContext } from './llm-call-logger';
import { sentenceCheck, type CheckCaller, type SentenceCheckRun } from './sentence-check';
import type { ChatMessage, CloudflareEnv } from '../types';
import type {
  BriefBlockV6Check,
  BriefBlockV6CheckOutcome,
  BriefBlockV6Request as BriefBlockV6Input,
  BriefBlockV6Result,
} from '@meridian/contracts';
import { splitSentences } from '../utils/report-v3';
import { detectRepetition } from '../utils/brief-writer-v3';
import {
  ANCHOR_SCHEMA,
  REVISE_HINTS,
  findingsMessage,
  getAnchorPrompt,
  getWriteSchema,
  getWritePrompt,
  noSentencesHint,
} from '../prompts/briefBlockV6';
import {
  anchorOk,
  cleanWrite,
  contextOf,
  makeWindows,
  numberCheck,
  normalizeTier,
  repairCitations,
  retryInstruction,
  writeOk,
  type SentenceTable,
  type V6Anchor,
  type V6Article,
  type V6Sentence,
  type V6Source,
  type V6Tier,
} from '../utils/brief-block-v6';
import { briefDateOf, clusterOf, type Verdict } from '../utils/sentence-check';
import { Logger } from '../utils/logger';

const logger = new Logger({ component: 'brief-block-v6' });

/** 标重点（窗口步）。 */
const ANCHOR_MODEL = '@cf/zai-org/glm-4.7-flash';
/** 写作与改写（写作–核查循环，ADR 0010）：一次写成的走样比 glm-4.7-flash 少一半，标重点仍用 glm。 */
const WRITER_MODEL = '@cf/deepseek-ai/deepseek-v4-pro-0813';
/** 同时在飞的窗口调用数（原型 DIRECT_RAW_CONCURRENCY 默认值）。 */
const CONCURRENCY = 2;
/** 原型 chatJson 的重试策略：三次、温度依次这三个值、退避 3s → 8s。 */
const TEMPERATURES = [0.1, 0.3, 0.3];
const BACKOFF_MS = [3000, 8000];
/** callIndex 起点。日志 key 带 phase 段，与标题（brief_generation-690）本就不会撞，取值只是沿用。 */
const CALL_INDEX_BASE = 600;
/**
 * 每块（story）占的 callIndex 槽位数。
 *
 * 一块一个 service 实例、`this.llmCalls` 从 0 起，所以只靠它算 callIndex 的话 24 个块全写
 * `brief_block_v6-600`，后写的覆盖先写的（2026-09-19 实测：storyIdx=17 的原始输出查不到）。
 * 用 backend 传进来的 story 序号乘上这个步长把块彼此隔开。
 *
 * 100 是够用的上界：一块最多 = 窗口数 × 3 次尝试 + 写作 3 次尝试 + 改写 2 次 × 3 次尝试，
 * 最大的簇也只有 3 个窗口（9 + 3 + 6 = 18）。逐句核查的调用另有 phase 与编号，不占这里的槽位。
 * 日志 key 里带 phase 段（`brief_block_v6`），与 brief_generation 的标题(690)
 * 天然分开，所以这里只需要块间唯一，基数取多少都不会跨 phase 撞车。
 */
const CALL_INDEX_PER_STORY = 100;
/**
 * 逐句核查 agent 的调用（phase `brief_block_v6_check`）的 callIndex = story 序号 × 这个步长 + 块内计数。
 * 与写作 / 改写的计数分开：核查调用再多，写作与改写在 brief_block_v6 的 100 个槽位里的编号也不跳。
 *
 * 上界：一块的核查调用 = 句数 × epoch 数 × 核的版本数 × 每个 agent 的步数。句数最多 7（lead 档），
 * 版本最多 3（草稿 + 两次改写，改写后只核改过的句子），一个 agent 最多 21 个动作 + 11 条读不懂的回复
 * = 32 步，所以 1 个 epoch 最坏 7 × 3 × 32 = 672 < 1000。2 个 epoch 的理论最坏（每个 agent 都把两种上限
 * 用满）会超过 1000、和下一块的前几个编号撞 key；只丢观测记录，不影响产出。某步调用报错重试的那几次另算。
 */
const CHECK_CALL_INDEX_PER_STORY = 1000;
/** 每块同时在飞的逐句核查 agent 数（原型 CHECKS_IN_FLIGHT 默认值）。 */
const CHECKS_IN_FLIGHT = 10;
/** 最多改写几次（原型 MAX_ROUNDS）。 */
const MAX_REVISIONS = 2;

/** 复读检测读的文本：各句 text 连起来（写作与改写同一口径）。 */
const sentencesText = (x: any): string =>
  Array.isArray(x.sentences) ? (x.sentences as Array<{ text: string }>).map(s => String(s?.text ?? '')).join(' ') : '';

/** BRIEF_CHECK_EPOCHS："0" = 关；正整数 = 几次；缺省或其他任何值 = 1（缺变量不会悄悄关掉核查）。 */
const checkEpochsOf = (raw: string | undefined): number => (raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 1);

type Version = { title: string; sentences: V6Sentence[] };
type CheckRound = BriefBlockV6Check['rounds'][number];

/** 一版里一句的核查：每个 epoch 一次运行；文本没变、沿用上一轮结论的句子 carried = true。 */
interface CheckLog {
  index: number;
  text: string;
  runs: SentenceCheckRun[];
  carried: boolean;
}

/** 任一 epoch 判有问题就算被标出（宁可多改，不漏错）。 */
const isFlagged = (l: CheckLog) => l.runs.some(r => r.verdict?.ok === false);
/** 没有一个 epoch 给出结论：没核到。 */
const isUnchecked = (l: CheckLog) => !l.runs.some(r => r.verdict);

const findingOf = (v: Extract<Verdict, { ok: false }>) => ({
  ...(v.type !== undefined ? { type: v.type } : {}),
  ...(v.problem !== undefined ? { problem: v.problem } : {}),
  evidence: v.evidence,
  ...(v.fix !== undefined ? { fix: v.fix } : {}),
});

/** 一轮的记录：这一版里被标出的句子（含沿用的，每个判有问题的 epoch 一条意见）与这一轮核了却没有结论的句子。 */
function roundOf(round: number, logs: CheckLog[]): CheckRound {
  return {
    round,
    flagged: logs.filter(isFlagged).map(l => ({
      sentence: l.index,
      text: l.text,
      findings: l.runs.flatMap(r => (r.verdict && !r.verdict.ok ? [findingOf(r.verdict)] : [])),
    })),
    noVerdict: logs.filter(l => !l.carried && isUnchecked(l)).map(l => l.index),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        result[i] = await fn(items[i], i);
      }
    })
  );
  return result;
}

export class BriefBlockV6Service {
  /** 标重点 / 写作 / 改写的调用数，也是它们 callIndex 的块内计数 */
  private llmCalls = 0;
  /** 逐句核查 agent 的调用数，也是它们 callIndex 的块内计数（与上面分开，见 CHECK_CALL_INDEX_PER_STORY） */
  private checkCalls = 0;
  private neurons = 0;
  private windowFailures = 0;
  private writeRejects: string[] = [];
  constructor(private env: CloudflareEnv, private ai: Ai, private traceContext: TraceContext = {}) {}

  /**
   * 原型 `chatJson` 的移植：最多三次，温度 [0.1, 0.3, 0.3]，退避 [3s, 8s]。
   * 「这次算成功」= 调用没抛 + finish_reason 不是 length + JSON 解得出 + 过 ok() + 不复读。
   * 三次都不过就抛错，由调用方决定是跳过这个窗口还是整块失败。
   *
   * 自救重试：`ok()` 返回失败原因列表（空 = 通过），第 2、3 次尝试把上一次的**诊断**
   * 追加在 prompt 末尾。**只回传诊断，不回传模型上一次的输出原文**——让 glm-4.7-flash
   * 接着自己的退化文本往下写有加剧风险（复读事故已四次，memory repetition-guard-always-on）。
   * 复读那层保持原样：检出就直接重试，不附加诊断。
   */
  private async chatJson(
    tag: string,
    prompt: string,
    schema: Record<string, unknown>,
    ok: (x: any) => string[],
    repetitionTextOf: (x: any) => string,
    o: {
      model: string;
      /** 校验不过的原因，每次一条 `#尝试次 原因…`（trace.writeRejects 的口径） */
      rejects?: string[];
      /** 每次被拒的尝试一条 `#尝试次 原因`：校验原因、截断、JSON 解不出、复读或调用报错（改写记录的口径） */
      attemptRejects?: string[];
      hints?: Partial<Record<string, string>>;
      /** 同一对话里更早的轮次，发在这次 prompt 之前（改写接着写作的对话） */
      history?: ChatMessage[];
    }
  ): Promise<{ value: any; raw: string; prompt: string; attempts: number }> {
    const { rejects, attemptRejects, hints = {} } = o;
    // 每次尝试实际发出的 prompt（重试时带诊断）；通过的那次就是改写要接上的那一轮 user
    let sent = prompt;
    try {
      const r = await callLLMUntilAccepted<{ parsed: any; raw: string }>(this.ai, this.env, this.traceContext, 'brief_block_v6', {
        attempts: TEMPERATURES.length,
        history: o.history,
        overrides: attempt => {
          // 块间唯一：见 CALL_INDEX_PER_STORY。traceContext.callIndex 是 backend 传的 story 序号。
          const storyIdx = this.traceContext.callIndex ?? 0;
          const callIndex = CALL_INDEX_BASE + storyIdx * CALL_INDEX_PER_STORY + this.llmCalls;
          this.llmCalls++;
          return {
            model: o.model,
            temperature: TEMPERATURES[attempt],
            callIndex,
            responseFormat: { type: 'json_schema' as const, json_schema: schema },
          };
        },
        prompt: (_attempt, lastReasons) =>
          (sent = lastReasons.length ? `${prompt}\n\n${retryInstruction(lastReasons, hints)}` : prompt),
        accept: (res, attempt) => {
          const choice = res.choices?.[0];
          const content = String(choice?.message?.content ?? '');
          const truncated = choice?.finish_reason === 'length';
          let parsed: any = null;
          try {
            parsed = JSON.parse(content);
          } catch {
            // eslint-disable-next-line local/no-swallowed-catch -- 解不出时 parsed 留 null，下面记 warn「JSON 解不出」并重试
          }
          // reasons === null：连 ok() 都没跑到（截断 / JSON 解不出），没有可回传的诊断
          const reasons = !truncated && parsed ? ok(parsed) : null;
          if (reasons && reasons.length === 0) {
            if (!detectRepetition(repetitionTextOf(parsed))) return { ok: true, value: { parsed, raw: content } };
            logger.warn(`[BriefBlockV6] ${tag}#${attempt + 1} 产出复读，丢弃重试`);
            attemptRejects?.push(`#${attempt + 1} repetition`);
            return { ok: false, reasons: [] };
          }
          if (reasons?.length) rejects?.push(`#${attempt + 1} ${reasons.join(' | ')}`);
          attemptRejects?.push(`#${attempt + 1} ${truncated ? 'finish_length' : reasons ? reasons.join(' | ') : 'json_parse'}`);
          logger.warn(`[BriefBlockV6] ${tag}#${attempt + 1} 失败：` +
              `${truncated ? 'finish_reason=length' : reasons ? `校验不过 ${reasons.join(' | ')}` : 'JSON 解不出'}`);
          return { ok: false, reasons: reasons ?? [] };
        },
        retryOnError: (err, attempt) => {
          logger.warn(`[BriefBlockV6] ${tag}#${attempt + 1} 失败：err=${err instanceof Error ? err.message : String(err)}`);
          attemptRejects?.push(`#${attempt + 1} error: ${err instanceof Error ? err.message : String(err)}`);
          return true;
        },
        backoffMs: attempt => BACKOFF_MS[attempt],
      });
      this.neurons += r.neurons;
      return { value: r.value.parsed, raw: r.value.raw, prompt: sent, attempts: r.attempts };
    } catch (e) {
      if (!(e instanceof LLMAttemptsExhausted)) throw e;
      this.neurons += e.neurons;
      // cause 留着：改写要分得出「三次都没过」（留上一版）与别的错
      throw new Error(`${tag}: all model attempts failed validation`, { cause: e });
    }
  }

  async generate(input: BriefBlockV6Input): Promise<BriefBlockV6Result> {
    // 时间升序、同期按 id 升序：窗口切分依赖这个顺序（原型 loadClusterFrom 就是这个序）
    const articles: V6Article[] = input.articles
      .map(a => ({
        id: a.id,
        title: a.title,
        publishDate: typeof a.publishDate === 'string' ? a.publishDate : '',
        sourceId: a.sourceId ?? null,
        sentences: splitSentences(a.content),
      }))
      .sort((a, b) => (a.publishDate < b.publishDate ? -1 : a.publishDate > b.publishDate ? 1 : a.id - b.id));

    const sentences: SentenceTable = {};
    for (const a of articles) sentences[String(a.id)] = a.sentences;

    const tier = normalizeTier(input.tier);
    const windows = makeWindows(articles);

    const batches = await pool(windows, CONCURRENCY, async w => {
      const allowed = new Set(w.articleIds);
      try {
        const { value: result } = await this.chatJson(
          `w${w.index + 1}`,
          getAnchorPrompt(w, windows.length),
          ANCHOR_SCHEMA as unknown as Record<string, unknown>,
          // 窗口步的失败是窗口级的（已有跳过机制），不做逐条诊断：anchorOk 保持 boolean
          x => (anchorOk(x, sentences, allowed) ? [] : ['bad_anchors']),
          // 复读检测读 topic 文本；用 ". " 拼接让 detectRepetition 的句级那条腿切得开
          x => (x.anchors as Array<{ topic: string }>).map(a => a.topic).join('. '),
          { model: ANCHOR_MODEL }
        );
        return (result.anchors as Array<{ topic: string; sources: V6Source[] }>).map((c, i) => ({
          ...c,
          id: `w${w.index + 1}a${i + 1}`,
        })) as V6Anchor[];
      } catch (e) {
        // 一个窗口丢了不该丢整簇：记账、跳过，其余窗口照跑
        this.windowFailures++;
        logger.warn(`[BriefBlockV6] 窗口 ${w.index + 1}/${windows.length} 三次尝试全失败，跳过：${e instanceof Error ? e.message : String(e)}`);
        return [] as V6Anchor[];
      }
    });

    const anchors = batches.flat();
    if (this.windowFailures >= windows.length) throw new Error(`all ${windows.length} window(s) failed`);
    if (!anchors.length) throw new Error('model marked no key points');

    // 补出处的材料池：每条重点引到的原句，代词开头的再带上它的前一句
    const citePool: V6Source[] = anchors.flatMap(a =>
      a.sources.flatMap(s => {
        const ctx = contextOf(sentences, s);
        return ctx ? [s, ctx] : [s];
      })
    );
    const cited = new Set(citePool.map(s => `${s.articleId}:${s.sentence}`));

    const write = await this.chatJson(
      'write',
      getWritePrompt(anchors, sentences, tier),
      getWriteSchema(tier) as unknown as Record<string, unknown>,
      x => writeOk(x, cited),
      sentencesText,
      {
        model: WRITER_MODEL,
        rejects: this.writeRejects,
        // no_sentences 的重试提示要报这次调用实际用的 tier 的句数（bug B5），
        // 不能用 REASON_HINTS 里 tier 无关的默认文案。
        hints: { no_sentences: noSentencesHint(tier) },
      }
    );
    const written = cleanWrite(write.value);

    let citationsRepaired = 0;
    let block: BriefBlockV6Result['block'] = null;
    let check: BriefBlockV6Check | undefined;
    if (written.verdict === 'written') {
      const r = repairCitations(written.sentences as V6Sentence[], citePool, sentences);
      const draft: Version = { title: String(written.title), sentences: r.sentences.map(s => ({ text: s.text, sources: s.sources })) };
      const loop = await this.checkLoop({
        draft,
        draftRepaired: r.added,
        // 写作的对话：通过的那次写作实际发出的 prompt（含重试诊断）→ 它的原文回复
        conversation: [
          { role: 'user', content: write.prompt },
          { role: 'assistant', content: write.raw },
        ],
        articles,
        table: sentences,
        citePool,
        cited,
        tier,
      });
      block = loop.block;
      citationsRepaired = loop.citationsRepaired;
      check = loop.check;
    }

    return {
      verdict: written.verdict,
      ...(written.verdict === 'not_a_single_event' ? { reason: String(written.reason) } : {}),
      block,
      trace: {
        windows: windows.length,
        anchors: anchors.length,
        citationsRepaired,
        windowFailures: this.windowFailures,
        writeRejects: this.writeRejects,
        llmCalls: this.llmCalls + this.checkCalls,
        neurons: this.neurons,
        ...(check ? { check } : {}),
      },
    };
  }

  /**
   * 写作–核查循环（ADR 0010；用词见 CONTEXT.md「写作–核查循环」）：草稿每句做逐句核查（× epoch 数），
   * 被标出就把意见发回写作的同一个对话、整块改写，只复核改过的句子，最多改两次。
   * 出什么问题都不让整块失败：核查出错 → 句子记成没核到、照发；发出去的永远是手上最好的一版。
   */
  private async checkLoop(o: {
    draft: Version;
    /** 草稿补出处补了几条（发草稿时就是 trace.citationsRepaired） */
    draftRepaired: number;
    conversation: ChatMessage[];
    articles: V6Article[];
    table: SentenceTable;
    /** 写作的材料池与可引集合（补出处、writeOk 用）；改写时再加上证据句 */
    citePool: V6Source[];
    cited: Set<string>;
    tier: V6Tier;
  }): Promise<{ block: Version; citationsRepaired: number; check: BriefBlockV6Check }> {
    const epochs = checkEpochsOf(this.env.BRIEF_CHECK_EPOCHS);
    const blockIdx = this.traceContext.callIndex ?? 0;
    if (epochs === 0) {
      const check: BriefBlockV6Check = {
        epochs: 0, outcome: 'off', revisions: 0, unchecked: [], stillFlagged: [], draft: null, rounds: [], calls: 0, neurons: 0, ms: 0,
      };
      this.logLoop(blockIdx, check, []);
      return { block: o.draft, citationsRepaired: o.draftRepaired, check };
    }

    const t0 = Date.now();
    const before = { calls: this.llmCalls + this.checkCalls, neurons: this.neurons };
    const cluster = clusterOf(o.articles);
    const date = briefDateOf(o.articles);
    const io: CheckCaller = {
      ai: this.ai,
      env: this.env,
      trace: this.traceContext,
      nextCallIndex: () => blockIdx * CHECK_CALL_INDEX_PER_STORY + this.checkCalls++,
    };

    // 一版的核查：文本没变的句子沿用上一轮的结论；其余每句跑 epochs 次独立核查，每块最多 10 个 agent 在飞
    const verify = async (v: Version, earlier: Map<string, CheckLog>): Promise<CheckLog[]> => {
      const logs = v.sentences.map((s, i): CheckLog => {
        const old = earlier.get(s.text);
        return old ? { ...old, index: i + 1, carried: true } : { index: i + 1, text: s.text, runs: [], carried: false };
      });
      const jobs = logs.filter(l => !l.carried).flatMap(l => Array.from({ length: epochs }, (_, run) => ({ l, run })));
      await pool(jobs, CHECKS_IN_FLIGHT, async ({ l, run }) => {
        const item = {
          title: v.title,
          sentences: v.sentences.map(x => x.text),
          index: l.index,
          text: l.text,
          cited: v.sentences[l.index - 1].sources.map(x => [x.articleId, x.sentence] as [number, number]),
        };
        let r: SentenceCheckRun;
        try {
          r = await sentenceCheck(io, cluster, item, date);
        } catch (e) {
          // 核查出错不让整块失败：这一次记成没有结论，原因进降级日志
          r = { verdict: null, calls: 0, neurons: 0, end: `error: ${e instanceof Error ? e.message : String(e)}` };
        }
        this.neurons += r.neurons;
        l.runs[run] = r;
      });
      return logs;
    };

    let current = o.draft;
    let repaired = o.draftRepaired;
    let logs = await verify(current, new Map());
    const rounds: CheckRound[] = [roundOf(0, logs)];
    let history = o.conversation;
    // 到目前为止发给写作的全部证据句（key，按出现先后），改写时都可以引
    const evidence: string[] = [];
    let revisions = 0;
    let outcome: BriefBlockV6CheckOutcome | null = logs.some(isFlagged) ? null : 'clean';
    for (let round = 1; !outcome && round <= MAX_REVISIONS; round++) {
      const f = findingsMessage(
        logs.filter(isFlagged).map(l => ({ index: l.index, text: l.text, verdicts: l.runs.map(r => r.verdict) })),
        cluster
      );
      for (const k of f.evidence) if (!evidence.includes(k)) evidence.push(k);
      const allowed = new Set([...o.cited, ...evidence]);
      const revisePool: V6Source[] = [
        ...o.citePool,
        ...evidence.filter(k => !o.cited.has(k)).map(k => {
          const [articleId, sentence] = k.split(':').map(Number);
          return { articleId, sentence };
        }),
      ];
      const rev = await this.revise(round, f.text, {
        history,
        allowed,
        citePool: revisePool,
        table: o.table,
        tier: o.tier,
        unchanged: new Set(current.sentences.map(s => s.text)),
      });
      rounds[rounds.length - 1].revise = { accepted: rev.accepted, attempts: rev.attempts, rejects: rev.rejects };
      if (!rev.accepted) {
        outcome = 'revise_failed';
        break;
      }
      revisions++;
      const w = cleanWrite(rev.value);
      const r = repairCitations(w.sentences as V6Sentence[], revisePool, o.table);
      current = { title: String(w.title ?? ''), sentences: r.sentences.map(s => ({ text: s.text, sources: s.sources })) };
      repaired = r.added;
      history = [...history, { role: 'user', content: rev.prompt }, { role: 'assistant', content: rev.raw }];
      // 只复核改过的句子（按原文逐字比）；没改的沿用上一轮的结论
      logs = await verify(current, new Map(logs.map(l => [l.text, l])));
      rounds.push(roundOf(round, logs));
      if (!logs.some(isFlagged)) outcome = 'fixed';
    }
    if (!outcome) outcome = 'still_flagged';

    const check: BriefBlockV6Check = {
      epochs,
      outcome,
      revisions,
      unchecked: logs.filter(isUnchecked).map(l => l.index),
      stillFlagged: logs.filter(isFlagged).map(l => l.index),
      draft: revisions > 0 ? o.draft : null,
      rounds,
      calls: this.llmCalls + this.checkCalls - before.calls,
      neurons: this.neurons - before.neurons,
      ms: Date.now() - t0,
    };
    this.logLoop(blockIdx, check, logs);
    return { block: current, citationsRepaired: repaired, check };
  }

  /**
   * 一次改写：意见接在写作的对话之后发回 v4-pro，整块重写（同一 schema、三次尝试、温度与退避同写作）。
   * 通过 = verdict 仍是 written + writeOk（可引的句子加上证据句）+ 不复读 + 数字检查（在材料池加证据句上
   * 补完出处之后，改过的句子里每个数字都在它引的原句里）。被拒的尝试只把诊断接在意见后面，从不回传被拒的原文。
   * 三次都不过不抛错：accepted=false，由循环留上一版。
   */
  private async revise(
    round: number,
    findings: string,
    o: {
      /** 写作的对话到目前为止的轮次 */
      history: ChatMessage[];
      /** 可引的句子：材料池加上到目前为止发过的证据句 */
      allowed: Set<string>;
      /** 补出处用的池：同上 */
      citePool: V6Source[];
      table: SentenceTable;
      tier: V6Tier;
      /** 上一版的句子原文：逐字没改的句子不过数字检查 */
      unchanged: ReadonlySet<string>;
    }
  ): Promise<
    | { accepted: true; value: any; raw: string; prompt: string; attempts: number; rejects: string[] }
    | { accepted: false; attempts: number; rejects: string[] }
  > {
    const rejects: string[] = [];
    // 数字检查按句给的提示（列出缺的数字）每次尝试后并进来，下一次的诊断按整条原因取
    const hints: Record<string, string> = { no_sentences: noSentencesHint(o.tier), ...REVISE_HINTS };
    const ok = (x: any): string[] => {
      if (x?.verdict !== 'written') return ['revise_not_written'];
      const bad = writeOk(x, o.allowed);
      if (bad.length) return bad;
      const repaired = repairCitations(cleanWrite(x).sentences as V6Sentence[], o.citePool, o.table).sentences;
      const numbers = numberCheck(repaired, o.table, o.unchanged);
      Object.assign(hints, numbers.hints);
      return numbers.reasons;
    };
    try {
      const r = await this.chatJson(`revise${round}`, findings, getWriteSchema(o.tier) as unknown as Record<string, unknown>, ok, sentencesText, {
        model: WRITER_MODEL,
        attemptRejects: rejects,
        hints,
        history: o.history,
      });
      return { accepted: true, ...r, rejects };
    } catch (e) {
      if (!(e instanceof Error && e.cause instanceof LLMAttemptsExhausted)) throw e;
      return { accepted: false, attempts: e.cause.attempts, rejects };
    }
  }

  /** 每块一行 info；每种降级一行 warn（块号、outcome、句号、原因），`wrangler tail` 里当场看得到。 */
  private logLoop(block: number, check: BriefBlockV6Check, logs: CheckLog[]): void {
    const { outcome, unchecked } = check;
    if (unchecked.length) {
      const why = [...new Set(logs.filter(isUnchecked).flatMap(l => l.runs.map(r => r.end ?? 'no verdict')))];
      logger.warn('[BriefBlockV6] 逐句核查降级：有句子没有结论，照发', { block, outcome, sentences: unchecked, reason: why.join(' | ') });
    }
    if (outcome === 'revise_failed') {
      const last = check.rounds[check.rounds.length - 1];
      logger.warn('[BriefBlockV6] 改写三次尝试全被拒，发上一版', {
        block, outcome, sentences: check.stillFlagged, reason: (last.revise?.rejects ?? []).join(' / '),
      });
    }
    if (outcome === 'still_flagged') {
      logger.warn('[BriefBlockV6] 改写两次后仍有句子被标出，发最后一版', {
        block, outcome, sentences: check.stillFlagged, reason: `still flagged after ${MAX_REVISIONS} revisions`,
      });
    }
    logger.info('[BriefBlockV6] 写作–核查循环', {
      block, flags: check.rounds.map(r => r.flagged.length), revisions: check.revisions, outcome, neurons: check.neurons, ms: check.ms,
    });
  }
}
