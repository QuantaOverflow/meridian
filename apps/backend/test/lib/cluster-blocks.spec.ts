/**
 * 簇判定 step 的组件测试。
 *
 * 测的是 2026-09-05/06 新加的那条链路里**最容易错、且错了在日志里不显眼**的两段：
 *   判定结果 → 块（`planBlocksFromJudgements`）
 *   块 → 跨簇合并 → 截断 → 打分（`assembleBlocks`）
 *
 * 外加客户端契约（`AIWorkerService.judgeCluster`）：HTTP 非 200 / `success:false` 必须回
 * `ok:false`，**不能**被上游读成「这簇没有故事」。这一条是这个仓库栽过的坑
 * （调用失败伪装成 NO_STORIES 骗了一整轮）。
 */
import { describe, expect, it } from 'vitest';
import {
  assembleBlocks,
  planBlocksFromJudgements,
  type JudgeOutcome,
  type PendingBlock,
} from '../../src/lib/core/cluster-blocks';
import { createAIServices } from '../../src/lib/services/ai-services';

const ok = (verdict: 'EVENT' | 'NO_EVENT' | 'UNSURE', title = '标题', event = '一句话') =>
  ({ ok: true as const, value: { verdict, title, event, reason: '理由' } });

const titles = (pairs: Array<[number, string]>) => new Map<number, string>(pairs);

describe('planBlocksFromJudgements', () => {
  const titleOf = titles([
    [1, 'Nepal floods kill 200'],
    [2, 'Nepal rescue teams reach Rasuwa'],
    [3, 'Nepal flood toll rises'],
  ]);

  it('每个簇恰好产出一块，文章一篇不丢', () => {
    const outcomes: JudgeOutcome[] = [
      { clusterId: 1, ids: [1, 2], res: ok('EVENT') },
      { clusterId: 2, ids: [3], res: ok('NO_EVENT', '') },
      { clusterId: 3, ids: [1, 3], res: { ok: false, error: 'HTTP 500' } },
    ];
    const { pending } = planBlocksFromJudgements(outcomes, titleOf);

    expect(pending).toHaveLength(3);
    expect(pending.flatMap(b => b.ids).length).toBe(5);
    expect(pending.map(b => b.clusterId)).toEqual([1, 2, 3]);
  });

  it('判定失败 ≠ NO_EVENT：仍然出块，只进 judgeFailures 计数', () => {
    const { pending, stats } = planBlocksFromJudgements(
      [{ clusterId: 7, ids: [1, 2], res: { ok: false, error: '判定调用抛异常' } }],
      titleOf
    );

    expect(stats.judgeFailures).toBe(1);
    expect(stats.pocketFlagged).toBe(0); // 关键：没被误记成题材袋
    expect(pending).toHaveLength(1);
    expect(pending[0].ids).toEqual([1, 2]);
    // 退化标题走零 LLM 的主导专名，不是空串
    expect(pending[0].title.length).toBeGreaterThan(0);
    expect(pending[0].title).toBe('Nepal');
  });

  it('NO_EVENT 只标记不丢弃，且空标题回落到主导专名', () => {
    const { pending, stats } = planBlocksFromJudgements(
      [{ clusterId: 9, ids: [1, 2], res: ok('NO_EVENT', '  ') }],
      titleOf
    );

    expect(stats.pocketFlagged).toBe(1);
    expect(pending).toHaveLength(1); // 没被丢掉
    expect(pending[0].title).toBe('Nepal');
  });

  it('UNSURE 单独计数，同样出块', () => {
    const { pending, stats } = planBlocksFromJudgements(
      [{ clusterId: 5, ids: [1], res: ok('UNSURE', '拿不准') }],
      titleOf
    );
    expect(stats.unsureClusters).toBe(1);
    expect(stats.pocketFlagged).toBe(0);
    expect(pending).toHaveLength(1);
  });

  it('EVENT 用模型给的标题，event 进 covers', () => {
    const { pending, stats } = planBlocksFromJudgements(
      [{ clusterId: 2, ids: [1, 2], res: ok('EVENT', '尼泊尔洪灾', '冰川溃决引发洪灾') }],
      titleOf
    );
    expect(stats).toEqual({ judgeFailures: 0, pocketFlagged: 0, unsureClusters: 0 });
    expect(pending[0].title).toBe('尼泊尔洪灾');
    expect(pending[0].covers).toBe('冰川溃决引发洪灾');
  });
});

