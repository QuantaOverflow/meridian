import { env, runInDurableObject } from 'cloudflare:test';
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
      self.env = { ...self.env, HYPERDRIVE: { connectionString: 'postgresql://u:p@127.0.0.1:1/none' } as Hyperdrive };
      await instance.alarm();
      expect(await state.storage.getAlarm()).not.toBeNull();
      await instance.destroy();
    });
  });
});
