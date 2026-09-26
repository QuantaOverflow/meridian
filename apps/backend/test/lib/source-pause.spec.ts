/**
 * 暂停 / 恢复某个源的自动抓取。走真实路由 + 真实 DO + 本机测试库（BACKEND_TEST_DATABASE_URL，见 test/README.md）。
 */
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { fetchMock } from '../fetch-mock';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $articles, $sources, eq, sql } from '@meridian/database';
import { getDb } from '../../src/lib/database';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);

function api(path: string, method = 'POST') {
  return SELF.fetch(`http://backend${path}`, { method, headers: { Authorization: `Bearer ${env.API_TOKEN}` } });
}

async function alarmOf(url: string) {
  const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
  return runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
}

async function sourceRow(id: number) {
  const [row] = await db.select().from($sources).where(eq($sources.id, id));
  return row;
}

// DO 在各测试间共享（isolatedStorage: false），每个测试用自己的 feed URL，互不串状态
let n = 0;
async function insertSource(extra: Partial<typeof $sources.$inferInsert> = {}) {
  const url = `https://feeds.example.com/pause-test-${Date.now()}-${n++}.xml`;
  const [row] = await db
    .insert($sources)
    .values({ url, name: 'Example', category: 'news', scrape_frequency: 1, ...extra })
    .returning({ id: $sources.id, url: $sources.url });
  return row;
}

beforeAll(() => {
  // DO 的 alarm 会去抓 feed：拦掉外网，抓取失败即可，不影响这里要看的调度行为
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await db.execute(sql`truncate sources restart identity cascade`);
});

describe('POST /do/admin/source/:id/pause', () => {
  it('取消 DO 的自动抓取，源与已有文章保留', async () => {
    const source = await insertSource();
    await db.insert($articles).values({ title: 'kept', url: `${source.url}#a1`, sourceId: source.id });
    expect((await api(`/do/admin/source/${source.id}/init`)).status).toBe(200);
    expect(await alarmOf(source.url)).not.toBeNull();

    const res = await api(`/do/admin/source/${source.id}/pause`);

    expect(res.status).toBe(200);
    expect(await alarmOf(source.url)).toBeNull();
    const row = await sourceRow(source.id);
    expect(row.paused_at).not.toBeNull();
    expect(await db.select().from($articles).where(eq($articles.sourceId, source.id))).toHaveLength(1);
  });

  it('源不存在：404', async () => {
    expect((await api('/do/admin/source/999999/pause')).status).toBe(404);
  });
});

describe('已暂停的源不会被重新拉起', () => {
  it('批量 initialize-dos 跳过已暂停的源', async () => {
    const paused = await insertSource({ paused_at: new Date() });
    const active = await insertSource();

    const res = await api('/do/admin/initialize-dos');

    expect(await res.json()).toEqual({ initialized: 1, total: 1 });
    expect(await alarmOf(paused.url)).toBeNull();
    expect(await alarmOf(active.url)).not.toBeNull();
  });

  it('单个 init 拒绝已暂停的源（要走 resume）', async () => {
    const paused = await insertSource({ paused_at: new Date() });
    expect((await api(`/do/admin/source/${paused.id}/init`)).status).toBe(409);
    expect(await alarmOf(paused.url)).toBeNull();
  });

  // 兜底：DO 已在跑时源被标成暂停（比如暂停时 destroy 失败），下一次 alarm 自己停下
  it('alarm 看到源已暂停：不再排下一次，清空状态', async () => {
    const source = await insertSource();
    expect((await api(`/do/admin/source/${source.id}/init`)).status).toBe(200);
    await db.update($sources).set({ paused_at: new Date() }).where(eq($sources.id, source.id));

    const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(source.url));
    await runDurableObjectAlarm(stub);

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(await state.storage.get('state')).toBeUndefined();
    });
  });
});

describe('POST /do/admin/source/:id/resume', () => {
  it('清掉暂停标记并恢复 DO 的自动抓取', async () => {
    const source = await insertSource({ paused_at: new Date() });

    const res = await api(`/do/admin/source/${source.id}/resume`);

    expect(res.status).toBe(200);
    expect(await alarmOf(source.url)).not.toBeNull();
    const row = await sourceRow(source.id);
    expect(row.paused_at).toBeNull();
    expect(row.do_initialized_at).not.toBeNull();
  });
});