describe('assembleBlocks', () => {
  const mkPending = (clusterId: number, title: string, ids: number[]): PendingBlock => ({
    clusterId,
    title,
    covers: '',
    ids,
  });
  const publishedAt = new Map<number, number>(
    Array.from({ length: 100 }, (_, i) => [i + 1, Date.UTC(2026, 8, 1) + i * 3600_000] as [number, number])
  );
  const titleOf = new Map<number, string>(
    Array.from({ length: 100 }, (_, i) => [i + 1, `Nepal flood update ${i + 1}`] as [number, string])
  );
  const oneSourcePer = (ids: number[]) => ids.length; // 每篇一个独立源

  it('30 篇上限生效，且两端锚定（保留最早与最新）', () => {
    const ids = Array.from({ length: 81 }, (_, i) => i + 1);
    const { blocks, stats } = assembleBlocks([mkPending(1, '洪灾', ids)], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    });

    expect(blocks[0].articleIds).toHaveLength(30);
    expect(blocks[0].articleIds[0]).toBe(1); // 最早
    expect(blocks[0].articleIds.at(-1)).toBe(81); // 最新
    expect(stats.cappedBlocks).toBe(1);
    expect(stats.droppedArticles).toBe(51);
  });

  it('不到上限时不截断，也不计数', () => {
    const { blocks, stats } = assembleBlocks([mkPending(1, '洪灾', [1, 2, 3])], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    });
    expect(blocks[0].articleIds).toEqual([1, 2, 3]);
    expect(stats.cappedBlocks).toBe(0);
    expect(stats.droppedArticles).toBe(0);
  });

  it('跨簇同名合并：逐字相同的标题并成一块，文章取并集', () => {
    const { blocks, stats } = assembleBlocks(
      [mkPending(54, 'Nepal-Tibet flash floods', [1, 2]), mkPending(55, 'nepal-tibet flash floods  ', [2, 3])],
      { publishedAt, titleOf, distinctSources: oneSourcePer }
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].articleIds).toEqual([1, 2, 3]); // 并集去重
    expect(stats.crossClusterMerges).toBe(1);
  });

  it('标题不同则不合并（近义不合，只认逐字相同）', () => {
    const { blocks, stats } = assembleBlocks(
      [mkPending(1, 'Nepal floods', [1]), mkPending(2, 'Nepal flooding', [2])],
      { publishedAt, titleOf, distinctSources: oneSourcePer }
    );
    expect(blocks).toHaveLength(2);
    expect(stats.crossClusterMerges).toBe(0);
  });

  it('顺序是先合后截：合并后超上限才截，且只采样一次', () => {
    const a = Array.from({ length: 20 }, (_, i) => i + 1);
    const b = Array.from({ length: 20 }, (_, i) => i + 21);
    const { blocks, stats } = assembleBlocks([mkPending(1, '同名', a), mkPending(2, '同名', b)], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].articleIds).toHaveLength(30); // 40 篇并集 → 截到 30
    expect(stats.droppedArticles).toBe(10); // 若先截后合会是 0（各 20 篇都不超限）
  });

  it('importance 随独立源数与篇数单调不减，且落在 1..10', () => {
    const small = assembleBlocks([mkPending(1, 'A', [1, 2])], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    }).blocks[0];
    const big = assembleBlocks([mkPending(2, 'B', Array.from({ length: 20 }, (_, i) => i + 1))], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    }).blocks[0];

    expect(big.importance).toBeGreaterThan(small.importance);
    for (const b of [small, big]) {
      expect(b.importance).toBeGreaterThanOrEqual(1);
      expect(b.importance).toBeLessThanOrEqual(10);
    }
  });

  it('eventKey 由块内标题的主导专名给出（跨簇同事件配额靠它）', () => {
    const { blocks } = assembleBlocks([mkPending(1, '洪灾', [1, 2, 3])], {
      publishedAt,
      titleOf,
      distinctSources: oneSourcePer,
    });
    expect(blocks[0].eventKey).toBe('Nepal');
  });
});

describe('AIWorkerService.judgeCluster 契约', () => {
  /** 用假的 service binding 驱动真实客户端：只替换传输层，解析与判别逻辑都是生产代码 */
  const clientWith = (respond: (req: Request) => Response) =>
    createAIServices({ AI_WORKER: { fetch: async (req: Request) => respond(req) } } as any).aiWorker;

  const articles = [
    { id: 1, title: 'Nepal floods kill 200' },
    { id: 2, title: 'Nepal rescue teams reach Rasuwa' },
  ];

  it('200 + success:true → ok，字段原样透出', async () => {
    const client = clientWith(() =>
      Response.json({ success: true, data: { verdict: 'EVENT', title: '尼泊尔洪灾', event: '一句话', reason: '理由' } })
    );
    const res = await client.judgeCluster(articles);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.verdict).toBe('EVENT');
      expect(res.value.title).toBe('尼泊尔洪灾');
    }
  });

  it('HTTP 500 → ok:false，绝不退化成 NO_EVENT', async () => {
    const client = clientWith(() => new Response('boom', { status: 500 }));
    const res = await client.judgeCluster(articles);

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('NO_EVENT');
  });

  it('200 但 success:false（模型输出解析不出）→ ok:false', async () => {
    const client = clientWith(() =>
      Response.json({ success: false, error: 'cluster judge returned no usable verdict' })
    );
    const res = await client.judgeCluster(articles);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('no usable verdict');
  });

  it('请求体形状：articles 数组带 id 与 title', async () => {
    let body: any = null;
    const client = clientWith(req => {
      body = req.body;
      return Response.json({ success: true, data: { verdict: 'EVENT', title: 't', event: 'e', reason: 'r' } });
    });
    // 读取请求体需要克隆，改用拦截 json
    const client2 = createAIServices({
      AI_WORKER: {
        fetch: async (req: Request) => {
          body = await req.json();
          return Response.json({ success: true, data: { verdict: 'EVENT', title: 't', event: 'e', reason: 'r' } });
        },
      },
    } as any).aiWorker;
    await client2.judgeCluster(articles);

    expect(body).toEqual({ articles });
    void client;
  });
});
