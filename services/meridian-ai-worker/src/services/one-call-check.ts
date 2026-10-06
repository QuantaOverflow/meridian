/**
 * 【一次调用核查】一句成稿 → 代码取证据 → DashScope 一次调用 → 与逐句 agent 同一形状的结论（ADR 0012）。
 *
 * 接线照原型 `.scratch/one-call-sentence-check/port-source/one-call.mts` 的 `sentenceCheckOneCall`：取证（utils/evidence-pack.ts）、
 * 提示词（prompts/oneCallCheck.ts）、读回复（utils/one-call-reply.ts）各是纯函数，这里只管调用、重试与回退。
 *
 *   · 一句一个 epoch 一次调用（phase `brief_block_v6_check_one_call`）。回复读不出（解不出结论、被 token 上限截断）
 *     最多试三次；还读不出，或通道报错（key 无效 / 内容审核拒绝 / 其他报错，通道里该重发的已重发过），这一句这一个 epoch
 *     改由 agent 核查（services/sentence-check.ts），每次回退记一条、打一行 warn。
 *   · 一块里第一次 key 无效之后，这一块余下的核查不再去 DashScope，直接走 agent。
 *   · 按意思搜的向量：整簇每一句在这一块第一次要用时算一次，之后各句、各 epoch、各轮改写共用；被核的那句与它的分句每次核查一批算。
 *     向量算不出来不算错：这一块之后只按词搜，记录里 meaningSearch = false。
 *
 * 状态都在实例上（一块一个实例，随请求结束）：不放模块级缓存。
 */
import type { BriefBlockV6CheckFallback, BriefBlockV6CheckFallbackReason } from '@meridian/contracts';
import { callLLM, neuronsOf } from './call-llm';
import { DashScopeError } from './dashscope';
import { embedTexts } from './embed-texts';
import { sentenceCheck, type CheckCaller, type SentenceCheckRun } from './sentence-check';
import type { ChatResponse } from '../types';
import type { EvidenceEmbeddings, SentenceKey } from '../types/one-call-check';
import { oneCallPrompts } from '../prompts/oneCallCheck';
import type { SentenceItem } from '../prompts/sentenceCheck';
import { buildEvidencePack, clausesOf } from '../utils/evidence-pack';
import { parseOneCallReply } from '../utils/one-call-reply';
import type { CheckCluster, Verdict } from '../utils/sentence-check';
import { Logger } from '../utils/logger';

const logger = new Logger({ component: 'brief-block-v6' });

/** 回复读不出时一共试几次（spec「The one-call Sentence check」）。 */
const TRIES = 3;
/** 回退记录里厂商报错 / 回复结尾留多少字符。 */
const MESSAGE_CHARS = 300;

/** usage.usd 是 DashScope 通道按价目表折的美元，类型里没有、运行时有（同 neuronsOf）。 */
const usdOf = (res: ChatResponse): number => Number((res.usage as { usd?: number } | undefined)?.usd ?? 0);

/** 一次核查的结果，外加结论是哪条路给的（回退到 agent 的算 agent）。 */
export interface OneCallRun extends SentenceCheckRun {
  path: 'oneCall' | 'agent';
}

type Failure = { reason: BriefBlockV6CheckFallbackReason; message: string };

export class OneCallChecker {
  /** 每次回退一条，按发生先后 */
  readonly fallbacks: BriefBlockV6CheckFallback[] = [];
  /** DashScope 花的美元（已折进各次结果的 neurons，这里是分项） */
  usd = 0;
  /** 这一块里最大的证据包有几句 */
  maxEvidence = 0;
  /** 整簇的向量：第一句核查起跑时就把 promise 存下，同时起跑的几句等的是同一次调用；null = 没算出来 */
  private clusterVectors: Promise<Map<SentenceKey, number[]> | null> | null = null;
  private meaningFailed = false;
  /** 第一次 key 无效的报错；非 null 之后不再去 DashScope */
  private authMessage: string | null = null;

  constructor(
    private io: CheckCaller,
    private cluster: CheckCluster,
    private date: string | null,
    private o: {
      /** 块号（日志用） */
      block: number;
      /** 一次调用与向量调用各自的 callIndex：每次调用取一个新的，R2 key 才不撞 */
      nextOneCallIndex: () => number;
      nextEmbedIndex: () => number;
    }
  ) {}

  /** 取证有没有一直用上按意思搜 */
  get meaningSearch(): boolean {
    return !this.meaningFailed;
  }

  private embed(texts: string[]): Promise<number[][] | null> {
    return embedTexts(this.io.ai, this.io.env, { ...this.io.trace, callIndex: this.o.nextEmbedIndex() }, texts).catch(e => {
      if (!this.meaningFailed) {
        logger.warn('[BriefBlockV6] 句子向量没算出来，这一块取证只按词搜', {
          block: this.o.block, error_message: e instanceof Error ? e.message : String(e),
        });
      }
      this.meaningFailed = true;
      return null;
    });
  }

