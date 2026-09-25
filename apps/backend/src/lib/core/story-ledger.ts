// 故事账本：一期简报里候选故事从选中、分层、出块到文章去向的单一账本。
//
// 立它的病灶：同一个故事曾在 4 套下标里流转（候选下标 → 选中下标 → 分层位置 → brief_stories 行 id，
// 行 id 还靠 `__briefStoryRowIds` 挂在对象上），文章去向表在 workflow 里分 4 处、跨几百行各自事后
// 比对推断。账本给每个候选一个稳定 storyId（= 它在候选数组里的下标），各阶段结果只记一次，
// 派生读数都由这里算。
//
// 纯内存、零 IO：不接 db / env / bucket，workflow 只把 step 的**输出**记进来（重放时由引擎回放，
// 所以可重放），golden 与单测可直接用。
import type { StoryBlock } from './cluster-blocks';
import { rankStoriesForIntelligence, type RankedStory } from './story-ranking';
import type { Tier } from './brief-v3';

/** 候选故事的稳定 id = 它在候选数组（validatedStories.stories）里的下标。 */
export type StoryId = number;

export const ARTICLE_JOURNEY_STAGES = ['clustered', 'judged', 'selected', 'written'] as const;

export type ArticleJourneyEntry = {
  clusterId: number | null;
  reachedStage: string;
  droppedAt: string | null;
  dropReason: string | null;
  blockIdx: number | null;
};

export interface SelectOptions {
  coverageWeight: number;
  maxStories: number;
  perEventCap: number;
  llmOrder?: number[];
}

/** assignTiers 的输入：idx 是选中下标（块 step 名 `简报块:${idx}` 用的就是它，不能换成 storyId）。 */
export type TierInput = { idx: number; articles: number; sources: number };
export type TierPlanEntry = TierInput & { tier: Tier; score: number };

export class StoryLedger<W extends { idx: number } = { idx: number }> {
  private rowIds?: number[];
  private coverage?: Record<number, number>;
  private selection?: {
    ranked: RankedStory<StoryBlock>[];
    selected: StoryId[];
    cappedIds: Set<StoryId>;
    rankedIds: StoryId[];
    maxStories: number;
    perEventCap: number;
  };
  private tiers?: TierPlanEntry[];
  private blocks?: { written: W[]; failedIdx: Set<number> };
  private readonly idOf: Map<StoryBlock, StoryId>;

  constructor(readonly stories: readonly StoryBlock[]) {
    this.idOf = new Map(stories.map((s, i) => [s, i]));
  }

  private once(recorded: unknown, what: string) {
    if (recorded !== undefined) throw new Error(`故事账本：${what} 已记录过，不许重记`);
  }

  private need<T>(v: T | undefined, what: string): T {
    if (v === undefined) throw new Error(`故事账本：${what} 还没记录`);
    return v;
  }

  /** brief_stories 插入返回的主键，按候选顺序（第 i 个 = storyId i 的行）。 */
  recordRowIds(rowIds: number[]) {
    this.once(this.rowIds, '行 id');
    this.rowIds = rowIds;
  }

  /** storyId → 独立源数（compute:source_coverage step 的输出）。 */
  recordSourceCoverage(cov: Record<number, number>) {
    this.once(this.coverage, '源覆盖');
    this.coverage = cov;
  }

  /** 选择层：rankStoriesForIntelligence 的 ranked / selected / capped，只跑一次。 */
  select(opts: SelectOptions) {
    this.once(this.selection, '选择');
    const cov = this.need(this.coverage, '源覆盖');
    const res = rankStoriesForIntelligence(this.stories as StoryBlock[], cov, {
      coverageWeight: opts.coverageWeight,
      maxStories: opts.maxStories,
      perEventCap: opts.perEventCap,
      eventKeyOf: (story) => String((story as { eventKey?: string }).eventKey ?? ''),
      llmOrder: opts.llmOrder,
    });
    const idOf = (s: StoryBlock) => this.idOf.get(s)!;
    this.selection = {
      ranked: res.ranked,
      selected: res.selected.map(idOf),
      cappedIds: new Set(res.capped.map((x) => idOf(x.story))),
      rankedIds: res.ranked.map((x) => idOf(x.story)),
      maxStories: opts.maxStories,
      perEventCap: opts.perEventCap,
    };
    return res;
  }

  /** 选中故事的 storyId，按选中顺序（第 k 个 = 块 step 的 idx k）。 */
  selectedStoryIds(): StoryId[] {
    return this.need(this.selection, '选择').selected.slice();
  }

