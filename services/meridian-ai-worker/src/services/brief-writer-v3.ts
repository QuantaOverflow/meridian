/**
 * 【写作层 v3 · 编排】一个簇的 report-v3 → 简报里的一块正文（apps/backend/prototypes/brief-writer-v3/GOAL.md，Goal 2）。
 *
 *   1 要点   骨架事实（≥2 篇）按最早完整发布时间排                                  代码
 *   2 原话   原句里带引号、有具名说话人的直接引语                                   代码
 *   3 渲染   要点 + 其余细节 + 人物（名字 + 身份）+ 原话 + 分歧；不给概述、不给 stance  代码
 *   3.5 关系 全部事实 + 出处 → 原文明说的先后/因果/更新/冲突/将来，每条带出处（Goal 3）  LLM + 代码校验
 *   4 写     照关系表写；一次调用；产出过复读检测，不过重试 1 次（强制 skipCache），仍不过 = 块失败  LLM
 *   5 接地   名字/数字不在材料里、引号里不逐字 → 点名修 1 次 → 仍不干净删含它的整句 / 去引号   LLM + 代码
 *   6 长度   只在超过硬上限时删尾句；brief 多于一句取首句、仍超长在分句边界截断         代码
 *
 * 头条/要闻通常 1–2 次调用（接地修正才有第 2 次），简讯 1 次。Goal 1 的声明判断、补漏 loop、
 * 长度重写已去掉：前两者把现成句子和边角材料带进正文，长度重写实测原样返回。
 * Goal 2 一度加过「措辞修正」（躲概述/stance 片段重合），Goal 2.1 删掉：它按词面挑参照事实，把 c13 简讯换成了另一件事。
 *
 * 纯函数在 utils/brief-writer-v3.ts，prompt 在 prompts/briefWriterV3.ts。
 * 旧写作链（BriefGenerationService.writeBriefBlock）不动；backend workflow 暂不接线。
 */
import { AIGatewayService } from './ai-gateway';
import { callLLM } from './call-llm';
import type { TraceContext } from './llm-call-logger';
import type { CloudflareEnv, ChatResponse } from '../types';
import {
  cleanProse,
  detectRepetition,
  dropSentencesWith,
  dropUnfinishedTail,
  extractQuotes,
  localUngroundedTerms,
  numberedPoints,
  planPoints,
  proseSentences,
  renderEarlierTimes,
  renderFactsForRelations,
  renderRelationsForWriter,
  renderReportForWriter,
  renderReportForWriterOneSource,
  sharedSurnames,
  trimToLength,
  TIER_MAX,
  ungroundedTerms,
  unquote,
  unverifiableQuotes,
  validateRelations,
  type Relation,
  type ReportV3,
  type Tier,
} from '../utils/brief-writer-v3';
import { markBlock, type MarkStats, type SentenceMark } from '../utils/fact-marks';
import { getGroundingFixPrompt, getOneSourceWritePrompt, getRelationsPrompt, getWritePrompt } from '../prompts/briefWriterV3';
import { parseLooseJSON } from './brief-skeleton';
import { annotate, traced } from './observe';

export interface WriterV3Trace {
  /** 交给写作的要点条数、原话条数 */
  points: number;
  quotes: number;
  /** 关系表条数（校验后）；这一步两次都没产出可用关系表时 relationsError 写原因，不用 0 冒充「没有关系」 */
  relations: number;
  relationsError?: string;
  /** 接地守卫：查出的材料外名字/数字、不逐字的引语；修正后还剩哪些、怎么处理的 */
  groundingFixes: Array<{
    kind: 'terms' | 'quotes'; terms: string[]; left: string[];
    how: 'rewrite' | 'drop_sentence' | 'unquote' | 'failed';
  }>;
  /** 长度兜底：只在超硬上限（或 brief 多于一句）时发生 */
  lengthFixes: Array<{ from: number; to: number; how: 'trim' | 'first_sentence' | 'failed' }>;
  repetitionRetries: number;
  llmCalls: number;
  /** 本块全部 LLM 调用的 neurons 合计（成本验收读它；workflow 里没有 inline 观测，只能靠这个字段）。 */
  neurons: number;
  /** 代码检查器读数：查了几句、弃权几句、标了几句（标记本身在返回值的 marks 里，不进正文）。 */
  marks: MarkStats;
  /** variant: 'one-source' 时才有：产出的句-要点分组条数、局部接地检查删掉的句子（每句只许用它分到的 1–2 个要点） */
  sentenceGroups?: number;
  localFixes?: Array<{ points: number[]; terms: string[]; how: 'drop_sentence' }>;
}

