/**
 * Golden（characterization）快照的输入与算法调用。
 *
 * 每个 case 是一个零参数纯函数：吃 fixtures/ 下的固定生产数据，调真实的 src 代码，返回可 JSON
 * 序列化的完整输出。Oracle = 今天的输出（存在 __golden__/<name>.json）。
 * 这里不许出现 Date.now / Math.random / 任何 mock——输入全部固定，输出才可重放。
 *
 * spec（golden.spec.ts）在 workers pool 里跑、只比对；update-golden.ts 在 node 里跑、只写盘。
 */
import fixture from './fixtures/cron-brief-1790168539876.json';
import { blockImportance, dominantEntity, PER_EVENT_BLOCK_CAP } from '../../src/lib/core/storyline';
import { pickSpreadArticles, DEFAULT_ARTICLE_CAP } from '../../src/lib/core/story-dedup';
import {
  assembleBlocks,
  planBlocksFromJudgements,
  type JudgeOutcome,
  type PendingBlock,
  type StoryBlock,
} from '../../src/lib/core/cluster-blocks';
import { rankStoriesForIntelligence } from '../../src/lib/core/story-ranking';
import { StoryLedger } from '../../src/lib/core/story-ledger';
import { assignTiers, renderBriefV3 } from '../../src/lib/core/brief-v3';
import { generateSearchText } from '../../src/lib/core/utils';
import { looksLikeExtractionFailure } from '../../src/lib/core/extraction-quality';

type Article = (typeof fixture.articles)[number];
type Cluster = (typeof fixture.clusters)[number];

const articles: Article[] = fixture.articles;
const clusters: Cluster[] = fixture.clusters;
const titleOf = new Map<number, string>(articles.map((a) => [a.id, a.title]));
const sourceOf = new Map<number, number>(articles.map((a) => [a.id, a.sourceId]));
const distinctSources = (ids: number[]) => new Set(ids.map((i) => sourceOf.get(i)).filter((x) => x != null)).size;
/** 与 workflow 同口径：Date.parse(publishDate)，非有限值不进表 */
const publishedAt = new Map<number, number>(articles.map((a) => [a.id, Date.parse(a.publishedAt)]));

/** 快照统一过一遍 JSON：golden 文件里存的就是这个形状（undefined 字段消失、Map 须先转数组）。 */
export const toJson = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

// ── 生产链路重放：判定 → 块 → 选择 → 分层 → 渲染 ────────────────────────────
// 判定结果按生产落库的标题复原：标题恰好是裸专名（Rwanda / Trump，即 dominantEntity 兜底）
// 的两簇当 NO_EVENT、空标题；其余当 EVENT。event 生产不落库，填空串。
const FALLBACK_TITLED = new Set(['Rwanda', 'Trump']);
const prodOutcomes: JudgeOutcome[] = clusters.map((c) => ({
  clusterId: c.clusterId,
  ids: c.articleIds,
  res: FALLBACK_TITLED.has(c.prodTitle)
    ? { ok: true, value: { verdict: 'NO_EVENT', title: '', event: '', reason: 'reconstructed' } }
    : { ok: true, value: { verdict: 'EVENT', title: c.prodTitle, event: '', reason: 'reconstructed' } },
}));

const assembleDeps = { publishedAt, titleOf, distinctSources };
const prodPlan = () => planBlocksFromJudgements(prodOutcomes, titleOf);
const prodBlocks = () => assembleBlocks(prodPlan().pending, assembleDeps);

/** 固定的 LLM 序（合成，生产那期的真实 LLM 序只在 R2 里）：含重复、越界、负数下标 */
const SYNTHETIC_LLM_ORDER = [5, 0, 38, 12, 3, 7, 1, 20, 2, 9, 4, 30, 5, 999, -1];

const briefRef = (s: StoryBlock) => ({ clusterId: s.clusterId, title: s.title });

/** 选择层走 workflow 用的同一个故事账本；分层输入也由账本给（ledger.tierInputs）。 */
function rank(blocks: StoryBlock[], llmOrder?: number[]) {
  const coverage: Record<number, number> = {};
  blocks.forEach((s, i) => { coverage[i] = distinctSources(s.articleIds); });
  const ledger = new StoryLedger(blocks);
  ledger.recordSourceCoverage(coverage);
  const res = ledger.select({ coverageWeight: 1.0, maxStories: 25, perEventCap: PER_EVENT_BLOCK_CAP, llmOrder });
  return { ...res, ledger };
}

