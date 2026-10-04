/**
 * 地图首页数据 `GET /reader/briefs/:id/map` 的边界情况。正常一期的完整响应是 reader.spec.ts 的 brief-8-map golden；
 * 这里在同一份 fixture 上再加几行只给地图看的数据（Delta 源的旧文章、wf-r7 里一条未入选的故事、改几篇文章的地点），
 * 其中有的会改动其它读者 golden，所以不放进共用 fixture。走真实路由 + 本机测试库 + 测试环境的 R2 binding。
 */
import type { BriefMap } from '@meridian/contracts';
import { $articles, $brief_runs, $brief_stories, eq, inArray } from '@meridian/database';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/lib/database';
import { anchorFromDate } from '../fixtures/reader/dates';
import { dbToday, putBrief8Record, putBriefV3Record, seedReaderFixture, writtenBlock } from '../fixtures/reader/fixture';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const anchor = anchorFromDate(await dbToday(db));
  await seedReaderFixture(db, anchor);
  const old = new Date(anchor.getTime() - 10 * DAY);
  // Delta（tech 源）的旧文章：只当故事成员，不进任何一期的当期窗口
  const members: [number, string, string[]][] = [
    [201, 'Israel', ['Politics', 'World Affairs']],
    [202, 'gaza', ['Politics']],
    [203, 'Europe', ['World Affairs', 'Politics']],
    [204, 'Atlantis', ['Politics', 'Diplomacy']],
  ];
  await db.insert($articles).values(
    members.map(([id, loc, tags]) => ({
      id,
      title: `delta article ${id}`,
      url: `https://delta.example.com/${id}`,
      sourceId: 4,
      createdAt: old,
      status: 'PROCESSED' as const,
      primary_location: loc,
      topic_tags: tags,
    }))
  );
  await db.insert($brief_stories).values({
    id: 28,
    workflow_id: 'wf-r7',
    cluster_id: 7,
    title: 'Ceasefire talks',
    article_ids: members.map(([id]) => id),
    selected_for_intel: false,
  });
  await db.update($brief_stories).set({ cluster_id: 8 }).where(eq($brief_stories.id, 14));
  // 第 6 期再加一条只有它自己一块的故事：两篇英国、一篇空串、一篇 null
  const gbMembers: [number, string | null][] = [[205, 'UK'], [206, 'United Kingdom'], [207, ' '], [208, null]];
  await db.insert($articles).values(
    gbMembers.map(([id, loc]) => ({
      id,
      title: `delta article ${id}`,
      url: `https://delta.example.com/${id}`,
      sourceId: 4,
      createdAt: old,
      status: 'PROCESSED' as const,
      primary_location: loc,
    }))
  );
  await db.insert($brief_stories).values({
    id: 29,
    workflow_id: 'wf-r6',
    cluster_id: 9,
    title: 'UK story',
    article_ids: gbMembers.map(([id]) => id),
    selected_for_intel: false,
  });
  await putBriefV3Record(env.ARTICLES_BUCKET, 'wf-r6', [writtenBlock(9, 'UK story', 'lead')]);
  // story 14 的成员（Beta 102 / 111）
  await db.update($articles).set({ topic_tags: ['Economy', 'Security', 'Technology'] }).where(eq($articles.id, 102));
  await db.update($articles).set({ topic_tags: ['economy', 'Conflict', 'Technology', 'security'] }).where(eq($articles.id, 111));
  // 当期窗口里的 Alpha 文章（偶数号、已处理、有 embedding：US 2 14 18 22 34 38 42 54，GB 4 8 12 24 28 32 44 48 52）改几个地点
  for (const [id, loc] of [[2, 'Atlantis'], [14, ''], [18, 'Europe'], [22, 'United States']] as const) {
    await db.update($articles).set({ primary_location: loc }).where(eq($articles.id, id));
  }
  // 第 8 期的 story 16 多一篇窗口里的成员（Alpha 4，GB）：它不该再出现在 GB 的 others 里
  await db.update($brief_stories).set({ article_ids: [105, 4] }).where(eq($brief_stories.id, 16));
  // 第 1 期没有 run
  await db.update($brief_runs).set({ report_id: null }).where(inArray($brief_runs.workflow_id, ['wf-r1']));
  await putBrief8Record(env.ARTICLES_BUCKET);
  await putBriefV3Record(env.ARTICLES_BUCKET, 'wf-r7', [
    writtenBlock(7, 'Ceasefire talks resume', 'lead'),
    writtenBlock(99, 'Ghost block', 'more'),
    writtenBlock(null, 'Nameless block', 'more'),
    writtenBlock(8, 'Iran sanctions', 'more'),
    { storyIdx: 4, title: 'failed block', ok: false, error: 'write failed' },
  ]);
});

