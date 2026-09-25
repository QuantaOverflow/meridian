/**
 * 【简报块 v6 · 编排】一个簇的原文 → 一块高管简报正文（逐句带出处）。
 *
 *   1 切句     每篇正文切句，1 起编号（utils/report-v3.ts 的 splitSentences）        代码
 *   2 切窗     30,000 字符预算、相邻窗口重叠 1 篇，覆盖不变量断言                    代码
 *   3 标重点   每个窗口一次调用，只标 topic + 原文句编号，不写散文（约束式解码）     LLM × 窗口数
 *   4 写作     全部重点 + 它们指向的原句 → 一块简报（tier=lead/more 走 3–5 句的 exec   LLM × 1
 *              档，tier=brief 走 1–2 句的短档）
 *   5 补出处   句中数字/引语不在所引原句里 → 在材料池里找字面包含它的原句补上        代码
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
import { AIGatewayService } from './ai-gateway';
import { callLLM } from './call-llm';
import type { TraceContext } from './llm-call-logger';
import type { ChatResponse, CloudflareEnv } from '../types';
import { splitSentences } from '../utils/report-v3';
import { detectRepetition } from '../utils/brief-writer-v3';
import { ANCHOR_SCHEMA, getAnchorPrompt, getWriteSchema, getWritePrompt } from '../prompts/briefBlockV6';
import {
  WINDOW_CHARS,
  anchorOk,
  cleanWrite,
  contextOf,
  makeWindows,
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

const MODEL = '@cf/zai-org/glm-4.7-flash';
/** 同时在飞的窗口调用数（原型 DIRECT_RAW_CONCURRENCY 默认值）。 */
const CONCURRENCY = 2;
/** 原型 chatJson 的重试策略：三次、温度依次这三个值、退避 3s → 8s。 */
const TEMPERATURES = [0.1, 0.3, 0.3];
const BACKOFF_MS = [3000, 8000];
/** callIndex 起点：与整篇标题（690）错开，免得同一 trace 下 R2 key 互相覆盖。 */
const CALL_INDEX_BASE = 600;
/**
 * 每块（story）占的 callIndex 槽位数。
 *
 * 一块一个 service 实例、`this.llmCalls` 从 0 起，所以只靠它算 callIndex 的话 24 个块全写
 * `brief_block_v6-600`，后写的覆盖先写的（2026-09-19 实测：storyIdx=17 的原始输出查不到）。
 * 用 backend 传进来的 story 序号乘上这个步长把块彼此隔开。
 *
 * 100 是够用的上界：一块最多 = 窗口数 × 3 次尝试 + 写作 3 次尝试，最大的簇也只有 3 个窗口。
 * 日志 key 里带 phase 段（`brief_block_v6`），与 brief_generation 的标题(690)
 * 天然分开，所以这里只需要块间唯一，基数取多少都不会跨 phase 撞车。
 */
const CALL_INDEX_PER_STORY = 100;

interface BriefBlockV6ArticleInput {
  id: number;
  title: string;
  content: string;
  publishDate?: string;
  sourceId?: number | null;
}

export interface BriefBlockV6Input {
  articles: BriefBlockV6ArticleInput[];
  /**
   * 篇幅档。`lead` / `more` / 不传 = 现有 exec 档（3–5 句），`brief` = 1–2 句短档。
   * 非法值按不传处理（篇幅是写作风格，不是正确性约束，不值得 400）。
   */
  tier?: V6Tier | string;
}

interface BriefBlockV6Trace {
  articles: number;
  windows: number;
  anchors: number;
  citationsRepaired: number;
  /** 三次尝试全失败、被跳过的窗口数。>0 意味着这块的材料不完整。 */
  windowFailures: number;
  repetitionRetries: number;
  /**
   * 写作步每次被确定性校验拒收的原因（`#尝试次 原因码…`）。空数组 = 一次过。
   * 不记的话「一次过」和「第三次才过」在观测里分不开。
   */
  writeRejects: string[];
  llmCalls: number;
  /** 全部 LLM 调用的 neurons 合计（成本验收读它）。 */
  neurons: number;
  model: string;
  windowChars: number;
  /** 这一块实际用的篇幅档。不记的话观测里分不出「写短了」是档位生效还是模型偷懒。 */
  tier: V6Tier;
}