export const GOLDEN_CASES: Record<string, () => unknown> = {
  /** storyline.ts：每个生产簇的事件键与显著性分，外加 blockImportance 的整张小表。 */
  storyline: () => ({
    PER_EVENT_BLOCK_CAP,
    perCluster: clusters.map((c) => {
      const srcs = distinctSources(c.articleIds);
      return {
        clusterId: c.clusterId,
        articles: c.articleIds.length,
        distinctSources: srcs,
        dominantEntity: dominantEntity(c.articleIds.map((id) => titleOf.get(id) ?? '')),
        blockImportance: blockImportance(srcs, c.articleIds.length),
        prodImportance: c.prodImportance,
      };
    }),
    // 边界：0 / 负数被钳到 0、上限 10、源数权重是篇数的 2 倍
    importanceTable: [
      [0, 0], [-3, -3], [1, 1], [1, 3], [2, 2], [3, 3], [3, 30], [5, 5], [8, 16], [10, 30], [30, 30], [100, 1000],
    ].map(([s, a]) => ({ sources: s, articles: a, importance: blockImportance(s, a) })),
    // 边界：空 / 无专名 / 所有格 / 连字符 / 词形归并 / 并列取字典序
    dominantEntityEdges: [
      [],
      [''],
      ['the and but'],
      ["Nepal's floods", 'Nepal’s rescue', 'Nepal-Tibet road cut'],
      ['Russian drones hit Kyiv', 'Russia says talks stalled'],
      ['Zebra wins', 'Apple wins'],
      ['The Video Watch Live'],
    ].map((titles) => ({ titles, key: dominantEntity(titles) })),
  }),

  /** story-dedup.ts：每簇的时间均匀取样（生产顺序一并留存对照），加上超上限的大集合。 */
  storyDedup: () => {
    const all = articles.map((a) => a.id);
    // 一半 id 抹掉时间戳：缺时间戳的排最后、不参与均匀取样
    const halfKnown = new Map([...publishedAt].filter(([id]) => id % 2 === 0));
    return {
      DEFAULT_ARTICLE_CAP,
      perCluster: clusters.map((c) => ({
        clusterId: c.clusterId,
        picked: pickSpreadArticles(c.articleIds, publishedAt),
        prodArticleOrder: c.prodArticleOrder,
      })),
      all177Cap30: pickSpreadArticles(all, publishedAt),
      all177Cap60: pickSpreadArticles(all, publishedAt, 60),
      all177Cap7: pickSpreadArticles(all, publishedAt, 7),
      all177HalfUnknownCap30: pickSpreadArticles(all, halfKnown, 30),
      all177HalfUnknownCap100: pickSpreadArticles(all, halfKnown, 100),
      allUnknownCap5: pickSpreadArticles(all.slice(0, 12), new Map(), 5),
      empty: pickSpreadArticles([], publishedAt),
    };
  },

  /** cluster-blocks.ts：生产 39 簇原样走一遍，外加失败 / 同名合并 / 超 30 篇截断的场景。 */
  clusterBlocks: () => {
    const plan = prodPlan();
    const asm = prodBlocks();

    // 合成场景，文章与标题都取自同一期生产数据
    const byCid = new Map(clusters.map((c) => [c.clusterId, c.articleIds]));
    const edgeOutcomes: JudgeOutcome[] = [
      { clusterId: 12, ids: byCid.get(12)!, res: { ok: false, error: 'HTTP 500' } },
      { clusterId: 10, ids: byCid.get(10)!, res: { ok: true, value: { verdict: 'UNSURE', title: '   ', event: 'x', reason: 'r' } } },
      { clusterId: 4, ids: byCid.get(4)!, res: { ok: true, value: { verdict: 'EVENT', title: 'Trump at the UN', event: 'a', reason: 'r' } } },
      { clusterId: 51, ids: byCid.get(51)!, res: { ok: true, value: { verdict: 'EVENT', title: '  trump AT the un ', event: 'b', reason: 'r' } } },
      { clusterId: 109, ids: byCid.get(109)!, res: { ok: true, value: { verdict: 'NO_EVENT', title: 'Trump at the UN', event: 'c', reason: 'r' } } },
    ];
    const edgePlan = planBlocksFromJudgements(edgeOutcomes, titleOf);
    // 5 个大簇并成 45 篇的一块 → 截到 30；再并一个与它同名、部分重叠的块
    const bigIds = [12, 61, 5, 10, 34].flatMap((cid) => byCid.get(cid)!).sort((x, y) => x - y);
    const oversize: PendingBlock[] = [
      { clusterId: 900, title: 'Oversize block', covers: 'big', ids: bigIds },
      { clusterId: 901, title: 'OVERSIZE BLOCK', covers: 'overlap', ids: [...byCid.get(41)!, ...byCid.get(12)!] },
      { clusterId: 902, title: 'Solo', covers: '', ids: [byCid.get(65)![0]] },
    ];
    return {
      prod: { plan, assembled: asm },
      edge: {
        plan: edgePlan,
        assembled: assembleBlocks(edgePlan.pending, assembleDeps),
        oversize: assembleBlocks(oversize, assembleDeps),
        oversizeCap10: assembleBlocks(oversize, { ...assembleDeps, cap: 10 }),
      },
    };
  },

  /** story-ranking.ts：生产块上的选择层——纯机械序，和一条固定 LLM 序拼接的版本。 */
  storyRanking: () => {
    const { blocks } = prodBlocks();
    const view = (r: ReturnType<typeof rank>) => ({
      ranked: r.ranked.map((x) => ({ ...briefRef(x.story), eventKey: x.story.eventKey, srcs: x.srcs, score: x.score })),
      selected: r.selected.map(briefRef),
      capped: r.capped.map((x) => briefRef(x.story)),
    });
    // 同事件配额：全塞同一个 eventKey，看跳过而不是截断
    const sameKey = blocks.slice(0, 10).map((b) => ({ ...b, eventKey: 'Trump' }));
    return {
      mechanical: view(rank(blocks)),
      withLlmOrder: view(rank(blocks, SYNTHETIC_LLM_ORDER)),
      allSameEventKey: view(rank(sameKey)),
      noCapNoKey: rankStoriesForIntelligence(
        blocks.slice(0, 8).map((b) => ({ title: b.title, importance: b.importance })),
        { 0: 3, 1: 0, 2: 9, 5: 1 },
        { coverageWeight: 0.5, maxStories: 6 }
      ),
    };
  },

  /** brief-v3.ts：选择结果 → 分层（重排 / 保序）→ 三节 markdown。块正文是合成占位句。 */
  briefV3: () => {
    const { blocks } = prodBlocks();
    const mech = rank(blocks);
    const llm = rank(blocks, SYNTHETIC_LLM_ORDER);
    const selectedMech = mech.selected;
    const selectedLlm = llm.selected;
    const tiersMech = assignTiers(mech.ledger.tierInputs());
    const tiersLlm = assignTiers(llm.ledger.tierInputs(), { preserveOrder: true });

    // 渲染输入与 workflow 同口径：按分层顺序、标题小写后传入。第 3 块正文为空白，应被跳过。
    const renderInput = (sel: StoryBlock[], plan: typeof tiersMech) =>
      plan.map((p, k) => {
        const s = sel[p.idx];
        return {
          title: s.title.trim().toLowerCase(),
          text: k === 2 ? '   ' : `  Placeholder for "${s.title}": ${p.articles} articles, ${p.sources} sources.\n`,
          tier: p.tier,
        };
      });
    return {
      tiersMechanical: tiersMech,
      tiersLlmPreserveOrder: tiersLlm,
      renderedMechanical: renderBriefV3(renderInput(selectedMech, tiersMech)),
      renderedLlm: renderBriefV3(renderInput(selectedLlm, tiersLlm)),
      // 边界：空输入 / 只有简讯 / 故事不足 4 条 / 同分保序 / 原样标题（大小写与空白）
      renderEmpty: renderBriefV3([]),
      renderOnlyBrief: renderBriefV3([{ title: '  Mixed Case  ', text: ' only ', tier: 'brief' }]),
      tiersFew: assignTiers([{ articles: 2, sources: 1 }, { articles: 3, sources: 3 }, { articles: 1, sources: 1 }]),
      tiersTies: assignTiers(Array.from({ length: 16 }, (_, i) => ({ articles: i % 3 === 0 ? 4 : 2, sources: 2, i }))),
    };
  },

  /** utils.ts generateSearchText：29 篇生产文章的标签字段（摘要点换成合成句），加空值边界。 */
  searchText: () => {
    const withMeta = articles.filter((a) => 'analysis' in a && a.analysis);
    const synthPoints = [['First point', 'second point.'], [], null, ['  ', 'Only point  ']];
    return {
      production: withMeta.map((a, i) => {
        const an = (a as Article & { analysis: Record<string, unknown> }).analysis;
        return {
          id: a.id,
          text: generateSearchText({
            title: a.title,
            ...an,
            event_summary_points: synthPoints[i % synthPoints.length],
          } as Parameters<typeof generateSearchText>[0]),
        };
      }),
      edges: [
        { title: '' },
        { title: '  Title.  ', primary_location: 'Global' },
        { title: 'T', primary_location: ' n/a ', key_entities: ['', ' A ', 'B.'] },
        { title: 'T', primary_location: 'Kathmandu', thematic_keywords: null, topic_tags: ['x'] },
      ].map((d) => generateSearchText(d as unknown as Parameters<typeof generateSearchText>[0])),
    };
  },

  /** extraction-quality.ts looksLikeExtractionFailure：各签名、800 字门、nav stub（全部合成文本）。 */
  extractionQuality: () => {
    const long = (s: string) => s + ' filler'.repeat(150);
    return [
      '',
      '   \n ',
      'To display this content from YouTube, you must enable advertisement tracking and audience measurement.',
      long('To display this content from YouTube.'),
      'Access Denied. You don\'t have permission to access this server.',
      long('Page not found'),
      'Please log in to see this page.',
      'Our abuse detection mechanism flagged too many requests.',
      'All trademarks are property of their respective owners.',
      long('This stream is best experienced in the app.'),
      'Skip to main content. Navigation menu.',
      long('Skip to content'),
      'A normal short news sentence about a flood in Nepal.',
      long('A normal long article.'),
    ].map((text) => ({ len: text.length, head: text.slice(0, 60), result: looksLikeExtractionFailure(text) }));
  },
};
