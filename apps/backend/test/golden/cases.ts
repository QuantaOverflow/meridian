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

type Article = (typeof fixture.articles)[number];
type Cluster = (typeof fixture.clusters)[number];

const articles: Article[] = fixture.articles;
const clusters: Cluster[] = fixture.clusters;
const titleOf = new Map<number, string>(articles.map((a) => [a.id, a.title]));
const sourceOf = new Map<number, number>(articles.map((a) => [a.id, a.sourceId]));
const distinctSources = (ids: number[]) => new Set(ids.map((i) => sourceOf.get(i)).filter((x) => x != null)).size;

/** 快照统一过一遍 JSON：golden 文件里存的就是这个形状（undefined 字段消失、Map 须先转数组）。 */
export const toJson = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

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
};
