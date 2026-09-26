/**
 * 抓取 → 队列这一段不能把文章永久卡在 PENDING_FETCH（B9）。
 * 真实 DO + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md「数据库」）；
 * 队列是外部服务，用记录/失败的假队列替换 DO 的 ARTICLE_PROCESSING_QUEUE，feed 用 fetchMock 假冒。
 */
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { fetchMock } from '../fetch-mock';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $articles, $sources, eq, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';
import type { SourceScraperDO } from '../../src/durable_objects/sourceScraperDO';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);
const HOUR = 60 * 60 * 1000;
const FEED_ORIGIN = 'https://feeds.example.com';

type Sent = { articles_id: number[] };

function fakeQueue({ fail }: { fail: boolean }) {
  const sent: Sent[] = [];
  return {
    sent,
    async send(body: Sent) {
      if (fail) throw new Error('queue unavailable');
      sent.push(body);
    },
    async sendBatch() {
      throw new Error('not used');
    },
  };
}

function rss(items: { link: string; pubDate: Date }[]) {
  const body = items
    .map(i => `<item><title>t ${i.link}</title><link>${i.link}</link><pubDate>${i.pubDate.toUTCString()}</pubDate></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>f</title>${body}</channel></rss>`;
}

// DO 在各测试间共享（isolatedStorage: false），每个测试用自己的 feed URL
let n = 0;
async function setupSource() {
  const path = `/queue-test-${Date.now()}-${n++}.xml`;
  const url = `${FEED_ORIGIN}${path}`;
  const [source] = await db
    .insert($sources)
    .values({ url, name: 'Example', category: 'news', scrape_frequency: 1 })
    .returning({ id: $sources.id, url: $sources.url });
  const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
  await runInDurableObject(stub, async (_i, state) => {
    await state.storage.put('state', { sourceId: source.id, url, scrapeFrequencyTier: 1, lastChecked: null });
  });
  return { ...source, path, stub };
}

/** 跑一次 alarm，DO 的队列换成给定的假队列 */
async function runAlarm(stub: DurableObjectStub<SourceScraperDO>, queue: ReturnType<typeof fakeQueue>) {
  await runInDurableObject(stub, async (instance: SourceScraperDO) => {
    const self = instance as unknown as { env: Env };
    self.env = { ...self.env, ARTICLE_PROCESSING_QUEUE: queue as unknown as Env['ARTICLE_PROCESSING_QUEUE'] };
    await instance.alarm();
  });
}

async function articleRow(id: number) {
  const [row] = await db.select().from($articles).where(eq($articles.id, id));
  return row;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await db.execute(sql`truncate sources restart identity cascade`);
});

describe('入队失败不算本轮成功', () => {
  it('send 抛错：lastChecked 不前进（库与 DO state 都不动）', async () => {
    const source = await setupSource();
    fetchMock
      .get(FEED_ORIGIN)
      .intercept({ path: source.path })
      .reply(200, rss([{ link: 'https://news.example.com/a1', pubDate: new Date(Date.now() - HOUR) }]));

    await runAlarm(source.stub, fakeQueue({ fail: true }));

    const [row] = await db.select().from($sources).where(eq($sources.id, source.id));
    expect(row.lastChecked).toBeNull();
    await runInDurableObject(source.stub, async (_i, state) => {
      expect((await state.storage.get<{ lastChecked: number | null }>('state'))?.lastChecked).toBeNull();
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });
});

describe('alarm 回收本源卡在 PENDING_FETCH 的旧文章', () => {
  it('处理窗口内的重新入队，已过窗口的标成终态；新鲜的、别的源的、已处理的不动（feed 抓取失败也照做）', async () => {
    const source = await setupSource();
    const other = await setupSource();
    // feed 抓不到：回收不依赖本轮抓取成功
    fetchMock.get(FEED_ORIGIN).intercept({ path: source.path }).reply(500, 'down').times(3);

    const now = Date.now();
    const insert = async (values: Partial<typeof $articles.$inferInsert> & { url: string }) =>
      (
        await db
          .insert($articles)
          .values({ title: 't', sourceId: source.id, ...values })
          .returning({ id: $articles.id })
      )[0].id;

    const staleInWindow = await insert({
      url: 'https://news.example.com/stale-in-window',
      publishDate: new Date(now - 3 * HOUR),
      createdAt: new Date(now - 3 * HOUR),
    });
    const staleExpired = await insert({
      url: 'https://news.example.com/stale-expired',
      publishDate: new Date(now - 8 * 24 * HOUR),
      createdAt: new Date(now - 8 * 24 * HOUR),
    });
    const fresh = await insert({
      url: 'https://news.example.com/fresh',
      publishDate: new Date(now - 10 * 60 * 1000),
      createdAt: new Date(now - 5 * 60 * 1000),
    });
    const done = await insert({
      url: 'https://news.example.com/done',
      publishDate: new Date(now - 3 * HOUR),
      createdAt: new Date(now - 3 * HOUR),
      status: 'PROCESSED',
      processedAt: new Date(now - 2 * HOUR),
    });
    const otherSource = await insert({
      url: 'https://news.example.com/other-source',
      sourceId: other.id,
      publishDate: new Date(now - 3 * HOUR),
      createdAt: new Date(now - 3 * HOUR),
    });

    const queue = fakeQueue({ fail: false });
    await runAlarm(source.stub, queue);

    expect(queue.sent.flatMap(m => m.articles_id)).toEqual([staleInWindow]);

    const expired = await articleRow(staleExpired);
    expect(expired.status).toBe('SKIPPED_TOO_OLD');
    expect(expired.processedAt).not.toBeNull();
    expect(expired.failReason).toMatch(/PENDING_FETCH/);

    expect((await articleRow(staleInWindow)).status).toBe('PENDING_FETCH');
    expect((await articleRow(fresh)).status).toBe('PENDING_FETCH');
    expect((await articleRow(done)).status).toBe('PROCESSED');
    const untouched = await articleRow(otherSource);
    expect(untouched.status).toBe('PENDING_FETCH');
    expect(untouched.processedAt).toBeNull();
  });
});

describe('源改了地址后的旧 DO', () => {
  // DO 按 url 命名。改地址时旧 DO 没停掉（改地址会停旧 DO 之前就是这样），它存着旧地址继续每小时抓；
  // 源还在、没暂停，所以「源已删 / 已暂停」两条自停都拦不住它
  it('库里该源的地址已不是自己的地址：alarm 自行停掉，不再抓旧地址', async () => {
    const source = await setupSource();
    await db.update($sources).set({ url: `${FEED_ORIGIN}/moved-${source.id}.xml` }).where(eq($sources.id, source.id));

    await runAlarm(source.stub, fakeQueue({ fail: false }));

    await runInDurableObject(source.stub, async (_i, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(await state.storage.get('state')).toBeUndefined();
    });
  });
});
