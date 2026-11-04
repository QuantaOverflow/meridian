import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SourceScraperDO } from '../../src/durable_objects/sourceScraperDO';

describe('SourceScraperDO.destroy', () => {
  it('取消 alarm 并清空 storage——删源后 DO 不再按周期抓取', async () => {
    const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName('https://example.com/feed.xml'));

    await runInDurableObject(stub, async (_instance: SourceScraperDO, state) => {
      await state.storage.put('state', { sourceId: 1, url: 'https://example.com/feed.xml', scrapeFrequencyTier: 2, lastChecked: null });
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    await stub.destroy();

    await runInDurableObject(stub, async (_instance: SourceScraperDO, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(await state.storage.get('state')).toBeUndefined();
    });
  });
});

describe('SourceScraperDO.alarm', () => {
  // alarm 触发时旧 alarm 已被消费；排下一次之前任何一步抛错（这里是连不上库）都会让 DO 永久停抓
  it('排下一次之前数据库不可用：仍排上下一次 alarm', async () => {
    const url = 'https://example.com/db-down-feed.xml';
    const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));

    await runInDurableObject(stub, async (instance: SourceScraperDO, state) => {
      await state.storage.put('state', { sourceId: 1, url, scrapeFrequencyTier: 1, lastChecked: null });
      const self = instance as unknown as { env: Env };
      // 取连接串即抛错来模拟库不可用：真连死端口时 postgres 驱动内部有个没人接的 socket promise，会变成测试进程的 unhandled rejection
      const downHyperdrive = {
        get connectionString(): string {
          throw new Error('database unavailable');
        },
      } as unknown as Hyperdrive;
      self.env = { ...self.env, HYPERDRIVE: downHyperdrive };
      await instance.alarm();
      expect(await state.storage.getAlarm()).not.toBeNull();
      await instance.destroy();
    });
  });

  // 各源对齐到同一个整点、只在两分钟里错开：库每小时只被唤醒一次（错开抓时 Neon 免费额度 10-27 用光）
  it('下一次 alarm 排在下一个整点之后、按源 id 错开的两分钟窗口里', async () => {
    const url = 'https://example.com/aligned-feed.xml';
    const stub = env.SOURCE_SCRAPER.get(env.SOURCE_SCRAPER.idFromName(url));
    const hour = 60 * 60 * 1000;

    await runInDurableObject(stub, async (instance: SourceScraperDO, state) => {
      await state.storage.put('state', { sourceId: 7, url, scrapeFrequencyTier: 1, lastChecked: null });
      const self = instance as unknown as { env: Env };
      const downHyperdrive = {
        get connectionString(): string {
          throw new Error('database unavailable');
        },
      } as unknown as Hyperdrive;
      self.env = { ...self.env, HYPERDRIVE: downHyperdrive };
      const before = Date.now();
      await instance.alarm();
      const after = Date.now();
      const alarm = await state.storage.getAlarm();
      // 测试跨过整点时两边都算对
      const expected = [before, after].map(t => (Math.floor(t / hour) + 1) * hour + 7_000);
      expect(expected).toContain(alarm);
      await instance.destroy();
    });
  });
});
