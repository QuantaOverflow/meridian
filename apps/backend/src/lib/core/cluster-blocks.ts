/**
 * 簇 → 简报块的**纯逻辑**：判定结果怎么变成块、块怎么合并与物化。
 *
 * 从 `auto-brief-generation.ts` 的「簇判定」step 里抽出来，只为一件事——**能单测**。
 * I/O（调 ai-worker、查 source_id）留在 workflow，这里只吃已经拿到的数据。
 *
 * 抽出来的函数对应 step 里最容易出错、且失败时最难发现的逻辑：
 *  · `planBlocksFromJudgements` —— 判定失败必须与 NO_EVENT 分开。把失败读成「这簇没有故事」
 *    会让一次网络抖动毙掉一条真新闻，这个仓库栽过（调用失败伪装成 NO_STORIES 骗了一整轮）。
 *  · `mergeSameEventBlocks` —— 聚类把同一件事拆成几个簇时，按质心余弦把它们合回一块。
 *  · `assembleBlocks` —— 同事件合并与 30 篇截断的**顺序**：先合后截。反过来会对同一个块
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

/** 未截断的块。截断推迟到同事件合并之后。 */
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

/**
 * 同一件事被聚类拆成多块时，合回一块的余弦门槛（组间 average link）。
 *
 * 来历：原型 `apps/backend/prototypes/block-merge/`（仅本地，`baseline.py`），金标 `eval/_data/block-merge-v1`。
 * 门槛在 tune 4 期上按开跑前写死的规则挑（「剩余重复 + 合错块」最小，并列取高的），0.93–0.935 读数相同。
 * 读数（剩余重复 = 读者还能看到的重复处；合错 = 把不同的事合进一块）：
 *   开发集 8 期：重复 22 → 6，合错 3 块
 *   封存考卷 2 期：重复 1 → 0，合错 1 块
 *   10 期总块数 245 → 221
 * 合错的主要来源是 spill（A 簇混进讲 B 事的文章，把质心拉近）与同主题不同事；漏合的是
 * 同一次访问里相似度偏低的环节（0.90–0.92）。用户 2026-09-29 决定先治合并、放宽准入。
 * @internal 导出只给单测；生产在本文件内用
 */
export const SAME_EVENT_MERGE_THRESHOLD = 0.935;

