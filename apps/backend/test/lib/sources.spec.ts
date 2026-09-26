/**
 * 源的增删改与 DO 启停（src/lib/sources.ts）的不变量。走真实路由 + 真实 DO + 本机测试库
 * （BACKEND_TEST_DATABASE_URL，见 test/README.md）。暂停 / 恢复见 source-pause.spec.ts。
 *
 * 1. 未暂停的源 ⇒ 按当前 url 命名的 DO 有 state（url、tier 与表一致）且有 alarm
 * 2. 暂停的源 ⇒ 没有 alarm
 * 3. 删除后 ⇒ 表里没有行，DO 没有 alarm、storage 清空
 * 4. 失败不留半截状态：表与 DO 保持操作前的样子
 */
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { fetchMock } from '../fetch-mock';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $articles, $brief_runs, $brief_stories, $sources, eq, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);

function api(path: string, method = 'POST', body?: unknown) {
  return exports.default.fetch(`http://backend${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.API_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stubOf(url: string) {
  return env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
}

async function doOf(url: string) {
  return runInDurableObject(stubOf(url), async (_instance, state) => ({
    alarm: await state.storage.getAlarm(),
    state: await state.storage.get<{ sourceId: number; url: string; scrapeFrequencyTier: number }>('state'),
  }));
}

async function sourceRow(id: number) {
  const [row] = await db.select().from($sources).where(eq($sources.id, id));
  return row;
}

// DO 在各测试间共享（isolatedStorage: false），每个测试用自己的 feed URL，互不串状态
let n = 0;
function feedUrl() {
  return `https://feeds.example.com/lifecycle-test-${Date.now()}-${n++}.xml`;
}

async function insertSource(extra: Partial<typeof $sources.$inferInsert> = {}) {
  const [row] = await db
    .insert($sources)
    .values({ url: feedUrl(), name: 'Example', category: 'news', scrape_frequency: 2, ...extra })
    .returning({ id: $sources.id, url: $sources.url });
  return row;
}

/** 插一个源并把它的 DO 拉起来（未暂停的源的正常状态） */
async function activeSource(extra: Partial<typeof $sources.$inferInsert> = {}) {
  const source = await insertSource(extra);
  expect((await api(`/do/admin/source/${source.id}/init`)).status).toBe(200);
  expect((await doOf(source.url)).alarm).not.toBeNull();
  return source;
}

beforeAll(() => {
  // DO 的 alarm 会去抓 feed：拦掉外网，抓取失败即可，不影响这里要看的调度行为
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await db.execute(sql`truncate sources, brief_runs restart identity cascade`);
});

describe('POST /admin/sources', () => {
  it('只给 url：按默认值建源，并立即拉起 DO（不用再手动 initialize-dos）', async () => {
    const url = feedUrl();

    const res = await api('/admin/sources', 'POST', { url });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: number } };
    expect(body.success).toBe(true);
    const row = await sourceRow(body.data.id);
    expect(row).toMatchObject({ url, name: 'Unknown', category: 'news', scrape_frequency: 2 });
    const d = await doOf(url);
    expect(d.alarm).not.toBeNull();
    expect(d.state).toMatchObject({ sourceId: row.id, url, scrapeFrequencyTier: 2 });
  });

  it('url 已存在：409，不新增行', async () => {
    const existing = await insertSource();

    const res = await api('/admin/sources', 'POST', { url: existing.url });

    expect(res.status).toBe(409);
    expect(await db.select().from($sources)).toHaveLength(1);
  });
});

