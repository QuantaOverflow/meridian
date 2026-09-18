/**
 * 【报告层 v3 · 编排】一个簇的原文 → report-v3（带出处的事实、当事方、分歧、全部原句）。
 *
 *   1 切句     每篇正文切句，1 起编号；引用 [#id sK] 靠它解析                      代码
 *   2 抽取     每批 ≤20 句，只抽对故事重要的带出处事实（约束式解码 JSON）           LLM × 批数
 *   3 向量     事实文本过 bge-m3，供去重找候选                                     embedding
 *   4 去重     候选（近邻 + 内容词 + 实体约束）→ 贪心小组 → LLM 判同一事实 →
 *              第二轮跨组 → ≥6 条的大组复核                                        LLM × 若干
 *   5 各方     一次调用出概述 / 当事方 / 分歧                                      LLM × 1
 *   6 组装     单元 → 事实（篇数、骨架、代表句、variants、数字冲突）               代码
 *
 * 一个 14–16 篇的簇约 50–80 次调用、一分钟上下。纯函数在 utils/report-v3.ts，prompt 在
 * prompts/reportV3.ts，配方与证伪清单见 docs/adr/0004-brief-writer-v3.md。
 *
 * 写作层（BriefWriterV3Service）直接吃这里的产出；旧的 intelligence 报告链路不动。
 */
import { AIGatewayService } from './ai-gateway';
import { callLLM } from './call-llm';
import type { TraceContext } from './llm-call-logger';
import type { CloudflareEnv, ChatResponse, EmbeddingResponse } from '../types';
import { annotate, traced } from './observe';
import { CITE_SCHEMA, PARTITION_INTRO, PARTITION_SCHEMA, getCitePrompt, getPartitionPrompt, getVoicesPrompt } from '../prompts/reportV3';
import {
  buildCandidates,
  buildFacts,
  checkFact,
  cleanField,
  contentTokens,
  greedyGroups,
  normalizedEntities,
  packBatches,
  parseCite,
  parsePartition,
  parseVoices,
  preMergeIdentical,
  renderArticlesForVoices,
  repetitionOfTexts,
  splitSentences,
  type DedupFeat,
  type DedupParams,
  type RawFact,
  type ReportArticleInput,
  type ReportV3Doc,
  type Unit,
} from '../utils/report-v3';

const EMB_MODEL = '@cf/baai/bge-m3';
/** 抽取的批大小（句）。原型 BUDGET=20。 */
const SENTENCE_BUDGET = 20;
/**
 * 同时在飞的 LLM 调用数。fan-out 留在这一层是因为一个簇的批次彼此独立，且 backend 一簇一个 step。
 * 3 而不是 4：backend 侧 4 个簇并行 × 这里 3 = 12 路，2026-09-12 的整链跑在 6×4=24 路时
 * Workers AI 开始回 `3046: Request timeout`（不是我们超时，是它拒绝）。
 */
const CONCURRENCY = 3;
/**
 * 传输层失败（超时 / 连接断 / 容量不足）重试几次，退避是 4s → 8s → 16s → 32s。
 * 2026-09-13 实测：Workers AI 对 glm-4.7-flash 回了约 8 分钟的
 * `3040: Capacity temporarily exceeded`，原来的「2 次、4/8 秒」全程扛不住，四个簇里三个整份作废。
 * 加深到 4 次（最坏多等 60 秒）覆盖分钟级的容量事件；健康时一次都不会触发，成本为零。
 */
const TRANSPORT_RETRIES = 4;
const TRANSPORT_BACKOFF_MS = 4000;
/**
 * 去重参数（原型 dedup-v2 的配方）。
 *
 * **已证伪：收紧候选省不下钱**。2026-09-13 试过 top-5 / cos 0.75，四簇实测——
 * neurons 2,340 → 2,202（只降 6%），而骨架事实 66 → 57（掉 14%，c13 从 22 掉到 15），
 * 且 c3 出现两条逐字相同、分属两篇文章却没并起来的事实（本该是一条 ≥2 篇的骨架）。
 * 拿写作层的要点换 6% 成本，不划算，已回退。省调用改走 preMergeIdentical（逐字相同的先并，不问模型）。
 * 注意：已知事实召回看不出漏合并（它只问「这条事实在不在」），**骨架数才是那个读数**。
 */