export interface BriefBlockV6Result {
  verdict: 'written' | 'not_a_single_event';
  reason?: string;
  block: null | { title: string; sentences: V6Sentence[] };
  trace: BriefBlockV6Trace;
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
  private ai: AIGatewayService;
  private llmCalls = 0;
  private neurons = 0;
  private repetitionRetries = 0;
  private windowFailures = 0;
  private writeRejects: string[] = [];
  constructor(private env: CloudflareEnv, private traceContext: TraceContext = {}) {
    this.ai = new AIGatewayService(env);
  }

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
    rejects?: string[]
  ): Promise<any> {
    let lastReasons: string[] = [];
    for (let attempt = 0; attempt < TEMPERATURES.length; attempt++) {
      // 块间唯一：见 CALL_INDEX_PER_STORY。traceContext.callIndex 是 backend 传的 story 序号。
      const storyIdx = this.traceContext.callIndex ?? 0;
      const callIndex = CALL_INDEX_BASE + storyIdx * CALL_INDEX_PER_STORY + this.llmCalls;
      const attemptPrompt = lastReasons.length ? `${prompt}\n\n${retryInstruction(lastReasons)}` : prompt;
      this.llmCalls++;
      let content = '';
      let truncated = false;
      let err: unknown = null;
      try {
        const res = await callLLM(this.ai, this.env, this.traceContext, 'brief_block_v6', [{ role: 'user', content: attemptPrompt }], {
          model: MODEL,
          temperature: TEMPERATURES[attempt],
          callIndex,
          responseFormat: { type: 'json_schema' as const, json_schema: schema },
        });
        // usage.neurons 是 Workers AI 的计费单位，类型里没有（各 provider 的 usage 字段不同），运行时有
        this.neurons += Number((res.usage as { neurons?: number } | undefined)?.neurons ?? 0);
        const choice = (res as ChatResponse).choices?.[0];
        content = String(choice?.message?.content ?? '');
        truncated = choice?.finish_reason === 'length';
      } catch (e) {
        err = e;
      }
      let parsed: any = null;
      try {
        parsed = JSON.parse(content);
      } catch {
        /* retry */
      }
      // reasons === null：连 ok() 都没跑到（调用抛了 / 截断 / JSON 解不出），没有可回传的诊断
      const reasons = !err && !truncated && parsed ? ok(parsed) : null;
      lastReasons = reasons ?? [];
      if (reasons && reasons.length === 0) {
        if (!detectRepetition(repetitionTextOf(parsed))) return parsed;
        this.repetitionRetries++;
        console.warn(`[BriefBlockV6] ${tag}#${attempt + 1} 产出复读，丢弃重试`);
      } else {
        if (reasons?.length) rejects?.push(`#${attempt + 1} ${reasons.join(' | ')}`);
        console.warn(
          `[BriefBlockV6] ${tag}#${attempt + 1} 失败：` +
            `${err ? `err=${err instanceof Error ? err.message : String(err)}` : truncated ? 'finish_reason=length' : reasons ? `校验不过 ${reasons.join(' | ')}` : 'JSON 解不出'}`
        );
      }
      if (attempt < BACKOFF_MS.length) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
    }
    throw new Error(`${tag}: all model attempts failed validation`);
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
        const result = await this.chatJson(
          `w${w.index + 1}`,
          getAnchorPrompt(w, windows.length),
          ANCHOR_SCHEMA as unknown as Record<string, unknown>,
          // 窗口步的失败是窗口级的（已有跳过机制），不做逐条诊断：anchorOk 保持 boolean
          x => (anchorOk(x, sentences, allowed) ? [] : ['bad_anchors']),
          // 复读检测读 topic 文本；用 ". " 拼接让 detectRepetition 的句级那条腿切得开
          x => (x.anchors as Array<{ topic: string }>).map(a => a.topic).join('. ')
        );
        return (result.anchors as Array<{ topic: string; sources: V6Source[] }>).map((c, i) => ({
          ...c,
          id: `w${w.index + 1}a${i + 1}`,
        })) as V6Anchor[];
      } catch (e) {
        // 一个窗口丢了不该丢整簇：记账、跳过，其余窗口照跑
        this.windowFailures++;
        console.warn(`[BriefBlockV6] 窗口 ${w.index + 1}/${windows.length} 三次尝试全失败，跳过：${e instanceof Error ? e.message : String(e)}`);
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

    const written = cleanWrite(
      await this.chatJson(
        'write',
        getWritePrompt(anchors, sentences, tier),
        getWriteSchema(tier) as unknown as Record<string, unknown>,
        x => writeOk(x, cited),
        x => (Array.isArray(x.sentences) ? (x.sentences as Array<{ text: string }>).map(s => String(s?.text ?? '')).join(' ') : ''),
        this.writeRejects
      )
    );

    let citationsRepaired = 0;
    let block: BriefBlockV6Result['block'] = null;
    if (written.verdict === 'written') {
      const r = repairCitations(written.sentences as V6Sentence[], citePool, sentences);
      citationsRepaired = r.added;
      block = { title: String(written.title), sentences: r.sentences.map(s => ({ text: s.text, sources: s.sources })) };
    }

    return {
      verdict: written.verdict,
      ...(written.verdict === 'not_a_single_event' ? { reason: String(written.reason) } : {}),
      block,
      trace: {
        articles: articles.length,
        windows: windows.length,
        anchors: anchors.length,
        citationsRepaired,
        windowFailures: this.windowFailures,
        repetitionRetries: this.repetitionRetries,
        writeRejects: this.writeRejects,
        llmCalls: this.llmCalls,
        neurons: this.neurons,
        model: MODEL,
        windowChars: WINDOW_CHARS,
        tier,
      },
    };
  }
}