describe('PUT /admin/sources/:id', () => {
  it('改 url：旧 url 的 DO 停掉，新 url 的 DO 拉起', async () => {
    const source = await activeSource();
    const newUrl = feedUrl();

    const res = await api(`/admin/sources/${source.id}`, 'PUT', { url: newUrl });

    expect(res.status).toBe(200);
    expect((await sourceRow(source.id)).url).toBe(newUrl);
    const oldDo = await doOf(source.url);
    expect(oldDo.alarm).toBeNull();
    expect(oldDo.state).toBeUndefined();
    const newDo = await doOf(newUrl);
    expect(newDo.alarm).not.toBeNull();
    expect(newDo.state).toMatchObject({ sourceId: source.id, url: newUrl, scrapeFrequencyTier: 2 });
  });

  it('改抓取档位：DO state 里的 tier 跟着变', async () => {
    const source = await activeSource();

    const res = await api(`/admin/sources/${source.id}`, 'PUT', { scrape_frequency: 4 });

    expect(res.status).toBe(200);
    expect((await sourceRow(source.id)).scrape_frequency).toBe(4);
    const d = await doOf(source.url);
    expect(d.alarm).not.toBeNull();
    expect(d.state?.scrapeFrequencyTier).toBe(4);
  });

  it('暂停中的源改 url：只改表，新旧 DO 都不拉起', async () => {
    const source = await insertSource({ paused_at: new Date() });
    const newUrl = feedUrl();

    const res = await api(`/admin/sources/${source.id}`, 'PUT', { url: newUrl });

    expect(res.status).toBe(200);
    expect((await sourceRow(source.id)).url).toBe(newUrl);
    expect((await doOf(source.url)).alarm).toBeNull();
    expect((await doOf(newUrl)).alarm).toBeNull();
  });

  it('新 url 与别的源冲突：409，表与 DO 都不动', async () => {
    const source = await activeSource();
    const other = await insertSource();

    const res = await api(`/admin/sources/${source.id}`, 'PUT', { url: other.url });

    expect(res.status).toBe(409);
    expect((await sourceRow(source.id)).url).toBe(source.url);
    expect((await doOf(source.url)).alarm).not.toBeNull();
  });

  it('源不存在：404', async () => {
    expect((await api('/admin/sources/999999', 'PUT', { name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /do/admin/source/:id', () => {
  it('删掉源与它的文章，DO 停掉并清空', async () => {
    const source = await activeSource();
    await db.insert($articles).values({ title: 'gone', url: `${source.url}#a1`, sourceId: source.id });

    const res = await api(`/do/admin/source/${source.id}`, 'DELETE');

    expect(res.status).toBe(200);
    expect(await sourceRow(source.id)).toBeUndefined();
    expect(await db.select().from($articles).where(eq($articles.sourceId, source.id))).toHaveLength(0);
    const d = await doOf(source.url);
    expect(d.alarm).toBeNull();
    expect(d.state).toBeUndefined();
  });

  it('删源连带删掉它的文章在 R2 里的正文，不留孤儿对象', async () => {
    const source = await activeSource();
    const key = `test/sources-delete/${source.id}-${Date.now()}.txt`;
    await env.ARTICLES_BUCKET.put(key, 'body');
    await db.insert($articles).values({ title: 'gone', url: `${source.url}#r2`, sourceId: source.id, contentFileKey: key });

    const res = await api(`/do/admin/source/${source.id}`, 'DELETE');

    expect(res.status).toBe(200);
    expect(await env.ARTICLES_BUCKET.get(key)).toBeNull();
  });

  it('有文章被简报引用（lead_article_id）：409 提示改用暂停，源、文章与 DO 都不动', async () => {
    const source = await activeSource();
    const [article] = await db
      .insert($articles)
      .values({ title: 'lead', url: `${source.url}#lead`, sourceId: source.id })
      .returning({ id: $articles.id });
    const workflowId = `wf-${source.id}-${Date.now()}`;
    await db.insert($brief_runs).values({ workflow_id: workflowId });
    await db.insert($brief_stories).values({ workflow_id: workflowId, lead_article_id: article.id });

    const res = await api(`/do/admin/source/${source.id}`, 'DELETE');

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/pause/i);
    expect(await sourceRow(source.id)).toBeDefined();
    expect(await db.select().from($articles).where(eq($articles.sourceId, source.id))).toHaveLength(1);
    expect((await doOf(source.url)).alarm).not.toBeNull();
  });

  it('源不存在：404', async () => {
    expect((await api('/do/admin/source/999999', 'DELETE')).status).toBe(404);
  });
});