const MODEL = '@cf/zai-org/glm-4.7-flash';
/** 本仓复读已发作四次；glm-4.7-flash 的每次调用都带（memory repetition-guard-always-on）。 */
const FREQUENCY_PENALTY = 0.4;
/** 输出 token 上限：成稿最多 2,400 字符 ≈ 600 token，给余量；再多只会让复读烧更久。 */
const WRITE_MAX_TOKENS: Record<Tier, number> = { lead: 1600, more: 900, brief: 300 };
/** one-source 变体：产出是带 "points"/"text" 字段的 JSON，比纯散文多括号/引号/编号开销。 */
const ONE_SOURCE_TOKEN_MULTIPLIER = 1.4;
/** 关系表输出上限：几十条短句的 JSON；再多只会让复读烧更久。 */
const RELATIONS_MAX_TOKENS = 3000;
/**
 * dev-only：模型 spike 用。gpt-oss-120b 不在 config/thinking.ts 的 THINKING_OFF_MODELS 名单里
 * （没有 enable_thinking 开关可关），思维链默认开且计入 max_tokens——2026-09-11 实测关系表
 * 3000 token 预算下思维链烧到 14,437 字符仍未写完，content 恒为空、直接抛错。给这类模型的
 * 预算按倍数放大，仅在 model 覆盖成这些前缀时生效，默认（glm-4.7-flash）不受影响。
 */
const SPIKE_TOKEN_MULTIPLIER: Array<[string, number]> = [['@cf/openai/gpt-oss-', 5]];
function spikeMultiplier(model: string): number {
  return SPIKE_TOKEN_MULTIPLIER.find(([prefix]) => model.startsWith(prefix))?.[1] ?? 1;
}
/** callIndex 起点，和旧写作链的 CALL_INDEX 错开，避免同一 trace 下 R2 key 互相覆盖。 */
const CALL_INDEX_BASE = 700;

export class BriefWriterV3Service {
  private ai: AIGatewayService;
  private llmCalls = 0;
  private neurons = 0;
  private repetitionRetries = 0;
  /** dev-only：/meridian/write-block-v3 的 `model` 请求体字段透传到这里，供模型 spike 用；不传就是原行为。 */
  private readonly model: string;

  constructor(private env: CloudflareEnv, private traceContext: TraceContext = {}, modelOverride?: string) {
    this.ai = new AIGatewayService(env);
    this.model = modelOverride || MODEL;
  }

  private async chat(prompt: string, o: { temperature: number; maxTokens: number; skipCache: boolean }) {
    const callIndex = CALL_INDEX_BASE + this.llmCalls;
    this.llmCalls++;
    const res = await callLLM(this.ai, this.env, this.traceContext, 'brief_generation', [{ role: 'user', content: prompt }], {
      provider: 'workers-ai',
      model: this.model,
      temperature: o.temperature,
      maxTokens: o.maxTokens,
      skipCache: o.skipCache,
      frequencyPenalty: FREQUENCY_PENALTY,
      callIndex,
    });
    if (res.capability !== 'chat') throw new Error(`unexpected response capability ${res.capability}`);
    // usage.neurons 是 Workers AI 的计费单位，类型里没有（各 provider 的 usage 字段不同），运行时有
    this.neurons += Number((res.usage as { neurons?: number } | undefined)?.neurons ?? 0);
    const choice = (res as ChatResponse).choices?.[0];
    return { content: String(choice?.message?.content ?? ''), truncated: choice?.finish_reason === 'length' };
  }

