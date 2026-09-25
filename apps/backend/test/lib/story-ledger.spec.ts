/**
 * 故事账本（lib/core/story-ledger.ts）：一期候选故事从选中到出块、再到文章去向的单一账本。
 * 纯内存，不 mock——喂真实的选择层与分层纯函数。
 */
import { describe, expect, it } from 'vitest';
import { StoryLedger } from '../../src/lib/core/story-ledger';
import { assignTiers } from '../../src/lib/core/brief-v3';
import type { StoryBlock } from '../../src/lib/core/cluster-blocks';

const story = (clusterId: number, articleIds: number[], importance: number, eventKey: string): StoryBlock => ({
  title: `story-${clusterId}`,
  importance,
  articleIds,
  storyType: 'event',
  clusterId,
  covers: '',
  eventKey,
});

// storyId = 候选数组下标
const stories: StoryBlock[] = [
  story(10, [2, 3, 4], 5, 'A'), // 0：分 7，被同事件配额挤掉
  story(11, [5, 6], 9, 'A'), //    1：分 10，选中第 1
  story(12, [7, 8], 1, 'B'), //    2：分 2，选中第 3，写块失败
  story(13, [9, 10], 7, 'A'), //   3：分 8.58，选中第 2
  story(15, [13, 14], 0, 'C'), //  4：分 1，排第 5，超出 top3
];
const coverage = { 0: 3, 1: 1, 2: 1, 3: 2, 4: 1 };
const datasetIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const clusters = [
  { clusterId: -1, articleIds: [1] },
  { clusterId: 10, articleIds: [2, 3, 4] },
  { clusterId: 11, articleIds: [5, 6] },
  { clusterId: 12, articleIds: [7, 8] },
  { clusterId: 13, articleIds: [9, 10] },
  { clusterId: 14, articleIds: [12] }, // 进了簇却不在任何块里（块物化时截掉）
  { clusterId: 15, articleIds: [13, 14] },
];

type Block = { idx: number; name: string };

function runThrough() {
  const ledger = new StoryLedger<Block>(stories);
  ledger.recordRowIds([101, 102, 103, 104, 105]);
  ledger.recordSourceCoverage(coverage);
  const sel = ledger.select({ coverageWeight: 1.0, maxStories: 3, perEventCap: 2 });
  const plan = assignTiers(ledger.tierInputs());
  ledger.recordTiers(plan);
  ledger.recordBlocks(
    [{ idx: 1, name: 'b-story3' }, { idx: 0, name: 'b-story1' }],
    [{ idx: 2 }]
  );
  return { ledger, sel, plan };
}

describe('StoryLedger', () => {
  it('storyId = 候选下标，贯穿选择 → 分层 → 出块', () => {
    const { ledger, sel } = runThrough();
    expect(ledger.selectedStoryIds()).toEqual([1, 3, 2]);
    expect(sel.selected).toEqual([stories[1], stories[3], stories[2]]);
    expect(sel.capped.map((x) => x.story)).toEqual([stories[0]]);
    // 分层按 selected 下标出 idx，源数钳到 [1, 篇数]
    expect(ledger.tierInputs()).toEqual([
      { idx: 0, articles: 2, sources: 1 },
      { idx: 1, articles: 2, sources: 2 },
      { idx: 2, articles: 2, sources: 1 },
    ]);
    expect(ledger.tierOfSelected(1)?.tier).toBe('lead');
    expect(ledger.tierOfSelected(99)).toBeUndefined();
  });

  it('selectedRowIds 与 selected 一一对应（按 storyId 取 brief_stories 主键）', () => {
    const { ledger } = runThrough();
    expect(ledger.selectedRowIds()).toEqual([102, 104, 103]);
  });

  it('tieredWritten 按分层顺序、只含出了块的', () => {
    const { ledger } = runThrough();
    // 分层：selected#1（分 4）在前，selected#0、#2（分 2）按原序；#2 写块失败
    expect(ledger.tieredWritten().map((b) => b.name)).toEqual(['b-story3', 'b-story1']);
  });

  it('usedArticleIds 排除写块失败的故事', () => {
    const { ledger } = runThrough();
    expect([...ledger.usedArticleIds()].sort((a, b) => a - b)).toEqual([5, 6, 9, 10]);
  });

  it('articleJourney 各去向', () => {
    const { ledger } = runThrough();
    const j = Object.fromEntries(ledger.articleJourney(datasetIds, clusters));
    const e = (
      clusterId: number | null,
      reachedStage: string,
      droppedAt: string | null,
      dropReason: string | null,
      blockIdx: number | null = null
    ) => ({ clusterId, reachedStage, droppedAt, dropReason, blockIdx });
    expect(j).toEqual({
      1: e(-1, 'clustered', 'clustered', 'noise'),
      11: e(null, 'clustered', 'clustered', 'not_in_any_cluster'),
      12: e(14, 'clustered', 'judged', 'block_article_cap'),
      2: e(10, 'judged', 'selected', 'per_event_cap_2'),
      3: e(10, 'judged', 'selected', 'per_event_cap_2'),
      4: e(10, 'judged', 'selected', 'per_event_cap_2'),
      13: e(15, 'judged', 'selected', 'rank_5_beyond_top3'),
      14: e(15, 'judged', 'selected', 'rank_5_beyond_top3'),
      7: e(12, 'selected', 'written', 'block_write_failed'),
      8: e(12, 'selected', 'written', 'block_write_failed'),
      9: e(13, 'written', null, null, 0),
      10: e(13, 'written', null, null, 0),
      5: e(11, 'written', null, null, 1),
      6: e(11, 'written', null, null, 1),
    });
    // 条目顺序 = 数据集顺序
    expect([...ledger.articleJourney(datasetIds, clusters).keys()]).toEqual(datasetIds);
  });

  it('articleJourney 只推到已记录的阶段（没选材就停在 judged）', () => {
    const ledger = new StoryLedger(stories);
    const j = ledger.articleJourney(datasetIds, clusters);
    expect(j.get(5)).toEqual({ clusterId: 11, reachedStage: 'judged', droppedAt: null, dropReason: null, blockIdx: null });
    expect(j.get(12)?.dropReason).toBe('block_article_cap');
  });

  it('每个阶段只记一次', () => {
    const { ledger } = runThrough();
    expect(() => ledger.recordRowIds([1])).toThrow();
    expect(() => ledger.recordSourceCoverage({})).toThrow();
    expect(() => ledger.select({ coverageWeight: 1, maxStories: 1, perEventCap: 1 })).toThrow();
    expect(() => ledger.recordTiers([])).toThrow();
    expect(() => ledger.recordBlocks([], [])).toThrow();
  });
});
