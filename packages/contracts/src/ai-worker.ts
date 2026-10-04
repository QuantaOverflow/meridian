/**
 * ai-worker 各路由的请求/响应数据类型（backend 经 service binding 调用，ai-worker 实现）。
 *
 * 两侧都 import 这一份，不再各抄一份。响应外壳是 ai-worker 的 `APIResponse<T>`
 * （`{ success, data?, error? }`），这里只定义 `data` 的形状；backend 的 `callJson` 负责拆壳。
 */
import { z } from 'zod';

// ── POST /meridian/article/analyze ─────────────────────────────────────────

/**
 * 文章分析的字段契约。ai-worker 用它对模型输出做 safeParse（只记录不阻断），
 * backend 用它推导分析结果的类型。prompt 文本留在 ai-worker（prompts/articleAnalysis.ts）。
 */
export const articleAnalysisSchema = z.object({
  language: z.string().length(2),
  primary_location: z.string(),
  completeness: z.enum(['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS']),
  content_quality: z.enum(['OK', 'LOW_QUALITY', 'JUNK']),
  event_summary_points: z.array(z.string()),
  thematic_keywords: z.array(z.string()),
  topic_tags: z.array(z.string()),
  key_entities: z.array(z.string()),
  content_focus: z.array(z.string()),
});

export type ArticleAnalysis = z.infer<typeof articleAnalysisSchema>;

export interface ArticleAnalyzeRequest {
  title: string;
  content: string;
}

// ── POST /meridian/stories/rank ─────────────────────────────────────────────

export interface RankCandidate {
  /** 稳定 id，回传时用它指代故事；调用方自己决定用 clusterId 还是下标 */
  id: number;
  title: string;
  /**
   * 报道篇数。**必须带上**——它是离线迭代时在场的字段，两期读数都是带它测出来的。
   * 移植时曾按「篇数是热度信号，不该喂进重要性判据」的直觉把它去掉，同一期、同一 prompt
   * 的排序立刻变形：两期验过的三条（一次政府禁媒体、一场州选举、一次导弹袭击机场）全部
   * 掉出前 12，榜首也换人。是不是它单独导致的没有再拆开验，但取舍很清楚——
   * 实测过的配置优先于未实测的直觉。
   */
  articles: number;
}

export interface StoryRankRequest {
  candidates: RankCandidate[];
}

export interface RankedPick {
  id: number;
  eventKey: string;
  category: string;
  why: string;
  /** Borda 总分；三轮都进前 1 名是 3*RANK_TOP_N */
  borda: number;
  /** 在几轮里被选中（1-3）。1 的条目是边缘项，调用方可据此决定要不要信 */
  timesSelected: number;
}

export interface RankRoundDiag {
  round: number;
  ok: boolean;
  error?: string;
  selectedIds: number[];
  duplicates: number;
  outOfRange: number;
  eventKeyDupes: number;
  retried: boolean;
}

export interface StoryRankResult {
  /** Borda 降序的前 N 条 */
  picks: RankedPick[];
  rounds: RankRoundDiag[];
  roundsOk: number;
  /** 三轮前 N 的交集大小。小说明排序在飘，调用方只进观测 */
  intersectionSize: number;
}

// ── POST /meridian/cluster/judge ────────────────────────────────────────────

export interface JudgeArticle {
  id: number;
  title: string;
}

export interface ClusterJudgeRequest {
  articles: JudgeArticle[];
}

type ClusterJudgeVerdict = 'EVENT' | 'NO_EVENT' | 'UNSURE';

export interface ClusterJudgeResult {
  verdict: ClusterJudgeVerdict;
  title: string;
  event: string;
  reason: string;
}

// ── POST /meridian/brief-block-v6 ───────────────────────────────────────────

/**
 * 篇幅档。`lead` / `more` 走现有 exec 档（逐字不变，那是唯一有实测读数的配置），
 * `brief` 走 1–2 句的短档。不传 / 非法值的处理见 ai-worker `normalizeTier`。
 */
export type BriefTier = 'lead' | 'more' | 'brief';

export interface BriefBlockV6Source {
  articleId: number;
  sentence: number;
}

export interface BriefBlockV6Sentence {
  text: string;
  sources: BriefBlockV6Source[];
}

interface BriefBlockV6ArticleInput {
  id: number;
  title: string;
  content: string;
  publishDate?: string;
  sourceId?: number | null;
}

export interface BriefBlockV6Request {
  articles: BriefBlockV6ArticleInput[];
  /**
   * 篇幅档。`lead` / `more` / 不传 = 现有 exec 档（3–5 句），`brief` = 1–2 句短档。
   * 非法值按不传处理（篇幅是写作风格，不是正确性约束，不值得 400）。
   */
  tier?: BriefTier | string;
}