const DEDUP: DedupParams = { topK: 8, cosMin: 0.7, overlapMin: 0.5, groupCap: 8 };
const BIG_GROUP_MIN = 6;
/** 一次 embedding 调用里塞多少条事实 */
const EMB_BATCH = 50;
const EXTRACT_MAX_TOKENS = 16384;
const PARTITION_MAX_TOKENS = 4096;
const VOICES_MAX_TOKENS = 16384;
/** callIndex 起点：与写作层（700）、旧链路错开，免得同一 trace 下 R2 key 互相覆盖。 */
const CALL_INDEX_BASE = 900;

export interface ReportV3Trace {
  articles: number;
  sentences: number;
  batches: number;
  /** 抽取出来的原始事实条数 → 去重后的单元数 → 其中骨架（≥2 篇）条数 */
  factsRaw: number;
  facts: number;
  skeleton: number;
  parties: number;
  conflicts: number;
  /** 抽取的问题读数：解不出的、JSON 报错的批、越界引用、没有有效出处、数字/名字对不上原句的条数 */
  extraction: {
    failedBatches: number;
    unparsed: number;
    jsonErrors: number;
    invalidCites: number;
    noValidCite: number;
    numbersMissing: number;
    namesMissing: number;
  };
  dedupCalls: number;
  embeddingCalls: number;
  voicesAttempts: number;
  /** 三次都没拿到当事方/分歧时的原因。有值 = 这份报告缺这一节（事实与原句照常有）。 */
  voicesError?: string;
  repetitionRetries: number;
  llmCalls: number;
  /** 全部 LLM 调用的 neurons 合计（embedding 不计，另见 embeddingCalls）。成本验收读它。 */
  neurons: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

export class ReportV3Service {
  private ai: AIGatewayService;
  private llmCalls = 0;
  private neurons = 0;
  private embeddingCalls = 0;
  private repetitionRetries = 0;

  constructor(private env: CloudflareEnv, private traceContext: TraceContext = {}) {
    this.ai = new AIGatewayService(env);
  }

