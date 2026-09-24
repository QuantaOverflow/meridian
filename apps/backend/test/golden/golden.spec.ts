/**
 * 简报链路纯函数的 golden（characterization）快照测试。
 *
 * 输入：fixtures/ 里一期真实生产 run 的形状数据（见 fixture 的 provenance）。
 * Oracle：__golden__/<case>.json = 写快照那天的输出。任何差异都失败——重构不许改行为。
 * 行为是**有意**改的，才跑 `UPDATE_GOLDEN=1 npx tsx test/golden/update-golden.ts` 重写快照，
 * 并在 commit 里说明为什么变。
 */
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES, toJson } from './cases';
import storyline from './__golden__/storyline.json';
import storyDedup from './__golden__/storyDedup.json';
import clusterBlocks from './__golden__/clusterBlocks.json';
import storyRanking from './__golden__/storyRanking.json';
import briefV3 from './__golden__/briefV3.json';
import searchText from './__golden__/searchText.json';
import extractionQuality from './__golden__/extractionQuality.json';

const GOLDEN: Record<string, unknown> = {
  storyline,
  storyDedup,
  clusterBlocks,
  storyRanking,
  briefV3,
  searchText,
  extractionQuality,
};

describe('golden: 简报链路纯函数', () => {
  it('每个 case 都有 golden 文件，且没有孤儿 golden', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(GOLDEN_CASES).sort());
  });

  for (const name of Object.keys(GOLDEN_CASES)) {
    it(name, () => {
      expect(toJson(GOLDEN_CASES[name]())).toEqual(GOLDEN[name]);
    });
  }
});