/** 一次同事件合并的观测记录（进日志与 story_validation 的 observability）。 */
export interface SameEventMerge {
  /** 合并后沿用的主块（篇数最多那块）的 clusterId 与标题 */
  clusterId: number;
  title: string;
  /** 全部成员（含主块），按 clusterId 升序。cosToLead = 与主块质心的余弦 */
  members: Array<{ clusterId: number; title: string; articles: number; cosToLead: number }>;
  /** 每一步合并时两组的 average link 值，按合并先后 */
  links: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** 成员文章 embedding 的算术平均；缺 embedding 的文章跳过，一篇都没有时返回 null。 */
export function meanEmbedding(ids: number[], embeddingOf: ReadonlyMap<number, number[]>): number[] | null {
  let sum: number[] | null = null;
  let n = 0;
  for (const id of ids) {
    const e = embeddingOf.get(id);
    if (!e) continue;
    if (!sum) sum = new Array<number>(e.length).fill(0);
    for (let i = 0; i < e.length; i++) sum[i] += e[i];
    n++;
  }
  return sum ? sum.map((x) => x / n) : null;
}

/**
 * 期内同事件合并：按块质心余弦做 average link 层次聚合，门槛 `SAME_EVENT_MERGE_THRESHOLD`。
 *
 * 病灶：判定是按簇独立跑的，聚类把同一件事切成几个簇时，每个簇各写一块（2026-09-29 错误分析：
 * 习近平访美的抵达 / 峰会 / 国宴 / 赠熊猫各占一块，8 期 195 块里这是头号问题）。
 * 取代了两处旧补丁：逐字同名才合的跨簇合并（近义标题合不上），与选择层按主导专名的同事件配额
 * （键是 "Trump" 这类人名，会把共享人名的不同事件也挤掉）。
 *
 * 算法与原型 `baseline.py` 的 `agglomerate(..., 'average')` 一致：组间相似度 = 两组成员块质心
 * 两两余弦的平均；每轮合并当前最相似的一对组，直到最高值 < 门槛。
 *
 * 确定性（workflow 重放必须得到同一结果）：参与合并的块先按 (clusterId, 首篇 id) 排成规范序，
 * 组按规范序里最小成员排列，平局取规范序里靠前的那对——结果与输入顺序无关。
 *
 * 输出：未参与或没合的块原样保留在原位置；合并块放在其成员在输入里最早出现的位置，
 * ids 取并集升序，clusterId / title / covers 取篇数最多的成员（平局取 clusterId 小的）。
 * 质心为 null（没有任何成员文章有 embedding）的块不参与合并。
 * @internal 导出只给单测；生产经 assembleBlocks 调用
 */
export function mergeSameEventBlocks(
  pending: PendingBlock[],
  centroidOf: (block: PendingBlock) => number[] | null
): { blocks: PendingBlock[]; merges: SameEventMerge[] } {
  const canon = (a: PendingBlock, b: PendingBlock) => a.clusterId - b.clusterId || (a.ids[0] ?? 0) - (b.ids[0] ?? 0);
  const withC = pending
    .map((block) => ({ block, c: centroidOf(block) }))
    .filter((x): x is { block: PendingBlock; c: number[] } => x.c !== null)
    .sort((x, y) => canon(x.block, y.block));
  const n = withC.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) sim[i][j] = sim[j][i] = cosine(withC[i].c, withC[j].c);
  }

  // 每组：成员在规范序里的下标 + 每步合并的 link 值。组按首个成员（即最小下标）排列
  const groups = withC.map((_, i) => ({ members: [i], links: [] as number[] }));
  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let s = 0;
        for (const a of groups[i].members) for (const b of groups[j].members) s += sim[a][b];
        const v = s / (groups[i].members.length * groups[j].members.length);
        if (v > best) { best = v; bi = i; bj = j; }
      }
    }
    if (bi < 0 || best < SAME_EVENT_MERGE_THRESHOLD) break;
    groups[bi] = {
      members: [...groups[bi].members, ...groups[bj].members],
      links: [...groups[bi].links, ...groups[bj].links, best],
    };
    groups.splice(bj, 1);
  }

  // 被合并掉的块 → 所属组的合并结果；合并块放在成员里最早出现的位置
  const replaced = new Map<PendingBlock, PendingBlock | null>();
  const merges: SameEventMerge[] = [];
  for (const g of groups) {
    if (g.members.length < 2) continue;
    const members = g.members.map((i) => withC[i]).sort((x, y) => canon(x.block, y.block));
    const lead = members.reduce((best, m) => (m.block.ids.length > best.block.ids.length ? m : best));
    const block: PendingBlock = {
      clusterId: lead.block.clusterId,
      title: lead.block.title,
      covers: lead.block.covers,
      ids: [...new Set(members.flatMap((m) => m.block.ids))].sort((x, y) => x - y),
    };
    const first = pending.find((b) => members.some((m) => m.block === b))!;
    for (const m of members) replaced.set(m.block, m.block === first ? block : null);
    merges.push({
      clusterId: block.clusterId,
      title: block.title,
      members: members.map((m) => ({
        clusterId: m.block.clusterId,
        title: m.block.title,
        articles: m.block.ids.length,
        cosToLead: round4(m === lead ? 1 : cosine(m.c, lead.c)),
      })),
      links: g.links.map(round4),
    });
  }

  const blocks: PendingBlock[] = [];
  for (const b of pending) {
    if (!replaced.has(b)) blocks.push(b);
    else if (replaced.get(b)) blocks.push(replaced.get(b)!);
  }
  return { blocks, merges };
}

export interface StoryBlock {
  title: string;
  importance: number;
  articleIds: number[];
  storyType: string;
  clusterId: number;
  /** 主线的 covers 一句话，纯观测 */
  covers: string;
}

export interface AssembleStats {
  /** 被 30 篇上限截过的块数 */
  cappedBlocks: number;
  /** 截断丢掉的文章数 */
  droppedArticles: number;
  /** 同事件合并的次数（每并掉一块记 1） */
  sameEventMerges: number;
  /** 同事件合并清单：各成员标题与余弦 */
  merges: SameEventMerge[];
}

/**
 * 同事件合并 → 截 30 篇 → 算分。
 *
 * **合并**：见 `mergeSameEventBlocks`。质心由调用方注入（生产 = 块内全部成员文章 e5 embedding 的均值）。
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
    distinctSources: (ids: number[]) => number;
    centroidOf: (block: PendingBlock) => number[] | null;
    cap?: number;
  }
): { blocks: StoryBlock[]; stats: AssembleStats } {
  const cap = deps.cap ?? DEFAULT_ARTICLE_CAP;
  const { blocks: merged, merges } = mergeSameEventBlocks(pending, deps.centroidOf);
  const stats: AssembleStats = {
    cappedBlocks: 0,
    droppedArticles: 0,
    sameEventMerges: merges.reduce((n, m) => n + m.members.length - 1, 0),
    merges,
  };

  const blocks = merged.map((b): StoryBlock => {
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
    };
  });
  return { blocks, stats };
}
