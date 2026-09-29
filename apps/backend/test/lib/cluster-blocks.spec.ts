/**
 * 簇判定 step 的组件测试。
 *
 * 测的是 2026-09-05/06 新加的那条链路里**最容易错、且错了在日志里不显眼**的两段：
 *   判定结果 → 块（`planBlocksFromJudgements`）
 *   同一件事被拆成多块 → 按质心余弦合回一块（`mergeSameEventBlocks`）
 *   块 → 同事件合并 → 截断 → 打分（`assembleBlocks`）
 *
 * 外加客户端契约（`AIWorkerService.judgeCluster`）：HTTP 非 200 / `success:false` 必须回
 * `ok:false`，**不能**被上游读成「这簇没有故事」。这一条是这个仓库栽过的坑
 * （调用失败伪装成 NO_STORIES 骗了一整轮）。
 */
import { describe, expect, it } from 'vitest';
import {
  assembleBlocks,
  meanEmbedding,
  mergeSameEventBlocks,
  planBlocksFromJudgements,
  SAME_EVENT_MERGE_THRESHOLD,
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
  const oneSourcePer = (ids: number[]) => ids.length; // 每篇一个独立源
  const noCentroid = () => null; // 不参与同事件合并

  it('30 篇上限生效，且两端锚定（保留最早与最新）', () => {
    const ids = Array.from({ length: 81 }, (_, i) => i + 1);
    const { blocks, stats } = assembleBlocks([mkPending(1, '洪灾', ids)], {
      publishedAt,
      distinctSources: oneSourcePer,
      centroidOf: noCentroid,
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
      distinctSources: oneSourcePer,
      centroidOf: noCentroid,
    });
    expect(blocks[0].articleIds).toEqual([1, 2, 3]);
    expect(stats.cappedBlocks).toBe(0);
    expect(stats.droppedArticles).toBe(0);
  });

  it('顺序是先合后截：合并后超上限才截，且只采样一次', () => {
    const a = Array.from({ length: 20 }, (_, i) => i + 1);
    const b = Array.from({ length: 20 }, (_, i) => i + 21);
    const { blocks, stats } = assembleBlocks([mkPending(1, '甲', a), mkPending(2, '乙', b)], {
      publishedAt,
      distinctSources: oneSourcePer,
      centroidOf: () => [1, 0], // 两块质心相同 → 同一件事
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].articleIds).toHaveLength(30); // 40 篇并集 → 截到 30
    expect(stats.droppedArticles).toBe(10); // 若先截后合会是 0（各 20 篇都不超限）
    expect(stats.sameEventMerges).toBe(1);
    expect(stats.merges).toEqual([
      {
        clusterId: 1,
        title: '甲',
        members: [
          { clusterId: 1, title: '甲', articles: 20, cosToLead: 1 },
          { clusterId: 2, title: '乙', articles: 20, cosToLead: 1 },
        ],
        links: [1],
      },
    ]);
  });

  it('标题逐字相同但质心远 → 不合并（旧的同名合并已退役）', () => {
    const { blocks, stats } = assembleBlocks(
      [mkPending(54, 'Nepal-Tibet flash floods', [1, 2]), mkPending(55, 'Nepal-Tibet flash floods', [3, 4])],
      { publishedAt, distinctSources: oneSourcePer, centroidOf: (b) => (b.clusterId === 54 ? [1, 0] : [0, 1]) }
    );
    expect(blocks).toHaveLength(2);
    expect(stats.sameEventMerges).toBe(0);
    expect(stats.merges).toEqual([]);
  });

  it('importance 随独立源数与篇数单调不减，且落在 1..10', () => {
    const small = assembleBlocks([mkPending(1, 'A', [1, 2])], {
      publishedAt,
      distinctSources: oneSourcePer,
      centroidOf: noCentroid,
    }).blocks[0];
    const big = assembleBlocks([mkPending(2, 'B', Array.from({ length: 20 }, (_, i) => i + 1))], {
      publishedAt,
      distinctSources: oneSourcePer,
      centroidOf: noCentroid,
    }).blocks[0];

    expect(big.importance).toBeGreaterThan(small.importance);
    for (const b of [small, big]) {
      expect(b.importance).toBeGreaterThanOrEqual(1);
      expect(b.importance).toBeLessThanOrEqual(10);
    }
  });
});