  /**
   * 给 persist:mark_selected_for_intel：选中故事的 brief_stories 主键。
   * 按主键精确标记，**不能按 cluster_id**（一个簇会产出多个故事、共享 cluster_id）。
   */
  selectedRowIds(): number[] {
    const rowIds = this.need(this.rowIds, '行 id');
    return this.selectedStoryIds()
      .map((id) => rowIds[id])
      .filter((x): x is number => typeof x === 'number');
  }

  /**
   * assignTiers 的输入。篇数取 story.articleIds.length（写作前拿不到 R2 真取到正文的篇数），
   * 源数钳到 [1, 篇数]。
   */
  tierInputs(): TierInput[] {
    const cov = this.need(this.coverage, '源覆盖');
    return this.selectedStoryIds().map((id, i) => {
      const s = this.stories[id];
      const articles = Math.max(1, Array.isArray(s.articleIds) ? s.articleIds.length : 0);
      return { idx: i, articles, sources: Math.max(1, Math.min(cov[id] ?? 0, articles)) };
    });
  }

  recordTiers(plan: TierPlanEntry[]) {
    this.once(this.tiers, '分层');
    this.tiers = plan;
  }

  /** 选中下标 → 分层结果；取不到说明两处口径对不上，调用方应失败而不是猜档位。 */
  tierOfSelected(idx: number): TierPlanEntry | undefined {
    return this.need(this.tiers, '分层').find((p) => p.idx === idx);
  }

  /** 写块结果：written / failed 都以选中下标 idx 记。 */
  recordBlocks(written: W[], failed: Array<{ idx: number }>) {
    this.once(this.blocks, '写块');
    this.blocks = { written, failedIdx: new Set(failed.map((f) => f.idx)) };
  }

  /**
   * 按分层顺序排好的**出了块的**故事（渲染与 brief-v3 记录用）。
   * 不要再对写完的块跑一次 assignTiers——那会用另一套输入重新分档，与实际写作用的档位脱节。
   * 代价：若排在前面的故事写块失败，头条那一节会少于 4 条（旧写法是从成功的块里补满）。
   */
  tieredWritten(): W[] {
    const tiers = this.need(this.tiers, '分层');
    const { written } = this.need(this.blocks, '写块');
    const byIdx = new Map<number, W>(written.map((b) => [b.idx, b]));
    return tiers.map((p) => byIdx.get(p.idx)).filter((b): b is W => b !== undefined);
  }

  /**
   * 真正喂进简报的去重文章 = 出了块的那些 story 的 articleIds 并集
   * （失败的 story 不算，它没进简报）。used_articles 与 usedSources 同用这一个集合口径。
   */
  usedArticleIds(): Set<number> {
    const { failedIdx } = this.need(this.blocks, '写块');
    return new Set<number>(
      this.selectedStoryIds()
        .filter((_, i) => !failedIdx.has(i))
        .flatMap((id) => (Array.isArray(this.stories[id].articleIds) ? this.stories[id].articleIds : []))
    );
  }

