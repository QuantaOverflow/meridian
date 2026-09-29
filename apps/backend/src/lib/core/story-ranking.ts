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
   * LLM 排序给出的优先序（stories 的下标，最重要的在前）。不传 = 全按选择分（旧行为）。
   *
   * 传了的话，这些下标**整体排在选择分之前**，内部保持给定顺序；其余候选仍按选择分接在
   * 后面。
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
): { ranked: RankedStory<S>[]; selected: S[] } {
  const scored = stories.map((story, i) => {
    const srcs = sourceCoverage[i] ?? 0;
    return { story, srcs, score: (story.importance ?? 0) + opts.coverageWeight * Math.log2(1 + srcs), idx: i };
  });

  // LLM 序在前、选择分在后。两段内部各自有序，拼接后取 top-N。
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
  // 同一件事被拆成多块的情况已在上游合掉（cluster-blocks.ts 的 mergeSameEventBlocks），这里不再做同事件配额。
  const selected = ranked.slice(0, opts.maxStories).map((r) => r.story);
  return { ranked, selected };
}