describe('mergeSameEventBlocks', () => {
  /** 二维单位向量，角度制。两块余弦 = cos(角度差)，好控制 */
  const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  /** 余弦恰为 c 的角度差 */
  const gap = (c: number) => (Math.acos(c) * 180) / Math.PI;
  const blk = (clusterId: number, n: number, title = `b${clusterId}`): PendingBlock => ({
    clusterId,
    title,
    covers: `covers-${clusterId}`,
    ids: Array.from({ length: n }, (_, i) => clusterId * 100 + i),
  });
  const run = (blocks: PendingBlock[], deg: Record<number, number | null>) =>
    mergeSameEventBlocks(blocks, (b) => (deg[b.clusterId] == null ? null : at(deg[b.clusterId]!)));
  /** 与输入顺序无关的分组视图：每组的成员 clusterId 升序，组按首个成员排 */
  const groupsOf = (blocks: PendingBlock[], all: PendingBlock[]) =>
    blocks
      .map((b) => all.filter((m) => m.ids.every((id) => b.ids.includes(id))).map((m) => m.clusterId).sort((x, y) => x - y))
      .sort((x, y) => x[0] - y[0]);

  it('门槛是 0.935', () => {
    expect(SAME_EVENT_MERGE_THRESHOLD).toBe(0.935);
  });

  it('余弦高于门槛的两块合并，低于门槛的不合', () => {
    const all = [blk(1, 3), blk(2, 3), blk(3, 3)];
    // 1–2 余弦 0.95；3 离 2 的余弦 0.92、离 1 更远
    const { blocks, merges } = run(all, { 1: 0, 2: gap(0.95), 3: gap(0.95) + gap(0.92) });
    expect(groupsOf(blocks, all)).toEqual([[1, 2], [3]]);
    expect(merges).toHaveLength(1);
    expect(merges[0].links[0]).toBeCloseTo(0.95, 4);
  });

  it('average link 防串联：A–B、B–C 高而 A–C 低时，C 不被 AB 组带进来', () => {
    const all = [blk(1, 2), blk(2, 2), blk(3, 2)];
    // A–B 0.98，B–C 0.96，A–C = cos(11.48°+16.26°) ≈ 0.885。
    // 先合 AB（0.98）；AB 组对 C 的 average = (0.885 + 0.96) / 2 ≈ 0.922 < 0.935 → 停。
    // （single link 会按 B–C 的 0.96 把 C 也串进来。）
    const { blocks } = run(all, { 1: 0, 2: gap(0.98), 3: gap(0.98) + gap(0.96) });
    expect(groupsOf(blocks, all)).toEqual([[1, 2], [3]]);
  });

  it('average link：链不长时（A–C 也够近）三块合成一块', () => {
    const all = [blk(1, 2), blk(2, 2), blk(3, 2)];
    // A–B 0.99，B–C 0.97，A–C ≈ 0.926；AB 组对 C 的 average ≈ 0.948 ≥ 0.935 → 三块一组
    const { blocks, merges } = run(all, { 1: 0, 2: gap(0.99), 3: gap(0.99) + gap(0.97) });
    expect(groupsOf(blocks, all)).toEqual([[1, 2, 3]]);
    expect(merges).toHaveLength(1);
    expect(merges[0].links).toHaveLength(2);
    expect(merges[0].links[0]).toBeCloseTo(0.99, 4);
    expect(merges[0].links[1]).toBeGreaterThanOrEqual(SAME_EVENT_MERGE_THRESHOLD);
    expect(merges[0].links[1]).toBeLessThan(0.97);
  });

  it('文章守恒：不丢、不重，合并块的 ids 升序', () => {
    const all = [blk(4, 5), blk(1, 3), blk(2, 7), blk(3, 1), blk(5, 2)];
    const { blocks } = run(all, { 1: 0, 2: 1, 3: 60, 4: 2, 5: null });
    const out = blocks.flatMap((b) => b.ids);
    expect(out.length).toBe(new Set(out).size);
    expect([...out].sort((x, y) => x - y)).toEqual(all.flatMap((b) => b.ids).sort((x, y) => x - y));
    for (const b of blocks) expect(b.ids).toEqual([...b.ids].sort((x, y) => x - y));
  });

  it('合并后的块沿用篇数最多那块的 clusterId / 标题 / covers；平局取 clusterId 小的', () => {
    const { blocks } = run([blk(1, 2, '小块'), blk(2, 5, '大块'), blk(3, 5, '同样大')], { 1: 0, 2: 0.5, 3: 1 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ clusterId: 2, title: '大块', covers: 'covers-2' });
    expect(blocks[0].ids).toHaveLength(12);
  });

  it('输入顺序打乱，分组与合并后的块完全一致', () => {
    const all = [blk(1, 3), blk(2, 4), blk(3, 2), blk(4, 6), blk(5, 1), blk(6, 2), blk(7, 3)];
    // 两组候选（1,2,3 与 4,5,6 各自聚在一起），7 独立，外加等距造出的平局（2–1 与 2–3 同为 gap 0.96）
    const deg = { 1: 0, 2: gap(0.96), 3: 2 * gap(0.96), 4: 90, 5: 91, 6: 92, 7: 180 };
    const norm = (r: ReturnType<typeof run>) => ({
      blocks: [...r.blocks].sort((a, b) => a.clusterId - b.clusterId),
      merges: [...r.merges].sort((a, b) => a.clusterId - b.clusterId),
    });
    const base = norm(run(all, deg));
    const orders = [
      [6, 5, 4, 3, 2, 1, 0],
      [3, 0, 6, 1, 5, 2, 4],
      [2, 4, 1, 6, 0, 3, 5],
    ];
    for (const o of orders) expect(norm(run(o.map((i) => all[i]), deg))).toEqual(base);
  });

  it('质心为 null 的块不参与合并，原样保留在原位置', () => {
    const all = [blk(1, 2), blk(2, 2), blk(3, 2)];
    // 3 没有质心：哪怕 1、2 合并了，3 也原样留着
    const { blocks, merges } = run(all, { 1: 0, 2: 0, 3: null });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual(all[2]);
    expect(merges).toHaveLength(1);
    expect(merges[0].members.map((m) => m.clusterId)).toEqual([1, 2]);
  });

  it('没有可合的：原样返回、顺序不变', () => {
    const all = [blk(3, 2), blk(1, 2), blk(2, 2)];
    const { blocks, merges } = run(all, { 1: 0, 2: 90, 3: 180 });
    expect(blocks).toEqual(all);
    expect(merges).toEqual([]);
  });
});

describe('meanEmbedding', () => {
  it('成员文章 embedding 的算术平均，缺 embedding 的跳过', () => {
    const emb = new Map<number, number[]>([
      [1, [1, 0, 2]],
      [2, [3, 4, 0]],
    ]);
    expect(meanEmbedding([1, 2, 3], emb)).toEqual([2, 2, 1]);
  });

  it('一篇都没有 embedding → null', () => {
    expect(meanEmbedding([7, 8], new Map())).toBeNull();
    expect(meanEmbedding([], new Map())).toBeNull();
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
