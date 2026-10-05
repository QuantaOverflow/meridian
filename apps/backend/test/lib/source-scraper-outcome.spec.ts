/**
 * 抓取程序每一轮都把结局记到来源上（last_attempt_at / last_error）。lastChecked 只在整轮成功时前进，
 * 光看它分不出「没去检查」和「去了但失败」——2026-10-05 CBS 的 feed 对 Cloudflare 出口时不时回 406，
 * 运维台只显示「没检查」，原因要翻线上日志才知道。
 * 真实 DO + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」）；feed 用 fetchMock 假冒。
 */
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { fetchMock } from '../fetch-mock';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $sources, eq, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';
import type { SourceScraperDO } from '../../src/durable_objects/sourceScraperDO';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const FEED_ORIGIN = 'https://feeds.example.com';
const EMPTY_FEED = '<?xml version="1.0"?><rss version="2.0"><channel><title>f</title></channel></rss>';

let n = 0;
async function setupSource(initial: { last_error?: string } = {}) {
  const path = `/outcome-test-${Date.now()}-${n++}.xml`;
  const url = `${FEED_ORIGIN}${path}`;
  const [source] = await db
    .insert($sources)
    .values({ url, name: 'Example', category: 'news', scrape_frequency: 1, ...initial })
    .returning({ id: $sources.id });
  const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
  await runInDurableObject(stub, async (_i, state) => {
    await state.storage.put('state', { sourceId: source.id, url, scrapeFrequencyTier: 1, lastChecked: null });
  });
  return { id: source.id, path, stub };
}

const runAlarm = (stub: DurableObjectStub<SourceScraperDO>) =>
  runInDurableObject(stub, async (instance: SourceScraperDO) => {
    await instance.alarm();
  });

async function sourceRow(id: number) {
  const [row] = await db.select().from($sources).where(eq($sources.id, id));
  return row;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await db.execute(sql`truncate sources restart identity cascade`);
});

describe('每轮的结局记到来源上', () => {
  it('feed 连续 3 次回 406：记下这次尝试和原因，lastChecked 不前进', async () => {
    const source = await setupSource();
    fetchMock.get(FEED_ORIGIN).intercept({ path: source.path }).reply(406, 'Not Acceptable').times(3);
    const before = Date.now();

    await runAlarm(source.stub);

    const row = await sourceRow(source.id);
    expect(row.lastChecked).toBeNull();
    expect(row.last_error).toContain('406');
    expect(row.last_attempt_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('上一轮失败、这一轮成功：原因清空，尝试时间与 lastChecked 都前进', async () => {
    const source = await setupSource({ last_error: 'Fetch failed with status: 406 Not Acceptable' });
    fetchMock.get(FEED_ORIGIN).intercept({ path: source.path }).reply(200, EMPTY_FEED);

    await runAlarm(source.stub);

    const row = await sourceRow(source.id);
    expect(row.last_error).toBeNull();
    expect(row.lastChecked).not.toBeNull();
    expect(row.last_attempt_at).toEqual(row.lastChecked);
  });

  it('原因很长时只留前 300 个字符', async () => {
    const source = await setupSource();
    // 不是合法 XML 的超长正文 → 解析失败，报错里带着原文片段
    fetchMock.get(FEED_ORIGIN).intercept({ path: source.path }).reply(200, `<rss><channel><item><title></title><link>https://x.example/${'a'.repeat(2000)}</link></item></channel></rss>`).times(3);

    await runAlarm(source.stub);

    const row = await sourceRow(source.id);
    expect(row.last_error).not.toBeNull();
    expect(row.last_error!.length).toBeLessThanOrEqual(300);
  });
});

describe('抓 feed 的请求', () => {
  it('带 Accept 头，声明要 RSS / XML', async () => {
    const source = await setupSource();
    fetchMock.get(FEED_ORIGIN).intercept({ path: source.path }).reply(200, EMPTY_FEED);
    const mocked = globalThis.fetch;
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.startsWith(FEED_ORIGIN)) seen.push(request.headers.get('accept'));
      return mocked(input, init);
    }) as typeof fetch;
    try {
      await runAlarm(source.stub);
    } finally {
      globalThis.fetch = mocked;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('application/rss+xml');
    expect(seen[0]).toContain('application/xml');
  });
});
