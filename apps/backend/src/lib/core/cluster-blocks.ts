/**
 * 簇 → 简报块的**纯逻辑**：判定结果怎么变成块、块怎么合并与物化。
 *
 * 从 `auto-brief-generation.ts` 的「簇判定」step 里抽出来，只为一件事——**能单测**。
 * I/O（调 ai-worker、查 source_id）留在 workflow，这里只吃已经拿到的数据。
 *
 * 抽出来的两个函数对应 step 里两段最容易出错、且失败时最难发现的逻辑：
 *  · `planBlocksFromJudgements` —— 判定失败必须与 NO_EVENT 分开。把失败读成「这簇没有故事」
 *    会让一次网络抖动毙掉一条真新闻，这个仓库栽过（调用失败伪装成 NO_STORIES 骗了一整轮）。
 *  · `assembleBlocks` —— 跨簇同名合并与 30 篇截断的**顺序**：先合后截。反过来会对同一个块
 *    采样两次，且合并后的篇数不对。
 */
import { blockImportance, dominantEntity } from './storyline';
import { DEFAULT_ARTICLE_CAP, pickSpreadArticles } from './story-dedup';

/** 判定结果：ok 时带模型输出，否则带错误原因。形状与 `AIWorkerService.judgeCluster` 的返回一致。 */
export type JudgeResult =
  | { ok: true; value: { verdict: 'EVENT' | 'NO_EVENT' | 'UNSURE'; title: string; event: string; reason: string } }
  | { ok: false; error: string };

export interface JudgeOutcome {
  clusterId: number;
  /** 该簇的**全部**文章（不是喂给判定的采样子集） */
  ids: number[];
  res: JudgeResult;
}

/** 未截断的块。截断推迟到跨簇合并之后。 */
export interface PendingBlock {
  clusterId: number;
  title: string;
  covers: string;
  ids: number[];
}

export interface PlanStats {
  /** 判定调用失败（含解析失败）的簇数。正常值 0 */
  judgeFailures: number;
  /** 判为 NO_EVENT 的簇数。只标记不丢弃 */
  pocketFlagged: number;
  /** 判为 UNSURE 的簇数 */
  unsureClusters: number;
}

/**
 * 判定结果 → 未截断的块。**每个簇恰好产出一块，一个都不丢。**
 *
 * 三条不变量（测试逐条断言）：
 *  1. 输出块数 == 输入簇数，且文章总数守恒
 *  2. 判定失败 → 仍然出块，标题用零 LLM 的主导专名（不是丢弃、也不是空标题）
 *  3. NO_EVENT / UNSURE → 仍然出块，只进计数
 */
export function planBlocksFromJudgements(
  outcomes: JudgeOutcome[],
  titleOf: Map<number, string>
): { pending: PendingBlock[]; stats: PlanStats } {
  const pending: PendingBlock[] = [];
  const stats: PlanStats = { judgeFailures: 0, pocketFlagged: 0, unsureClusters: 0 };

  for (const { clusterId, ids, res } of outcomes) {
    const fallbackTitle = () => dominantEntity(ids.map(id => titleOf.get(id) ?? ''));

    if (!res.ok) {
      // 判定失败 ≠ NO_EVENT。失败走退化：整簇保留成一块，名字用零 LLM 的主导专名。
      stats.judgeFailures++;
      pending.push({ clusterId, title: fallbackTitle(), covers: '', ids });
      continue;
    }
    const { verdict, title, event } = res.value;
    if (verdict === 'NO_EVENT') stats.pocketFlagged++;
    if (verdict === 'UNSURE') stats.unsureClusters++;
    // 标题兜底：模型没给名字（NO_EVENT 时按 prompt 就该留空）→ 用主导专名，不留空格名
    pending.push({ clusterId, title: title.trim() || fallbackTitle(), covers: event, ids });
  }
  return { pending, stats };
}

export interface StoryBlock {
  title: string;
  importance: number;
  articleIds: number[];
  storyType: string;
  clusterId: number;
  covers: string;
  eventKey: string;
}

export interface AssembleStats {
  /** 被 30 篇上限截过的块数 */
  cappedBlocks: number;
  /** 截断丢掉的文章数 */
  droppedArticles: number;
  /** 跨簇同名合并的次数 */
  crossClusterMerges: number;
}

/**
 * 跨簇同名合并 → 截 30 篇 → 算分。
 *
 * **合并**：判定是按簇独立跑的，一次只看一个簇。聚类把同一个事件分到两个簇时，两边各自起出
 * 逐字相同的名字（2026-09-04 实测簇 55 与簇 54 都产出 `Nepal-Tibet flash floods`，读者在
 * 一份简报里看到两个同名的格）。判据只认**逐字相同**（去空白、忽略大小写）——近义合并要判
 * 语义，那是另一回事，且误合的代价（两件事塞进一格）正是这轮刚治好的病。
 *
 * **截断**：一块最多 `DEFAULT_ARTICLE_CAP` 篇，按时间等距取样、两端锚定。不是优化是必须——
 * 91 篇（283k 字符）→ 300 秒超时硬失败，67 篇的块把情报分析打成 HTTP 500。
 *
 * **顺序不能反**：先截后合会对同一个块采样两次，且合并后的篇数不对。
 */
export function assembleBlocks(
  pending: PendingBlock[],
  deps: {
    publishedAt: Map<number, number>;
    titleOf: Map<number, string>;
    distinctSources: (ids: number[]) => number;
    cap?: number;
  }
): { blocks: StoryBlock[]; stats: AssembleStats } {
  const cap = deps.cap ?? DEFAULT_ARTICLE_CAP;
  const stats: AssembleStats = { cappedBlocks: 0, droppedArticles: 0, crossClusterMerges: 0 };

  const materialize = (b: PendingBlock): StoryBlock => {
    const picked = pickSpreadArticles(b.ids, deps.publishedAt, cap);
    if (picked.length < b.ids.length) {
      stats.cappedBlocks++;
      stats.droppedArticles += b.ids.length - picked.length;
    }
    return {
      title: b.title,
      importance: blockImportance(deps.distinctSources(picked), picked.length),
      articleIds: picked,
      storyType: 'SINGLE_STORY',
      clusterId: b.clusterId,
      covers: b.covers,
      eventKey: dominantEntity(picked.map(id => deps.titleOf.get(id) ?? '')),
    };
  };

  const byTitle = new Map<string, PendingBlock[]>();
  for (const b of pending) {
    const k = b.title.trim().toLowerCase();
    byTitle.set(k, [...(byTitle.get(k) ?? []), b]);
  }

  const blocks: StoryBlock[] = [];
  for (const group of byTitle.values()) {
    if (group.length === 1) {
      blocks.push(materialize(group[0]));
      continue;
    }
    // 取篇数最多的那块的 clusterId 与 covers，文章取并集
    const lead = [...group].sort((a, b) => b.ids.length - a.ids.length)[0];
    const ids = [...new Set(group.flatMap(g => g.ids))].sort((x, y) => x - y);
    stats.crossClusterMerges += group.length - 1;
    blocks.push(materialize({ clusterId: lead.clusterId, title: lead.title, covers: lead.covers, ids }));
  }
  return { blocks, stats };
}
