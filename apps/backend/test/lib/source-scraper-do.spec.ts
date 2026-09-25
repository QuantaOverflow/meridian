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