  private async embeddingsFor(text: string): Promise<EvidenceEmbeddings | null> {
    if (this.meaningFailed) return null;
    // ??= 在第一个 await 之前：并发的核查不会各算一遍整簇
    this.clusterVectors ??= this.embed(this.cluster.sents.map(s => s.text)).then(
      v => v && new Map(this.cluster.sents.map((s, i) => [`${s.articleId}:${s.n}`, v[i]]))
    );
    const sentences = await this.clusterVectors;
    if (!sentences || this.meaningFailed) return null;
    const queries = [...new Set([text, ...clausesOf(text)])];
    const vectors = await this.embed(queries);
    return vectors && { sentences, queries: new Map(queries.map((q, i) => [q, vectors[i]])) };
  }

  /** DashScope 这条路：拿到结论，或为什么没拿到。 */
  private async oneCall(item: SentenceItem): Promise<{ verdict: Verdict | null; failure?: Failure; calls: number; neurons: number }> {
    if (this.authMessage !== null) return { verdict: null, failure: { reason: 'auth', message: this.authMessage }, calls: 0, neurons: 0 };
    const cited = item.cited.map(([a, n]) => `${a}:${n}`);
    const pack = buildEvidencePack(this.cluster, item.text, cited, await this.embeddingsFor(item.text));
    this.maxEvidence = Math.max(this.maxEvidence, pack.shown.length);
    const { system, user } = oneCallPrompts(item, this.cluster, this.date, pack);
    let calls = 0;
    let neurons = 0;
    let lastReply = '';
    for (let attempt = 0; attempt < TRIES; attempt++) {
      calls++;
      let res: ChatResponse;
      try {
        res = await callLLM(
          this.io.ai, this.io.env, this.io.trace, 'brief_block_v6_check_one_call',
          [{ role: 'system', content: system }, { role: 'user', content: user }],
          { callIndex: this.o.nextOneCallIndex() }
        );
      } catch (e) {
        // 通道报的错不在这里重试：该重发的通道已经重发过，其余的（key 无效、内容审核）重试也不会变
        const message = e instanceof Error ? e.message : String(e);
        const reason = e instanceof DashScopeError ? e.kind : 'provider_error';
        if (reason === 'auth') this.authMessage ??= message;
        return { verdict: null, failure: { reason, message }, calls, neurons };
      }
      neurons += neuronsOf(res);
      this.usd += usdOf(res);
      const choice = res.choices?.[0];
      const content = String(choice?.message?.content ?? '');
      // 截断的回复即使解得出 JSON 也不认：CHECKS 没写完。真的复读退化会一直写到 token 上限，也落在这里。
      // 不接写作那边的 detectRepetition：逐部分核对本来就反复抄同一句，它在实测回复上误拒约 7%。
      const verdict = choice?.finish_reason === 'length' ? null : parseOneCallReply(content, this.cluster);
      if (verdict) return { verdict, calls, neurons };
      lastReply = content;
    }
    return { verdict: null, failure: { reason: 'unreadable', message: lastReply.slice(-MESSAGE_CHARS) }, calls, neurons };
  }

  /**
   * 核一句（一个 epoch）。`round`：0 = 草稿，n = 第 n 次改写后的那一版（只进回退记录）。
   * 出错不抛：两条路都没有结论就是 verdict null，由调用方记成没核到。
   */
  async check(item: SentenceItem, round: number): Promise<OneCallRun> {
    let r: Awaited<ReturnType<OneCallChecker['oneCall']>>;
    try {
      r = await this.oneCall(item);
    } catch (e) {
      // 这条路上任何意外的错（取证、拼提示词……）都和通道报错一样处理：记一条回退、交给 agent，不让这一句悄悄没人核
      r = { verdict: null, failure: { reason: 'provider_error', message: e instanceof Error ? e.message : String(e) }, calls: 0, neurons: 0 };
    }
    if (r.verdict) return { verdict: r.verdict, calls: r.calls, neurons: r.neurons, path: 'oneCall' };
    const failure = r.failure!;
    const fallback: BriefBlockV6CheckFallback = { sentence: item.index, round, reason: failure.reason, message: failure.message.slice(0, MESSAGE_CHARS) };
    this.fallbacks.push(fallback);
    logger.warn('[BriefBlockV6] 一次调用核查没拿到可用回复，这一句改由 agent 核查', {
      block: this.o.block, sentence: fallback.sentence, round, reason: fallback.reason, error_message: fallback.message,
    });
    let agent: SentenceCheckRun;
    try {
      agent = await sentenceCheck(this.io, this.cluster, item, this.date);
    } catch (e) {
      // 与 agent 模式同一条规矩：核查出错不让整块失败，这一次记成没有结论（DashScope 那几次的花费照记）
      agent = { verdict: null, calls: 0, neurons: 0, end: `error: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { verdict: agent.verdict, calls: r.calls + agent.calls, neurons: r.neurons + agent.neurons, end: agent.end, path: 'agent' };
  }
}
