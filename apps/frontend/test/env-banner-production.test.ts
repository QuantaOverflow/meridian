/**
 * 没设 NUXT_PUBLIC_ENVIRONMENT（缺省 production）：页面上既没有 STAGING 横幅，也没有 noindex。
 */
import { describe, expect, it } from 'vitest';
import { startSite } from './env-banner-harness';

const site = await startSite(undefined);

describe('缺省（production）环境的页面', () => {
  it('读者首页、归档、运维台 Health 与登录页都没有横幅、没有 noindex', async () => {
    const pages = await site.pages();
    for (const [path, html] of Object.entries(pages)) {
      expect(html, `${path} 不该有横幅`).not.toContain('STAGING');
      expect(html, `${path} 不该有 noindex`).not.toMatch(/name="robots"/);
    }
  });
});