async function getMap(id: number): Promise<BriefMap> {
  const res = await exports.default.fetch(`http://backend/reader/briefs/${id}/map`, {
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as BriefMap;
}

describe('地图：正文块 → 故事', () => {
  it('clusterId 对不上故事或为 null 的块被丢掉，其余块不受影响、blockIndex 仍是正文里的位置；没写出来的块不算', async () => {
    const map = await getMap(7);
    expect(
      map.events.map(e => ({ storyId: e.storyId, blockIndex: e.blockIndex, tier: e.tier, title: e.title, articleCount: e.articleCount }))
    ).toEqual([
      { storyId: 28, blockIndex: 0, tier: 'lead', title: 'Ceasefire talks resume', articleCount: 4 },
      { storyId: 14, blockIndex: 3, tier: 'more', title: 'Iran sanctions', articleCount: 2 },
    ]);
  });

  it('丢掉的块记一条 error 日志，带 workflow、块位置与 clusterId', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    try {
      await getMap(7);
    } finally {
      spy.mockRestore();
    }
    const dropped = lines.map(l => JSON.parse(l)).filter(e => e.block_index !== undefined);
    expect(dropped.map(e => ({ workflow_id: e.workflow_id, block_index: e.block_index, cluster_id: e.cluster_id }))).toEqual([
      { workflow_id: 'wf-r7', block_index: 1, cluster_id: 99 },
      { workflow_id: 'wf-r7', block_index: 2, cluster_id: null },
    ]);
  });
});

describe('地图：故事的地点', () => {
  it('地点为空的成员不进分母（与原型 place() 同口径），articleCount 仍是全部成员', async () => {
    const [event] = (await getMap(6)).events;
    expect({ articleCount: event.articleCount, places: event.places }).toEqual({ articleCount: 4, places: [{ country: 'GB', share: 1 }] });
  });

  it('成员按国家的占比（分母是全部成员）；别名归一，地区值与表里没有的值不进 places', async () => {
    const [event] = (await getMap(7)).events;
    expect(event.places).toEqual([
      { country: 'IL', share: 0.25 },
      { country: 'PS', share: 0.25 },
    ]);
  });
});

describe('地图：故事的主题', () => {
  it('成员只带 Politics / World Affairs 这类标签时归 politics（兜底）', async () => {
    const [event] = (await getMap(7)).events;
    expect(event.topics).toEqual(['politics']);
  });

  it('一个主题要 2/3 的成员带它的某个标签（不分大小写），至多两个', async () => {
    // story 14 的两篇成员：security / tech / economy 三个主题都是 2/2，只留前两个
    const iran = (await getMap(7)).events.find(e => e.storyId === 14);
    expect(iran?.topics).toEqual(['security', 'tech']);
  });
});

describe('地图：线索', () => {
  it('过了线索列表的门槛（≥2 期已发布简报）才给，期数与跨度和 /reader/stories 一致；没挂线索的故事为 null', async () => {
    const threads = Object.fromEntries((await getMap(7)).events.map(e => [e.storyId, e.thread]));
    // 线索 2 的期数与跨度见 story-2-importance.golden
    expect(threads).toEqual({ 28: null, 14: { id: 2, briefCount: 2, durationDays: 4 } });
  });

  it('线索只出现在一期已发布简报里（簇 5，另一期是未发布的调试期）：null', async () => {
    const threads = Object.fromEntries((await getMap(8)).events.map(e => [e.storyId, e.thread]));
    // 线索 1 见 story-1-streak.golden；簇 5 见 story-5-below-threshold.golden（404）
    expect(threads).toEqual({ 15: { id: 1, briefCount: 3, durationDays: 3 }, 16: null });
  });
});

describe('地图：当期文章', () => {
  const alpha = (n: number) => {
    const id = String(n).padStart(2, '0');
    return { title: `alpha article ${id}`, url: `https://alpha.example.com/${id}`, source: 'Alpha News' };
  };

  it('没有 brief-v3 记录：事件为空，当期窗口照算；地区值计 regional，空值与表里没有的值计 unmapped', async () => {
    // 第 5 期 run 从第 -3 天 12:00 往回 1 天（默认窗口），Alpha 文章都发在第 -3 天上午
    const map = await getMap(5);
    expect(map.events).toEqual([]);
    expect({ ...map.coverage, byCountry: map.coverage.byCountry.map(c => [c.country, c.count, c.others.length]) }).toEqual({
      total: 17,
      regional: 1,
      unmapped: 2,
      byCountry: [
        ['GB', 9, 9],
        ['US', 5, 5],
      ],
    });
  });

  it('others：按发布时间新的在前；otherTopics 按篇计数取前 3，同数按主题名', async () => {
    const gb = (await getMap(5)).coverage.byCountry.find(c => c.country === 'GB');
    // 发布时间 = 第 -3 天 12:00 − 13i 分钟，号小的新
    expect(gb?.others).toEqual([4, 8, 12, 24, 28, 32, 44, 48, 52].map(alpha));
    // i%8==0 带 Crime（8 24 32 48 → justice 4）；economy（12 24 48）、politics（4 28 52）、tech（8 32 44）各 3，tech 按名排在后面被截掉
    expect(gb?.otherTopics).toEqual([
      ['justice', 4],
      ['economy', 3],
      ['politics', 3],
    ]);
  });

  it('进了正文故事的文章计入国家篇数，但不进 others', async () => {
    const gb = (await getMap(8)).coverage.byCountry.find(c => c.country === 'GB');
    expect(gb?.count).toBe(9);
    expect(gb?.others).toEqual([8, 12, 24, 28, 32, 44, 48, 52].map(alpha));
  });

  it('这期没有 run：事件为空，当期统计全零', async () => {
    expect(await getMap(1)).toMatchObject({ events: [], coverage: { total: 0, regional: 0, unmapped: 0, byCountry: [] } });
  });
});