  /**
   * 文章去向表：回答业务上最常问的「某件大事为什么没进简报」。一篇文章一条记录，记它走到哪一关、
   * 被哪一关拦下、进了简报的话在哪一块。只推到账本已记录的阶段（没选材的一期停在 judged）。
   *
   * @param articleIds 本期数据集的全部文章 id（条目顺序即此顺序）
   * @param clusters   聚类结果（含 -1 噪声桶）
   */
  articleJourney(
    articleIds: number[],
    clusters: ReadonlyArray<{ clusterId: number; articleIds: number[] }>
  ): Map<number, ArticleJourneyEntry> {
    const journey = new Map<number, ArticleJourneyEntry>();

    // 第 1 关 clustered：记归属簇。-1 噪声桶在簇判定里被显式跳过（`clusterId < 0 continue`），
    // 所以它**就是**这一关的拦下原因，记 noise。
    for (const id of articleIds) {
      journey.set(id, {
        clusterId: null,
        reachedStage: 'clustered',
        droppedAt: 'clustered',
        dropReason: 'not_in_any_cluster',
        blockIdx: null,
      });
    }
    for (const c of clusters) {
      for (const id of c.articleIds) {
        const entry = journey.get(id);
        if (!entry) continue; // ml 侧回传了不属于本窗口的 id，忽略
        entry.clusterId = c.clusterId;
        if (c.clusterId < 0) {
          entry.droppedAt = 'clustered';
          entry.dropReason = 'noise';
        } else {
          entry.droppedAt = null;
          entry.dropReason = null;
        }
      }
    }

    // 第 2 关 judged：进了某一块 = 过关。
    // ⚠️ 这一关**没有**「被判官毙掉」这条去向：不拒绝整簇，NO_EVENT / UNSURE
    // 只标记不丢弃（见 workflow 簇判定的注释）。所以过了聚类却不在任何块里，只可能是块物化时
    // 被 DEFAULT_ARTICLE_CAP 截掉或跨簇同名合并时去重掉——两者都发生在「簇判定」step
    // **内部**（assembleBlocks），步外只拿得到合计数 droppedArticles，分不出是哪一种，
    // 故合记为 block_article_cap。
    const judgedPass = new Set<number>(
      this.stories.flatMap((s) => (Array.isArray(s.articleIds) ? s.articleIds : []))
    );
    for (const [id, entry] of journey) {
      if (entry.droppedAt) continue;
      if (judgedPass.has(id)) {
        entry.reachedStage = 'judged';
      } else {
        entry.droppedAt = 'judged';
        entry.dropReason = 'block_article_cap';
      }
    }

    const sel = this.selection;
    if (!sel) return journey;

    // 第 3 关 selected：排名信息在 ranked 里是完整的（全量候选按分降序），
    // 所以被截断的能记下**真实名次**，不必记 unknown；被同事件配额挤掉的在 capped 里，
    // 两种落选原因分开记——「排不进前 N」和「同一件事已经占满格」对读者是两回事。
    const selectedArticles = new Set<number>(
      sel.selected.flatMap((id) => (Array.isArray(this.stories[id].articleIds) ? this.stories[id].articleIds : []))
    );
    const rankDropReason = new Map<number, string>();
    sel.rankedIds.forEach((storyId, i) => {
      const reason = sel.cappedIds.has(storyId)
        ? `per_event_cap_${sel.perEventCap}`
        : `rank_${i + 1}_beyond_top${sel.maxStories}`;
      const ids = Array.isArray(this.stories[storyId].articleIds) ? this.stories[storyId].articleIds : [];
      for (const id of ids) if (!rankDropReason.has(id)) rankDropReason.set(id, reason);
    });
    for (const [id, entry] of journey) {
      if (entry.droppedAt) continue;
      if (selectedArticles.has(id)) {
        entry.reachedStage = 'selected';
        continue;
      }
      entry.droppedAt = 'selected';
      // ranked 覆盖全部候选块，所以正常一定取得到；取不到说明两处口径对不上，标 unknown 不猜。
      entry.dropReason = rankDropReason.get(id) ?? 'unknown';
    }

    if (!this.blocks) return journey;

    // 第 4 关 written：一块 = 一个被选中的 story，两者用同一个 idx（选中下标）串起来。
    // 走到这里还没被拦下的文章，去向只有两种：块生成失败、进了某一块。
    // （报告层退役后不再有 report_generation_failed 这条去向，统一记 block_write_failed。）
    // blockIdx 取它在 tieredWritten 里的位置——renderBriefV3 就是按这个顺序渲染的，
    // 所以它就是读者看到的块序。
    const blockIdxBySelected = new Map<number, number>();
    this.tieredWritten().forEach((b, k) => blockIdxBySelected.set(b.idx, k));
    const selectedIdxByArticle = new Map<number, number>();
    sel.selected.forEach((storyId, i) => {
      const ids = Array.isArray(this.stories[storyId].articleIds) ? this.stories[storyId].articleIds : [];
      for (const id of ids) if (!selectedIdxByArticle.has(id)) selectedIdxByArticle.set(id, i);
    });
    for (const [id, entry] of journey) {
      if (entry.droppedAt) continue;
      const selIdx = selectedIdxByArticle.get(id);
      if (selIdx === undefined) {
        // 上一关判它进了选择层，这一关却找不到归属块，说明两处口径对不上。宁可标 unknown 也不猜。
        entry.droppedAt = 'written';
        entry.dropReason = 'unknown';
        continue;
      }
      const blockIdx = blockIdxBySelected.get(selIdx);
      if (blockIdx === undefined) {
        entry.droppedAt = 'written';
        entry.dropReason = 'block_write_failed';
        continue;
      }
      entry.reachedStage = 'written';
      entry.blockIdx = blockIdx;
    }
    return journey;
  }
}
