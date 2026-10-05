/**
 * 运维台 Sources 视图（GET /observability/ops/sources）：每个源按近 7 天的数据判成六种之一。
 * 走真实路由 + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」），灌行、请求、断言 JSON。
 * 时间一律相对「现在」摆，并离阈值留出余量（端点用真实时钟）；百分比阈值的两侧都用整数比例卡在边界上。
 */
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OpsSources } from '@meridian/contracts';
import { $articles, $sources, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

async function fetchSources(): Promise<OpsSources> {
  const res = await exports.default.fetch('http://backend/observability/ops/sources', {
    headers: { Authorization: `Bearer ${env.API_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OpsSources;
}

let n = 0;
/** 默认：每 4 小时一抓、1 小时前刚查过、没暂停 */
async function source(over: Partial<typeof $sources.$inferInsert> = {}) {
  const [row] = await db
    .insert($sources)
    .values({
      url: `https://feeds.example.com/ops-sources-${n++}.xml`,
      name: `Source ${n}`,
      category: 'news',
      scrape_frequency: 2,
      lastChecked: ago(1),
      ...over,
    })
    .returning({ id: $sources.id });
  return row.id;
}

interface ArticleSpec {
  hoursAgo?: number;
  status?: (typeof $articles.$inferInsert)['status'];
  failReason?: string | null;
  bodyLines?: number | null;
  usedBrowser?: boolean | null;
}

async function articles(sourceId: number, count: number, spec: ArticleSpec = {}) {
  const { hoursAgo = 1, status = 'PROCESSED', failReason = null, bodyLines = 5, usedBrowser = null } = spec;
  await db.insert($articles).values(
    Array.from({ length: count }, () => ({
      sourceId,
      title: 't',
      url: `https://news.example.com/a-${n++}`,
      status,
      failReason,
      body_lines: bodyLines,
      used_browser: usedBrowser,
      createdAt: ago(hoursAgo),
    }))
  );
}

/** 一个源 10 篇新文章（1 小时前），其中按给定条数混入有问题的 */
async function tenArticles(sourceId: number, bad: ArticleSpec & { count: number }) {
  const { count, ...spec } = bad;
  await articles(sourceId, 10 - count);
  await articles(sourceId, count, spec);
}

const kindOf = async (id: number) => (await fetchSources()).sources.find(s => s.id === id)!;

beforeEach(async () => {
  await db.execute(sql`truncate sources, articles restart identity cascade`);
});

describe('响应形状', () => {
  it('没有源：空列表、各类计数为 0，阈值随响应给出', async () => {
    const body = await fetchSources();
    expect(body.sources).toEqual([]);
    expect(body.counts).toEqual({ ok: 0, not_checked: 0, dead_feed: 0, fetch_failing: 0, bad_body: 0, paused: 0 });
    expect(body.thresholds).toEqual({ fetchFailingPct: 30, badBodyPct: 20, deadFeedMinArticles7d: 7, deadFeedQuietHours: 48 });
  });

  it('一个健康的源：ok / ok 灯，带 7 天与 48 小时的篇数、最近新文章时间与各比例', async () => {
    const id = await source({ name: 'Healthy', category: 'tech', scrape_frequency: 1 });
    await articles(id, 4, { hoursAgo: 100 });
    await articles(id, 1, { hoursAgo: 3, usedBrowser: true });
    await articles(id, 1, { hoursAgo: 2 });
    const s = await kindOf(id);
    expect(s).toMatchObject({
      id,
      name: 'Healthy',
      category: 'tech',
      frequency: 'Hourly',
      kind: 'ok',
      level: 'ok',
      pausedAt: null,
      articles7d: 6,
      articles48h: 2,
      fetchFailedPct: 0,
      junkPct: 0,
      singleLinePct: 0,
    });
    expect(s.viaBrowserPct).toBeCloseTo(16.7, 1);
    expect(new Date(s.lastArticleAt!).getTime()).toBeCloseTo(ago(2).getTime(), -4);
    expect(new Date(s.lastChecked!).getTime()).toBeCloseTo(ago(1).getTime(), -4);
  });

  it('7 天之外的文章不计；没有近期文章时比例为 null，最近新文章时间仍取全部历史', async () => {
    const id = await source();
    await articles(id, 3, { hoursAgo: 24 * 8, status: 'FETCH_FAILED' });
    const s = await kindOf(id);
    expect(s).toMatchObject({ articles7d: 0, articles48h: 0, fetchFailedPct: null, junkPct: null, singleLinePct: null, viaBrowserPct: null, kind: 'ok' });
    expect(new Date(s.lastArticleAt!).getTime()).toBeCloseTo(ago(24 * 8).getTime(), -4);
  });

  it('列表按严重度排（红、黄、ok、灰），同级按名字；counts 与之一致', async () => {
    await source({ name: 'b-ok' });
    await source({ name: 'a-paused', paused_at: ago(5) });
    await source({ name: 'c-notchecked', lastChecked: ago(30) });
    const bad = await source({ name: 'd-bad' });
    await tenArticles(bad, { count: 3, bodyLines: 1 });
    const body = await fetchSources();
    expect(body.sources.map(s => s.name)).toEqual(['c-notchecked', 'd-bad', 'b-ok', 'a-paused']);
    expect(body.counts).toEqual({ ok: 1, not_checked: 1, dead_feed: 0, fetch_failing: 0, bad_body: 1, paused: 1 });
  });
});

describe('paused', () => {
  it('暂停的源永远是灰、不算问题：即使它很久没查、没新文章、全抓失败', async () => {
    const id = await source({ paused_at: ago(100), lastChecked: ago(500) });
    await articles(id, 10, { hoursAgo: 100, status: 'FETCH_FAILED', bodyLines: 1 });
    expect(await kindOf(id)).toMatchObject({ kind: 'paused', level: 'grey' });
  });
});

describe('not_checked：两个抓取间隔没查过', () => {
  const cases: Array<[number, number, number]> = [
    // [scrape_frequency, 阈值内的小时数, 阈值外的小时数]
    [1, 1.8, 2.2],
    [2, 7.8, 8.2],
    [3, 11.8, 12.2],
    [4, 47.8, 48.2],
  ];
  for (const [freq, inside, outside] of cases) {
    it(`频率 ${freq}：${inside} 小时前查过是 ok，${outside} 小时前是 not_checked（红）`, async () => {
      const fresh = await source({ scrape_frequency: freq, lastChecked: ago(inside) });
      const stale = await source({ scrape_frequency: freq, lastChecked: ago(outside) });
      expect(await kindOf(fresh)).toMatchObject({ kind: 'ok', level: 'ok' });
      expect(await kindOf(stale)).toMatchObject({ kind: 'not_checked', level: 'red' });
    });
  }

  it('从没查过（last_checked 为空）也是 not_checked，lastChecked 回 null', async () => {
    const id = await source({ lastChecked: null });
    expect(await kindOf(id)).toMatchObject({ kind: 'not_checked', lastChecked: null });
  });
});

describe('dead_feed：7 天内至少 7 篇、最近 48 小时一篇没有', () => {
  it('7 篇全在 48 小时之前：dead_feed（红）；少一篇：不是', async () => {
    const dead = await source();
    await articles(dead, 7, { hoursAgo: 72 });
    const fewer = await source();
    await articles(fewer, 6, { hoursAgo: 72 });
    expect(await kindOf(dead)).toMatchObject({ kind: 'dead_feed', level: 'red', articles7d: 7, articles48h: 0 });
    expect(await kindOf(fewer)).toMatchObject({ kind: 'ok', articles7d: 6 });
  });

  it('48 小时内有一篇就不是 dead_feed', async () => {
    const id = await source();
    await articles(id, 6, { hoursAgo: 72 });
    await articles(id, 1, { hoursAgo: 47 });
    expect(await kindOf(id)).toMatchObject({ kind: 'ok', articles7d: 7, articles48h: 1 });
  });
});

describe('fetch_failing：超过 30% 的新文章抓取失败', () => {
  it('10 篇里 3 篇失败（恰 30%）不算；4 篇才算（黄）', async () => {
    const edge = await source();
    await tenArticles(edge, { count: 3, status: 'FETCH_FAILED', failReason: 'HTTP 403' });
    const over = await source();
    await tenArticles(over, { count: 4, status: 'FETCH_FAILED', failReason: 'HTTP 403' });
    expect(await kindOf(edge)).toMatchObject({ kind: 'ok', fetchFailedPct: 30 });
    expect(await kindOf(over)).toMatchObject({ kind: 'fetch_failing', level: 'yellow', fetchFailedPct: 40 });
  });

  it('失败原因为空的 FETCH_FAILED 也算抓取失败', async () => {
    const id = await source();
    await tenArticles(id, { count: 4, status: 'FETCH_FAILED', failReason: null });
    expect(await kindOf(id)).toMatchObject({ kind: 'fetch_failing', fetchFailedPct: 40 });
  });

  it('不是 FETCH_FAILED 的失败状态不算抓取失败', async () => {
    const id = await source();
    await tenArticles(id, { count: 5, status: 'AI_ANALYSIS_FAILED' });
    expect(await kindOf(id)).toMatchObject({ kind: 'ok', fetchFailedPct: 0 });
  });
});

describe('bad_body：超过 20% 是垃圾页或黏成一行', () => {
  it('黏成一行：10 篇里 2 篇（20%）不算，3 篇才算（黄）', async () => {
    const edge = await source();
    await tenArticles(edge, { count: 2, bodyLines: 1 });
    const over = await source();
    await tenArticles(over, { count: 3, bodyLines: 1 });
    expect(await kindOf(edge)).toMatchObject({ kind: 'ok', singleLinePct: 20 });
    expect(await kindOf(over)).toMatchObject({ kind: 'bad_body', level: 'yellow', singleLinePct: 30 });
  });

  it('垃圾页：10 篇里 2 篇不算，3 篇才算', async () => {
    const edge = await source();
    await tenArticles(edge, { count: 2, status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: cookie wall' });
    const over = await source();
    await tenArticles(over, { count: 3, status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: cookie wall' });
    expect(await kindOf(edge)).toMatchObject({ kind: 'ok', junkPct: 20 });
    expect(await kindOf(over)).toMatchObject({ kind: 'bad_body', junkPct: 30 });
  });

  it('垃圾页与抓取失败分开数：垃圾页不进 fetchFailedPct，所以 3 篇垃圾页判 bad_body 而不是 fetch_failing', async () => {
    const id = await source();
    await tenArticles(id, { count: 3, status: 'FETCH_FAILED', failReason: 'EXTRACTION_JUNK: paywall stub' });
    expect(await kindOf(id)).toMatchObject({ kind: 'bad_body', fetchFailedPct: 0, junkPct: 30 });
  });

  it('body_lines 为空的行不进「黏成一行」的分子和分母', async () => {
    // 10 篇：6 篇没记行数、2 篇一行、2 篇多行。算上空值是 20%（不算），不算空值是 2/4 = 50%（算）
    const id = await source();
    await articles(id, 6, { bodyLines: null });
    await articles(id, 2, { bodyLines: 1 });
    await articles(id, 2, { bodyLines: 4 });
    expect(await kindOf(id)).toMatchObject({ kind: 'bad_body', singleLinePct: 50 });
  });

  it('全是空值：singleLinePct 为 null，不判 bad_body', async () => {
    const id = await source();
    await articles(id, 10, { bodyLines: null });
    expect(await kindOf(id)).toMatchObject({ kind: 'ok', singleLinePct: null });
  });
});

describe('第一个匹配的赢', () => {
  it('not_checked 先于 dead_feed、fetch_failing、bad_body', async () => {
    const id = await source({ lastChecked: ago(30) });
    await articles(id, 10, { hoursAgo: 72, status: 'FETCH_FAILED', bodyLines: 1 });
    expect(await kindOf(id)).toMatchObject({ kind: 'not_checked', fetchFailedPct: 100 });
  });

  it('dead_feed 先于 fetch_failing 与 bad_body', async () => {
    const id = await source();
    await articles(id, 10, { hoursAgo: 72, status: 'FETCH_FAILED', bodyLines: 1 });
    expect(await kindOf(id)).toMatchObject({ kind: 'dead_feed' });
  });

  it('fetch_failing 先于 bad_body', async () => {
    const id = await source();
    await articles(id, 5, { status: 'FETCH_FAILED', failReason: 'HTTP 500' });
    await articles(id, 5, { bodyLines: 1 });
    expect(await kindOf(id)).toMatchObject({ kind: 'fetch_failing', singleLinePct: 50 });
  });
});