/**
 * 写作–核查循环（ADR 0010）怎么收尾的：
 * - `off`           核查 epoch 设成 0：不核查、不改写
 * - `clean`         草稿里没有句子被标出
 * - `fixed`         某次改写之后没有句子被标出
 * - `revise_failed` 一次改写的三次尝试全被拒，发的是上一版
 * - `still_flagged` 第 2 次改写之后仍有句子被标出，发的是最后一版
 */
export type BriefBlockV6CheckOutcome = 'off' | 'clean' | 'fixed' | 'revise_failed' | 'still_flagged';

/** 一个核查 epoch 判「有问题」时给的意见。字段是核查 agent 的原话，可能缺。 */
interface BriefBlockV6Finding {
  type?: string;
  problem?: string;
  /** 证据原句 [articleId, sentence]，只含核查 agent 看过的句子 */
  evidence?: [number, number][];
  /** 建议改法；发回写作时只当提示 */
  fix?: string;
}

interface BriefBlockV6CheckRound {
  /** 0 = 草稿；n = 第 n 次改写后的那一版 */
  round: number;
  /** 这一版里被标出的句子（句号 1 起）；每个判有问题的 epoch 一条意见 */
  flagged: Array<{ sentence: number; text: string; findings: BriefBlockV6Finding[] }>;
  /** 这一轮核查了、但没有任何 epoch 给出结论的句子（句号 1 起）。沿用上一轮结论的句子不在这里 */
  noVerdict: number[];
  /** 这一轮之后的那次改写；没有改写（没标出句子，或已改满两次）就没有这一项 */
  revise?: {
    accepted: boolean;
    attempts: number;
    /** 每次被拒的尝试一条：`#<第几次> <原因>`（校验原因码、截断、JSON 解不出、复读或调用报错） */
    rejects: string[];
  };
}

/**
 * 写作–核查循环的块级记录（ADR 0010；用词见 CONTEXT.md「写作–核查循环」）。
 *
 * backend 原样存进 brief-v3 记录，只读 `outcome` 与 `unchecked`；其余字段供事后复盘
 * 核查员与写作做得对不对。改这些字段不需要改 backend。
 */
export interface BriefBlockV6Check {
  /** 配置的核查 epoch 数；0 = 关掉核查 */
  epochs: number;
  outcome: BriefBlockV6CheckOutcome;
  /** 被采纳的改写次数（0–2） */
  revisions: number;
  /**
   * 发出去的那一版里，没有任何 epoch 给出结论的句子（句号 1 起）。非空 = 这块降级发出。
   * `off` 时为空：关掉核查是主动的选择，不算降级。
   */
  unchecked: number[];
  /** 发出去的那一版里仍被标出的句子（句号 1 起） */
  stillFlagged: number[];
  /** 草稿。发出去的就是草稿（revisions = 0）时为 null */
  draft: null | { title: string; sentences: BriefBlockV6Sentence[] };
  rounds: BriefBlockV6CheckRound[];
  /** 循环本身（逐句核查 + 改写）的调用数、neurons 与耗时；trace.llmCalls / trace.neurons 已含这些 */
  calls: number;
  neurons: number;
  ms: number;
}

// backend 落观测只读这几项（auto-brief-generation 的 brief-v3 记录）；复读重试另有 console.warn
interface BriefBlockV6Trace {
  windows: number;
  anchors: number;
  citationsRepaired: number;
  /** 三次尝试全失败、被跳过的窗口数。>0 意味着这块的材料不完整。 */
  windowFailures: number;
  /**
   * 写作步每次被确定性校验拒收的原因（`#尝试次 原因码…`）。空数组 = 一次过。
   * 不记的话「一次过」和「第三次才过」在观测里分不开。
   */
  writeRejects: string[];
  llmCalls: number;
  /** 全部 LLM 调用的 neurons 合计（成本验收读它）。 */
  neurons: number;
  /**
   * 写作–核查循环的记录。以下情况没有：verdict 是 not_a_single_event（没有句子可核）；
   * 回滚到循环之前的 ai-worker 版本（backend 按「缺记录」计数，不报错）。
   */
  check?: BriefBlockV6Check;
}

export interface BriefBlockV6Result {
  verdict: 'written' | 'not_a_single_event';
  reason?: string;
  block: null | { title: string; sentences: BriefBlockV6Sentence[] };
  trace: BriefBlockV6Trace;
}

// ── POST /meridian/brief-title ──────────────────────────────────────────────

export interface BriefTitleRequest {
  content: string;
}

export interface BriefTitleResult {
  title: string;
  neurons: number;
}

// ── POST /meridian/generate-brief-summary ───────────────────────────────────

export interface BriefSummaryRequest {
  briefTitle: string;
  briefContent: string;
}

export interface BriefSummaryResult {
  tldrProse: string;
}
