// 主线分块层：把去重后仍然过多的同簇单元，按**叙事主线**归并成 3-5 块。
//
// 病灶（2026-09-02 实测，cron-brief-1788354033950 的 cluster 22，9 条 story / 63 篇）：
// 一场大灾难被切成 9 条，选择层按 importance 取 top-25 时只放进 2 条、丢掉 7 条 ——
// 进简报 29 篇、丢弃 34 篇，其中 13 篇的成因与 10 篇的救援**整条丢**。
// 也就是说「一节只有 2 块」不是把碎片合起来换来的，是把碎片扔掉换来的：
// 碎片化的代价从「读者看到重复」变成了「读者看不到内容」。
//
// 这一层与去重层正交，别混：
//   去重层     问「底层发生是不是同一个」——把重复报道合回去（cos ≥0.94 + LLM 确认）
//   主线分块   问「读者读起来是不是同一条主线」——把一件大事分成几个角度
// 一场洪灾的救援与成因复盘确实是同一个发生（去重层判准原文如此），但它们是两条主线。
//
// 为什么不能在去重层内部解决（已证伪，别再试）：聚合算法只有两个输入，都不带题材信号——
// LLM 判决边在 0.90 带上 202/210 全是 yes（96% 完全图），cos 的组内 vs 跨组 AUC 只有 0.601。
// 所以 complete/star/quorum/MCL/任意加权变体，输出都不可能有题材结构。不是没试到好算法，
// 是信息不在输入里。完整读数见 apps/backend/prototypes/dedup-band/FINDINGS.md。

/** 主线定义，由 ai-worker 的 storyline/plan 产出 */
export interface StorylineDef {
  name: string;
  covers: string;
}

/**
 * 参与分块的最小单元。**一个单元 = 去重层的一个合并组，或一条未被合并的 story。**
 * 形状与 dedup 的产物一致，好让分块结果能原样替换掉 dedupPlan.groups。
 */
export interface StorylineUnit {
  /** 组内成员在 validatedStories.stories 里的下标 */
  indices: number[];
  title: string;
  /** 组内全部配对的最小余弦；单条 story 与主线组均无意义，见 SENTINEL_NO_COSINE */
  minCos: number;
  needsConfirm?: boolean;
  confirmed?: boolean;
}

/** 主线组不是由余弦决定的。用哨兵值而不是 0，让观测端能把两者分开。 */
export const SENTINEL_NO_COSINE = -1;

/**
 * 触发阈值：同簇的去重后单元数达到这个值才跑主线分块。
 *
 * 小簇不跑有两个理由，都不是省钱：
 *  ① 主线分块的前提是「全簇是一件事」，prompt 里就这么写。而杂物袋簇（一袋不相干小事）
 *     不成立，强行让模型给它们编 3-5 条共同主线只会造出假主线。去重层的注释里有实测：
 *     杂物袋簇几乎不过拆（过拆倍数 1.1-1.3），缺陷本来就集中在单一大事件的大簇上。
 *  ② 只有 3-4 个单元时，分成 3-5 条主线等于什么都没合。
 */
export const STORYLINE_MIN_UNITS = 6;

/**
 * 每个单元投几票。5 票多数，实测把总述块从 39 篇摊到 30 篇。
 * 投票不是为了提精度，是为了**摊平位置偏置**——见 permuteStorylines。
 */
export const STORYLINE_VOTES = 5;

/**
 * 主线在展示给模型时的顺序：按 (单元 id, 轮次) 做确定性 Fisher-Yates 置换。
 *
 * ⚠️ 种子里必须带轮次。只用 id 的话 N 轮看到的顺序完全相同 = 同一个输入问 N 遍，
 * 多数票等于把同一个偏置投了 N 遍——实测那样会报出「全票一致 21/22」的假稳定，
 * 换成带轮次后真实值是 13/22。轮次是已知量，工作流重放仍然确定。
 *
 * 位置偏置是实测的：总述线排在展示第 1 位时被选中 5/8 条，不在第 1 位时 3/14 条，差 3 倍。
 *
 * @returns ord[展示位] = 原始下标
 */
export function permuteStorylines(unitId: number, count: number, round: number): number[] {
  const ord = Array.from({ length: count }, (_, i) => i);
  let h = (unitId * 2654435761 + round * 40503) >>> 0;
  for (let i = count - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [ord[i], ord[j]] = [ord[j], ord[i]];
  }
  return ord;
}

/**
 * 多数票。弃权（null）不投也不算分母里的赢家——全部弃权则返回 null，调用方据此保持原样。
 * 并列取序号最小的一条，保证同一批票永远得到同一个结果（工作流重放要求确定性）。
 */
export function majorityStoryline(votes: Array<number | null>): number | null {
  const tally = new Map<number, number>();
  for (const v of votes) if (v != null) tally.set(v, (tally.get(v) ?? 0) + 1);
  if (tally.size === 0) return null;
  let best = -1;
  let bestN = -1;
  for (const [k, n] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/**
 * 把「单元 → 主线」的归属重组成合并组，形状与去重层一致，可原样替换 dedupPlan.groups。
 *
 * - 每条主线下辖的全部单元并成一组，标题用主线名（不再让下游重起——b′ 的规划步只读
 *   executiveSummary、不知道主线名，实测它重起的块标题只有 2/5 对得上主线）。
 * - 只有 1 个单元的主线不构成合并组：若该单元本来就是去重合并组，原样保留；
 *   若是单条 story，则不进任何组。
 * - 弃权的单元同理保持原样。**绝不把弃权当成「归到第 1 条」**。
 *
 * @param assignment 与 units 等长，1 基的主线序号；null = 弃权
 */
export function regroupByStoryline(
  units: StorylineUnit[],
  assignment: Array<number | null>,
  storylines: StorylineDef[]
): StorylineUnit[] {
  if (units.length !== assignment.length) {
    // 长度对不上说明调用方漏了单元，静默按位置对齐会把归属整体错位。
    throw new Error(`regroupByStoryline: units(${units.length}) 与 assignment(${assignment.length}) 长度不一致`);
  }
  const byLine = new Map<number, number[]>();
  const kept: StorylineUnit[] = [];
  units.forEach((u, i) => {
    const a = assignment[i];
    if (a == null || a < 1 || a > storylines.length) {
      if (u.indices.length > 1) kept.push(u); // 原本就是合并组，保住
      return;
    }
    byLine.set(a, [...(byLine.get(a) ?? []), i]);
  });

  const out: StorylineUnit[] = [];
  for (const [line, memberIdx] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    // 判据是**单元数**不是 story 数：一条主线只捞到一个单元时它没有做任何合并，
    // 该单元应原样输出（保住它自己的 title 与 minCos），而不是被换成主线名、丢掉去重来历。
    if (memberIdx.length < 2) {
      const only = units[memberIdx[0]];
      if (only.indices.length > 1) out.push(only); // 本来就是去重合并组，保住
      continue;
    }
    const indices = [...new Set(memberIdx.flatMap(i => units[i].indices))].sort((x, y) => x - y);
    out.push({
      indices,
      title: storylines[line - 1].name,
      minCos: SENTINEL_NO_COSINE,
      confirmed: false,
    });
  }
  return [...out, ...kept].sort((a, b) => b.indices.length - a.indices.length || a.indices[0] - b.indices[0]);
}
