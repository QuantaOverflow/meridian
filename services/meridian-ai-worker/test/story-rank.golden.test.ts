// @vitest-environment node
/**
 * Golden-master 测试：`rankStories`（src/services/story-rank.ts），/meridian/stories/rank
 * 路由的排序 + Borda 聚合核心。三轮洗牌调用与 JSON 解析都是**注入**进来的（`callOnce` /
 * `parseJson` 参数，见该文件顶部注释），本来就不碰网络——把 callOnce 换成按序回放三条
 * 真实响应、parseJson 换成生产同一个 `parseJSONFromResponse`，就是在跑生产同一段聚合代码，
 * 不是 mock。
 *
 * 输入是生产 run `cron-brief-1790168539876` 的三条真实 story_rank 响应（一轮一条，全部
 * 一次过、未触发轮内重试），只存 `response.content`。
 *
 * candidates 是 rankStories 需要的最小非文章上下文：只有 id 需要与三轮响应引用的 id 对上
 * （`valid.has(id)` 那道闸），title/articles 不影响聚合结果（candidates 只用来拼 prompt，
 * 这里 callOnce 不读 prompt），所以用占位符，不还原真实标题。
 *
 * 重新生成金标：`UPDATE_GOLDEN=1 npx vitest run test/story-rank.golden.test.ts`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import type { RankCandidate, StoryRankResult } from '@meridian/contracts';
import { rankStories } from '../src/services/story-rank';
import { parseJSONFromResponse } from '../src/utils/common';

const PATH = new URL('./golden/story-rank/three-rounds.json', import.meta.url).pathname;

interface Fixture {
  note: string;
  sourceKeys: string[];
  sourceRun: string;
  candidateIdRange: [number, number];
  roundInputs: string[];
  expected?: StoryRankResult;
}

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(PATH, 'utf8')) as Fixture;
}

async function run(fx: Fixture): Promise<StoryRankResult> {
  const [lo, hi] = fx.candidateIdRange;
  const candidates: RankCandidate[] = [];
  for (let id = lo; id <= hi; id++) candidates.push({ id, title: `placeholder story ${id}`, articles: 1 });

  let callIndex = 0;
  const callOnce = async (_prompt: string): Promise<string> => {
    const content = fx.roundInputs[callIndex];
    callIndex++;
    if (content === undefined) throw new Error(`fixture exhausted at call ${callIndex}`);
    return content;
  };

  return rankStories(candidates, callOnce, parseJSONFromResponse);
}

describe('rankStories 金标（cron-brief-1790168539876 真实三轮产出）', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = loadFixture();
    if (process.env.UPDATE_GOLDEN !== '1') return;
    fx.expected = await run(fx);
    writeFileSync(PATH, JSON.stringify(fx, null, 2) + '\n', 'utf8');
  });

  it('三轮真实响应都回放到位（不是空跑）', () => {
    expect(fx.roundInputs.length).toBe(3);
  });

  it('聚合结果与金标逐字相等', async () => {
    expect(fx.expected, '缺 expected —— 先跑 UPDATE_GOLDEN=1 生成金标').not.toBeUndefined();
    const actual = await run(fx);
    expect(actual).toEqual(fx.expected);
  });

  it('反向对照：三轮全部一次过（roundsOk=3），否则上面那条等于没测重试路径之外的主路径', async () => {
    const actual = await run(fx);
    expect(actual.roundsOk).toBe(3);
    expect(actual.rounds.every(r => r.ok && !r.retried)).toBe(true);
    expect(actual.picks.length).toBe(12);
  });
});