  private async chat(
    prompt: string,
    o: { maxTokens: number; temperature: number; skipCache: boolean; schema?: Record<string, unknown> }
  ): Promise<{ content: string; truncated: boolean }> {
    const callIndex = CALL_INDEX_BASE + this.llmCalls;
    this.llmCalls++;
    // 传输层失败退避重试：一个簇要打几十次，Workers AI 在并发高时会回 3046: Request timeout，
    // 不重试的话整份报告为了一批句子作废（2026-09-12 整链实测 25 个簇里 4 个这样没了）。
    let res: Awaited<ReturnType<typeof callLLM>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= TRANSPORT_RETRIES; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, TRANSPORT_BACKOFF_MS * 2 ** (attempt - 1)));
      try {
        res = await callLLM(this.ai, this.env, this.traceContext, 'report_v3', [{ role: 'user', content: prompt }], {
          provider: 'workers-ai',
          temperature: o.temperature,
          maxTokens: o.maxTokens,
          // 重试必须绕开缓存，否则 Gateway 会把上一次的失败/同一份产出原样还回来
          skipCache: o.skipCache || attempt > 0,
          callIndex,
          ...(o.schema ? { responseFormat: { type: 'json_schema' as const, json_schema: o.schema } } : {}),
        });
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`[ReportV3] LLM 调用失败（attempt ${attempt}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    if (res.capability !== 'chat') throw new Error(`unexpected response capability ${res.capability}`);
    // usage.neurons 是 Workers AI 的计费单位，类型里没有（各 provider 的 usage 字段不同），运行时有
    this.neurons += Number((res.usage as { neurons?: number } | undefined)?.neurons ?? 0);
    const choice = (res as ChatResponse).choices?.[0];
    return { content: String(choice?.message?.content ?? ''), truncated: choice?.finish_reason === 'length' };
  }

  /** 一批句子 → 事实。复读 / JSON 解不出 → 重试 1 次（强制 skipCache）；仍不行这批算失败，不拖垮整簇。 */
  private async extractBatch(
    parts: Array<{ article: ReportArticleInput; localStart: number; sentences: string[] }>,
    skipCache: boolean
  ): Promise<{ facts: RawFact[]; ok: boolean; unparsed: number; jsonError: boolean; invalidCites: number; noValidCite: number; numbersMissing: number; namesMissing: number }> {
    // s<k> → (articleId, 该文章里的句号)：编号跨整批连续，与 prompt 里的渲染顺序一致
    const flat: string[] = [];
    const map: FactRef[] = [];
    for (const p of parts) {
      p.sentences.forEach((s, i) => {
        flat.push(s);
        map.push({ articleId: p.article.id, sentence: p.localStart + i + 1 });
      });
    }
    const prompt = getCitePrompt(parts);
    let unparsed = 0, jsonError = false, invalidCites = 0, noValidCite = 0, numbersMissing = 0, namesMissing = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content } = await this.chat(prompt, {
        maxTokens: EXTRACT_MAX_TOKENS,
        temperature: 0.1,
        skipCache: skipCache || attempt > 0,
        schema: CITE_SCHEMA as unknown as Record<string, unknown>,
      });
      const parsed = parseCite(content);
      unparsed = parsed.unparsed.length;
      jsonError = parsed.jsonError != null;
      if (parsed.jsonError) {
        if (attempt === 0) this.repetitionRetries++;
        continue;
      }
      const rep = repetitionOfTexts(parsed.facts.map(f => f.text));
      if (!rep.ok) {
        console.warn(`[ReportV3] 抽取批复读：${rep.reason}（attempt ${attempt}）`);
        if (attempt === 0) this.repetitionRetries++;
        continue;
      }
      const facts: RawFact[] = [];
      for (const f of parsed.facts) {
        const chk = checkFact(f, flat);
        invalidCites += chk.invalid;
        numbersMissing += chk.numbersMissing.length;
        namesMissing += chk.namesMissing.length;
        if (!chk.valid.length) {
          noValidCite++;
          continue;
        }
        facts.push({ text: cleanField(f.text), sources: chk.valid.map(k => map[k - 1]) });
      }
      return { facts, ok: true, unparsed, jsonError, invalidCites, noValidCite, numbersMissing, namesMissing };
    }
    return { facts: [], ok: false, unparsed, jsonError, invalidCites, noValidCite, numbersMissing, namesMissing };
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const vecs: number[][] = [];
    for (let i = 0; i < texts.length; i += EMB_BATCH) {
      const batch = texts.slice(i, i + EMB_BATCH);
      this.embeddingCalls++;
      const res = await this.ai.embed({
        provider: 'workers-ai',
        model: EMB_MODEL,
        input: batch,
        metadata: { requestId: `report_v3_emb_${Date.now()}_${i}`, timestamp: Date.now() },
      });
      if (res.capability !== 'embedding') throw new Error(`unexpected response capability ${res.capability}`);
      const data = [...((res as EmbeddingResponse).data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== batch.length) throw new Error(`embedding 返回 ${data.length} 条，要 ${batch.length} 条`);
      for (const d of data) vecs.push(d.embedding);
    }
    return vecs;
  }

  /** 一个候选组 → 子组划分。调用失败时全员单条（不合并），绝不静默把它们并成一条。 */
  private async judge(items: string[], globalIds: number[], intro: string, skipCache: boolean): Promise<Unit[]> {
    let content = '';
    try {
      const r = await this.chat(getPartitionPrompt(items, intro), {
        maxTokens: PARTITION_MAX_TOKENS,
        temperature: 0.1,
        skipCache,
        schema: PARTITION_SCHEMA as unknown as Record<string, unknown>,
      });
      content = r.content;
    } catch (e) {
      console.warn(`[ReportV3] 去重判定调用失败，按不合并处理：${e instanceof Error ? e.message : String(e)}`);
      return globalIds.map(g => ({ members: [g], figuresDiffer: false }));
    }
    const parsed = parsePartition(content, items.length);
    return parsed.subgroups.map(sg => ({ members: sg.indices.map(li => globalIds[li]), figuresDiffer: sg.figuresDiffer }));
  }

  private async dedup(facts: RawFact[], vecs: number[][], skipCache: boolean): Promise<Unit[]> {
    const feats: DedupFeat[] = facts.map(f => ({ ent: normalizedEntities(f.text), tok: contentTokens(f.text) }));
    // 逐字相同的先并（代码，零调用），只把代表送进候选与判定；最后再把同组成员展开回去
    const pre = preMergeIdentical(facts);
    const all = pre.reps;

    // 第一轮：全部事实
    const groups1 = greedyGroups(all, buildCandidates(all, vecs, feats, DEDUP), vecs, DEDUP.groupCap);
    const multi1 = groups1.filter(g => g.length > 1);
    const r1 = await mapLimit(multi1, CONCURRENCY, g => this.judge(g.map(i => facts[i].text), g, PARTITION_INTRO.r1, skipCache));
    let p1: Unit[] = r1.flat();
    const covered = new Set(p1.flatMap(u => u.members));
    for (const i of all) if (!covered.has(i)) p1.push({ members: [i], figuresDiffer: false });
    p1 = p1.filter(u => u.members.length);

    // 第二轮：每个单元出一个代表（出处文章最多的那条），在代表之间再找一次
    const repOf = p1.map(u =>
      u.members.reduce((best, i) => {
        const si = new Set(facts[i].sources.map(s => s.articleId)).size;
        const sb = new Set(facts[best].sources.map(s => s.articleId)).size;
        return si > sb || (si === sb && i < best) ? i : best;
      }, u.members[0])
    );
    const repToUnit = new Map(repOf.map((r, k) => [r, k]));
    const groups2 = greedyGroups(repOf, buildCandidates(repOf, vecs, feats, DEDUP), vecs, DEDUP.groupCap);
    const multi2 = groups2.filter(g => g.length > 1);
    const r2 = await mapLimit(multi2, CONCURRENCY, g => this.judge(g.map(i => facts[i].text), g, PARTITION_INTRO.r2, skipCache));
    const merges = r2.flat().filter(u => u.members.length > 1);

    const parent = p1.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    const figuresOverride = new Map<number, boolean>();
    for (const m of merges) {
      const unitIdxs = m.members.map(rep => repToUnit.get(rep)).filter((x): x is number => x != null);
      if (!unitIdxs.length) continue;
      let root = find(unitIdxs[0]);
      for (const u of unitIdxs.slice(1)) {
        const r = find(u);
        if (r !== root) parent[r] = root;
      }
      root = find(root);
      figuresOverride.set(root, m.figuresDiffer || figuresOverride.get(root) || false);
    }
    const p2Map = new Map<number, Unit>();
    for (let k = 0; k < p1.length; k++) {
      const root = find(k);
      if (!p2Map.has(root)) p2Map.set(root, { members: [], figuresDiffer: false });
      const entry = p2Map.get(root)!;
      entry.members.push(...p1[k].members);
      entry.figuresDiffer = entry.figuresDiffer || p1[k].figuresDiffer;
    }
    for (const [root, flag] of figuresOverride) if (p2Map.has(root)) p2Map.get(root)!.figuresDiffer = flag;
    const p2 = [...p2Map.values()];

    // 第三轮：≥6 条的大组复核一次（过度合并只有这一道闸）
    const big = p2.filter(u => u.members.length >= BIG_GROUP_MIN);
    const p3 = p2.filter(u => u.members.length < BIG_GROUP_MIN);
    const checked = await mapLimit(big, CONCURRENCY, u => {
      const sorted = [...u.members].sort((a, b) => a - b);
      return this.judge(sorted.map(i => facts[i].text), sorted, PARTITION_INTRO.r3(sorted.length), skipCache);
    });
    for (const subs of checked) for (const u of subs) if (u.members.length) p3.push(u);
    // 展开逐字相同的组：篇数与出处由 buildFacts 按全部成员重算，所以这一步放在最后是等价的
    return p3.map(u => ({ ...u, members: u.members.flatMap(m => pre.groupOf.get(m) ?? [m]) }));
  }

  /**
   * 三次尝试，每次把每篇正文截得更短（大簇的产出会被 max_tokens 截断）。
   * 三次都不成**不让整份报告作废**：事实与原句才是写作层的主料，当事方/分歧缺了只是少一个通道，
   * 而整份报告没了就是简报里少一条。返回 error，由调用方记进 trace。
   */
  private async voices(articles: ReportArticleInput[], skipCache: boolean) {
    const budgets = [6000, 3500, 2000];
    let lastErr = '';
    for (let attempt = 0; attempt < budgets.length; attempt++) {
      const prompt = getVoicesPrompt(renderArticlesForVoices(articles, budgets[attempt]));
      const { content, truncated } = await this.chat(prompt, {
        maxTokens: VOICES_MAX_TOKENS,
        temperature: 0.1,
        skipCache: skipCache || attempt > 0,
      });
      if (truncated) {
        lastErr = `被 max_tokens 截断（每篇 ${budgets[attempt]} 字符）`;
        continue;
      }
      const parsed = parseVoices(content);
      if ('err' in parsed) {
        lastErr = parsed.err;
        continue;
      }
      return { ...parsed, attempts: attempt + 1, error: '' };
    }
    console.warn(`[ReportV3] 各方与分歧三次都失败，报告按缺这一节继续：${lastErr}`);
    return { summary: '', parties: [], conflicts: [], attempts: budgets.length, error: lastErr };
  }

  async generate(
    input: { title: string; articles: ReportArticleInput[] },
    skipCache: boolean
  ): Promise<{ report: ReportV3Doc; trace: ReportV3Trace }> {
    const articles = input.articles.filter(a => String(a.content ?? '').trim());
    if (!articles.length) throw new Error('没有带正文的文章');

    // 1 切句
    const split = await traced('split', async () => {
      const per = articles.map(a => ({ article: a, sentences: splitSentences(a.content) }));
      const total = per.reduce((n, x) => n + x.sentences.length, 0);
      annotate({ articles: per.length, sentences: total });
      return per;
    });
    const sentences: Record<string, string[]> = Object.fromEntries(split.map(x => [String(x.article.id), x.sentences]));

    // 2 抽取
    const batches = packBatches(split, SENTENCE_BUDGET);
    const ex = { failedBatches: 0, unparsed: 0, jsonErrors: 0, invalidCites: 0, noValidCite: 0, numbersMissing: 0, namesMissing: 0 };
    const rawFacts = await traced(
      'extract',
      async () => {
        const res = await mapLimit(batches, CONCURRENCY, b => this.extractBatch(b, skipCache));
        const facts: RawFact[] = [];
        for (const r of res) {
          if (!r.ok) ex.failedBatches++;
          ex.unparsed += r.unparsed;
          if (r.jsonError) ex.jsonErrors++;
          ex.invalidCites += r.invalidCites;
          ex.noValidCite += r.noValidCite;
          ex.numbersMissing += r.numbersMissing;
          ex.namesMissing += r.namesMissing;
          facts.push(...r.facts);
        }
        annotate({ batches: batches.length, facts: facts.length, ...ex });
        return facts;
      },
      { batches: batches.length }
    );
    if (!rawFacts.length) throw new Error(`抽取没有产出任何事实（${batches.length} 批，失败 ${ex.failedBatches} 批）`);

    // 3 向量
    const vecs = await traced('embed', async () => {
      const v = await this.embed(rawFacts.map(f => f.text));
      annotate({ vectors: v.length, dimensions: v[0]?.length ?? 0, calls: this.embeddingCalls });
      return v;
    });

    // 4 去重
    const callsBeforeDedup = this.llmCalls;
    const units = await traced('dedup', async () => {
      const u = await this.dedup(rawFacts, vecs, skipCache);
      annotate({ units: u.length, merged: u.filter(x => x.members.length > 1).length, figuresDiffer: u.filter(x => x.figuresDiffer).length });
      return u;
    });
    const dedupCalls = this.llmCalls - callsBeforeDedup;

    // 5 各方与分歧
    const voices = await traced('voices', async () => {
      const v = await this.voices(articles, skipCache);
      annotate({ parties: v.parties.length, conflicts: v.conflicts.length, attempts: v.attempts, error: v.error });
      return v;
    });

    // 6 组装
    const report = await traced('assemble', async () => {
      const facts = buildFacts(units, rawFacts, articles.map(a => a.id));
      const doc: ReportV3Doc = {
        version: 'report-v3',
        generated: new Date().toISOString(),
        title: cleanField(input.title),
        pipeline: {
          extraction: `selective cited free-text facts, glm-4.7-flash, batches of ≤${SENTENCE_BUDGET} sentences`,
          dedup: `v2: bge-m3 top-${DEDUP.topK} candidates (cos ≥ ${DEDUP.cosMin}), non-overlapping groups ≤${DEDUP.groupCap}, LLM same-fact judgement, round 2 across groups, big-group check (≥${BIG_GROUP_MIN})`,
          support: `distinct articles cited by a unit's members; skeleton = articles ≥ ${2}`,
          voices: 'one call per cluster: summary, parties, conflicts',
        },
        articles: articles.map(a => ({ id: a.id, title: a.title, url: a.url ?? '', publishDate: a.publishDate ?? '' })),
        summary: voices.summary,
        facts,
        parties: voices.parties,
        conflicts: voices.conflicts,
        sentences,
      };
      annotate({ facts: facts.length, skeleton: facts.filter(f => f.skeleton).length });
      return doc;
    });

    return {
      report,
      trace: {
        articles: articles.length,
        sentences: Object.values(sentences).reduce((n, s) => n + s.length, 0),
        batches: batches.length,
        factsRaw: rawFacts.length,
        facts: report.facts.length,
        skeleton: report.facts.filter(f => f.skeleton).length,
        parties: report.parties.length,
        conflicts: report.conflicts.length,
        extraction: ex,
        dedupCalls,
        embeddingCalls: this.embeddingCalls,
        voicesAttempts: voices.attempts,
        ...(voices.error ? { voicesError: voices.error } : {}),
        repetitionRetries: this.repetitionRetries,
        llmCalls: this.llmCalls,
        neurons: this.neurons,
      },
    };
  }
}

interface FactRef {
  articleId: number;
  sentence: number;
}
