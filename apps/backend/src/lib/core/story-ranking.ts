// 选择层：把 LLM importance 与多源覆盖度合成选择分，降序取 top-N 送情报深度分析。
//
// 从 auto-brief-generation.ts 的 run() 内联抽出的纯决策核（E）：原本混在 1693 行工作流里、
// 不跑整条 workflow 就无法测。抽成纯函数后，打分/排序/取 top-N 这条产品逻辑可独立测。
// 编排（DB 查覆盖度、step.do、落库 selected_for_intel）仍留 run()。
//
// 打分：score = importance + coverageWeight * log2(1 + 独立源数)。
// log2(1+源数) 取边际递减（第 2 个独立源比第 6 个信息量大）；coverageWeight=1.0 让 importance
// 仍主导、覆盖度只做有界 nudge（满额约 +3）。这是 NDCG eval 上线前的保守默认，做成参数便于校准。

export interface RankedStory<S> {
  story: S;
  /** 该 story 的独立来源数（distinct source count）。 */
  srcs: number;
  /** 选择分。 */
  score: number;
}

export interface RankOptions {
  coverageWeight: number;
  maxStories: number;
  /**
   * 同一事件最多选几条。不传 = 不限（旧行为）。
   *
   * 立此参数的病灶：分块层按簇独立命名切分，聚类把同一个事件分到两个簇时没人协调，
   * 2026-09-04 实测尼泊尔洪灾在前 25 格里占 7 格（簇 55 五格 + 簇 54 两格），
   * 超过验收目标 ①「一件大事不刷屏」定的 4 格。
   */
  perEventCap?: number;
  /**
   * 事件键。同键即同一事件，受 perEventCap 约束。不传 = 每条各自成事件（等价于不限）。
   * 生产传的是块内文章标题的主导专有名词（见 lib/core/storyline.ts 的 dominantEntity）。
   */
  eventKeyOf?: (story: unknown, index: number) => string;
  /**
   * LLM 排序给出的优先序（stories 的下标，最重要的在前）。不传 = 全按选择分（旧行为）。
   *
   * 传了的话，这些下标**整体排在选择分之前**，内部保持给定顺序；其余候选仍按选择分接在
   * 后面。同事件配额对两段一视同仁——LLM 侧已做过 eventKey 去重，机械配额留着兜底。
   *
   * 为什么不是「把 LLM 序当一个分数加权进选择分」：那需要一个把序号换算成分的标度，而
   * 这个标度没有任何读数支撑，调它等于凭感觉。直接分段则只依赖「前 N 条该在最前面」
   * 这一个已验过的判断。
   */
  llmOrder?: number[];
}

/**
 * @param stories        候选 stories（各带 importance）
 * @param sourceCoverage index → 独立源数 的映射（键为 stories 的下标）
 */
export function rankStoriesForIntelligence<S extends { importance?: number }>(
  stories: S[],
  sourceCoverage: Record<number, number>,
  opts: RankOptions
): { ranked: RankedStory<S>[]; selected: S[]; capped: RankedStory<S>[] } {
  const scored = stories.map((story, i) => {
    const srcs = sourceCoverage[i] ?? 0;
    return { story, srcs, score: (story.importance ?? 0) + opts.coverageWeight * Math.log2(1 + srcs), idx: i };
  });

  // LLM 序在前、选择分在后。两段内部各自有序，拼接后再走配额与 top-N。
  const llmRank = new Map<number, number>();
  (opts.llmOrder ?? []).forEach((idx, pos) => {
    if (idx >= 0 && idx < stories.length && !llmRank.has(idx)) llmRank.set(idx, pos);
  });
  const ranked: RankedStory<S>[] = scored
    .slice()
    .sort((a, b) => {
      const ra = llmRank.get(a.idx);
      const rb = llmRank.get(b.idx);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return b.score - a.score;
    })
    .map(({ story, srcs, score }) => ({ story, srcs, score }));

  // 按选择分降序取 top-N，避免把全部候选送进 LLM 深度分析（成本/时间爆炸）。
  // 有事件配额时边走边数：同一事件超额的**跳过**而不是截断，让位给后面的其他事件。
  const cap = opts.perEventCap;
  const keyOf = opts.eventKeyOf;
  const selected: S[] = [];
  const capped: RankedStory<S>[] = [];
  const seen = new Map<string, number>();
  for (const r of ranked) {
    if (selected.length >= opts.maxStories) break;
    if (cap != null && keyOf) {
      const k = keyOf(r.story, stories.indexOf(r.story));
      const n = seen.get(k) ?? 0;
      if (k && n >= cap) { capped.push(r); continue; }
      seen.set(k, n + 1);
    }
    selected.push(r.story);
  }
  return { ranked, selected, capped };
}