  /**
   * 一次散文产出 + 复读守卫。复读或剥完为空 → 重试 1 次（重试强制 skipCache，否则 Gateway 缓存
   * 会原样还回同一份复读稿）；仍不过返回 null。
   */
  private async prose(prompt: string, tier: Tier, skipCache: boolean, temperature = 0.5): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content, truncated } = await this.chat(prompt, {
        temperature, maxTokens: WRITE_MAX_TOKENS[tier] * spikeMultiplier(this.model), skipCache: skipCache || attempt > 0,
      });
      const repeated = detectRepetition(content);
      let text = cleanProse(content, tier);
      if (truncated) text = dropUnfinishedTail(text);
      if (!repeated && text) return text;
      console.warn(`[WriterV3] ${tier} 产出${repeated ? '复读' : '为空'}（${content.length} 字符，attempt ${attempt}）`);
      if (attempt === 0) this.repetitionRetries++;
    }
    return null;
  }

  /**
   * one-source 变体：规划（哪句用哪 1–2 个要点）与写（照分组写）合一次调用，产出 JSON
   * `{paragraphs: [[{points, text}]]}`。复读 / JSON 解不出 / 段落为空 → 重试 1 次（强制 skipCache）。
   * 每句写完后做局部接地检查（语料只是它自己的要点 + 出处句，不是全篇材料）——查到材料外的词就整句丢，
   * 不做修正调用（GOAL：这条 spike 选「丢」，不选「点名再改一次」）。删到一段没有句子就丢掉这段；
   * 全部段都空 → 当这次尝试失败重试；两次都空返回 null（块失败，与默认路径一致）。
   */
  private async writeOneSource(
    report: ReportV3, tier: Tier, relList: Relation[], skipCache: boolean
  ): Promise<{ text: string; groups: number; localFixes: WriterV3Trace['localFixes'] } | null> {
    const points = numberedPoints(report, relList);
    const material = renderReportForWriterOneSource(report, points);
    const prompt = getOneSourceWritePrompt(material, tier, renderRelationsForWriter(relList), sharedSurnames(report));
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content } = await this.chat(prompt, {
        temperature: 0.5,
        maxTokens: Math.round(WRITE_MAX_TOKENS[tier] * ONE_SOURCE_TOKEN_MULTIPLIER * spikeMultiplier(this.model)),
        skipCache: skipCache || attempt > 0,
      });
      if (detectRepetition(content)) {
        console.warn(`[WriterV3] one-source ${tier} 产出复读（${content.length} 字符，attempt ${attempt}）`);
        if (attempt === 0) this.repetitionRetries++;
        continue;
      }
      let parsed: unknown;
      try { parsed = parseLooseJSON(content); } catch { parsed = null; }
      const paragraphs = (parsed as { paragraphs?: unknown })?.paragraphs;
      if (!Array.isArray(paragraphs) || !paragraphs.length) {
        console.warn(`[WriterV3] one-source ${tier} JSON 解不出 paragraphs（attempt ${attempt}）：${content.slice(0, 200)}`);
        if (attempt === 0) this.repetitionRetries++;
        continue;
      }
      const localFixes: WriterV3Trace['localFixes'] = [];
      let groups = 0;
      const outParas: string[] = [];
      for (const para of paragraphs) {
        if (!Array.isArray(para)) continue;
        const sentTexts: string[] = [];
        for (const sent of para) {
          const text = String((sent as { text?: unknown })?.text ?? '').trim();
          if (!text) continue;
          const rawIds = (sent as { points?: unknown })?.points;
          const ids = (Array.isArray(rawIds) ? rawIds : []).map(x => Number(x)).filter(n => Number.isInteger(n)).slice(0, 2);
          groups++;
          const terms = ids.length ? localUngroundedTerms(report, points, ids, text) : ungroundedTerms(report, text);
          if (terms.length) {
            localFixes.push({ points: ids, terms, how: 'drop_sentence' });
            continue;
          }
          sentTexts.push(text);
        }
        const paraText = sentTexts.join(' ').trim();
        if (paraText) outParas.push(paraText);
      }
      const text = (tier === 'lead' ? outParas.join('\n\n') : outParas.join(' ')).trim();
      if (!text) {
        console.warn(`[WriterV3] one-source ${tier} 局部接地删完后没有正文（attempt ${attempt}）`);
        if (attempt === 0) this.repetitionRetries++;
        continue;
      }
      return { text, groups, localFixes };
    }
    return null;
  }

  /**
   * 接地守卫：正文里有材料中没出现过的名字/数字 → 点名修一次；修完仍有的，删含它的整句。
   * 删到一句不剩就抛（块失败），不许 200 带空正文。
   */
  private async ground(
    text: string, tier: Tier, report: ReportV3, material: string, skipCache: boolean, log: WriterV3Trace['groundingFixes']
  ): Promise<string> {
    const terms = ungroundedTerms(report, text);
    const quotes = unverifiableQuotes(report, text);
    if (!terms.length && !quotes.length) return text;
    const fixed = await this.prose(getGroundingFixPrompt(text, terms, quotes, material), tier, skipCache, 0);
    // 修正稿明显变短 = 模型只回了被点名的部分（措辞修正实测塌过），不用
    let base = fixed && fixed.length >= text.length * 0.7 ? fixed : text;
    // 引语：修完仍不逐字就去掉引号改转述（一个字不改，不会引入新内容）
    if (quotes.length) {
      const leftQ = unverifiableQuotes(report, base);
      if (leftQ.length) base = unquote(base, leftQ);
      log.push({ kind: 'quotes', terms: quotes, left: leftQ, how: leftQ.length ? 'unquote' : 'rewrite' });
      if (!terms.length) return base;
    }
    const left = ungroundedTerms(report, base);
    if (!left.length) {
      log.push({ kind: 'terms', terms, left, how: 'rewrite' });
      return base;
    }
    const dropped = dropSentencesWith(base, left);
    if (!dropped) throw new Error(`接地：删掉含材料外词（${left.join(', ')}）的句子后没有正文 → 块失败`);
    log.push({ kind: 'terms', terms, left, how: 'drop_sentence' });
    return dropped;
  }

  /**
   * 事件关系表：一次调用；复读 / 解析不出 / 截断 → 重试 1 次（强制 skipCache）。
   * 两次都不成就不带关系表写（不为它让块失败），原因记进 relationsError。
   */
  private async relations(report: ReportV3, skipCache: boolean): Promise<{ list: Relation[]; error?: string }> {
    const prompt = getRelationsPrompt(renderFactsForRelations(report), renderEarlierTimes(report));
    let error = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content, truncated } = await this.chat(prompt, {
        temperature: 0.2, maxTokens: RELATIONS_MAX_TOKENS * spikeMultiplier(this.model), skipCache: skipCache || attempt > 0,
      });
      if (detectRepetition(content)) {
        if (attempt === 0) this.repetitionRetries++;
        error = `repetition (${content.length} chars)`;
        continue;
      }
      try {
        return { list: validateRelations(parseLooseJSON(content), report) };
      } catch (e) {
        error = `${truncated ? 'truncated; ' : ''}${e instanceof Error ? e.message : String(e)}`;
      }
    }
    console.warn(`[WriterV3] 关系表两次都没产出可用结果：${error}`);
    return { list: [], error };
  }

  /** 长度兜底（纯代码，不重写）：brief 多于一句取首句；超硬上限才删尾句 / 在分句边界截断。 */
  private fitLength(text: string, tier: Tier, log: WriterV3Trace['lengthFixes']): string {
    let cur = text;
    if (tier === 'brief') {
      const ss = proseSentences(cur);
      if (ss.length > 1) {
        log.push({ from: cur.length, to: ss[0].length, how: 'first_sentence' });
        cur = ss[0];
      }
    }
    if (cur.length > TIER_MAX[tier]) {
      const trimmed = trimToLength(tier, cur);
      log.push({ from: cur.length, to: trimmed?.length ?? cur.length, how: trimmed ? 'trim' : 'failed' });
      if (trimmed) cur = trimmed;
    }
    return cur;
  }

  /**
   * @param variant  'one-source'：spike，限每句正文最多用 1–2 个编号要点（GOAL「限融合」）。
   *                 不传 = 默认行为不变（apps/backend/prototypes/brief-writer-v3/verify.ts 走的仍是这条）。
   */
  async write(report: ReportV3, tier: Tier, skipCache: boolean, variant?: 'one-source'): Promise<{ text: string; marks: SentenceMark[]; trace: WriterV3Trace }> {
    // 每一步用 traced() 包一行：请求带 x-observe: inline 时，步骤树 + 其中的 LLM 调用随响应带回（observe.ts）
    // 1–3：要点、原话、渲染（纯代码）。条数进 trace，渲染内部用同一套函数
    const points = await traced('plan_points', async () => {
      const p = planPoints(report);
      annotate({ points: p.length });
      return p.length;
    });
    const quotes = await traced('extract_quotes', async () => {
      const q = extractQuotes(report);
      annotate({ quotes: q.length });
      return q.length;
    });
    const material = await traced('render', async () => {
      const m = renderReportForWriter(report);
      annotate({ chars: m.length, material: m });
      return m;
    });

    // 4：事件关系表（一次调用）——只记原文明说的先后、因果/回应、数字更新、说法冲突、将来的事
    const rel = await traced('relations', async () => {
      const r = await this.relations(report, skipCache);
      annotate({ relations: r.list.length, table: r.list, error: r.error });
      return r;
    });

    // 5：写（一次调用 + 复读重试），照关系表写。variant='one-source' 时步骤名不变（写作层的
    // 规划 + 写合成这一次调用），只是产出走 JSON + 局部接地检查，不走整段散文的 prose() 守卫
    let sentenceGroups: number | undefined;
    let localFixes: WriterV3Trace['localFixes'] | undefined;
    const written = await traced('write', async () => {
      if (variant === 'one-source') {
        const w = await this.writeOneSource(report, tier, rel.list, skipCache);
        sentenceGroups = w?.groups;
        localFixes = w?.localFixes;
        annotate({ chars: w?.text.length ?? 0, text: w?.text, groups: w?.groups, localFixes: w?.localFixes });
        return w?.text ?? null;
      }
      // 默认路径：写作看的材料带上 [update]（挂在被更新的事实旁边）；接地修正仍用不带关系表的 material
      const w = await this.prose(getWritePrompt(renderReportForWriter(report, rel.list), tier, renderRelationsForWriter(rel.list), sharedSurnames(report)), tier, skipCache);
      annotate({ chars: w?.length ?? 0, text: w });
      return w;
    }, { tier, ...(variant ? { variant } : {}) });
    if (!written) throw new Error('写作两次都没过复读守卫/为空 → 块失败');

    // 5：接地
    const groundingFixes: WriterV3Trace['groundingFixes'] = [];
    const grounded = await traced('ground', async () => {
      const g = await this.ground(written, tier, report, material, skipCache, groundingFixes);
      annotate({ fixes: groundingFixes, changed: g !== written });
      return g;
    });

    // 6：长度
    const lengthFixes: WriterV3Trace['lengthFixes'] = [];
    const text = await traced('fit_length', async () => {
      const t = this.fitLength(grounded, tier, lengthFixes);
      annotate({ fixes: lengthFixes, from: grounded.length, to: t.length });
      return t;
    });

    // 7：代码检查器（零调用）。逐句对齐到事实，只在它的出处窗口里查数字/专名/说话人/因果线索。
    // **只标记**：精度约 47%，自动改稿那条路（RARR）已证伪；标记进内部观测与管理页，不给读者看。
    const checked = await traced('check', async () => {
      const r = markBlock(report.facts, report.sentences, proseSentences(text));
      annotate({ ...r.stats, marks: r.marks });
      return r;
    });

    return {
      text,
      marks: checked.marks,
      trace: {
        points, quotes, relations: rel.list.length, ...(rel.error && !rel.list.length ? { relationsError: rel.error } : {}),
        groundingFixes, lengthFixes, repetitionRetries: this.repetitionRetries, llmCalls: this.llmCalls,
        neurons: this.neurons, marks: checked.stats,
        ...(variant === 'one-source' ? { sentenceGroups, localFixes } : {}),
      },
    };
  }
}
