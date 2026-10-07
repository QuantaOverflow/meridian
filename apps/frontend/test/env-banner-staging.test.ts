/**
 * NUXT_PUBLIC_ENVIRONMENT=staging：读者页与运维台的每个页面顶部有 STAGING 横幅，并声明不让搜索引擎收录。
 */
import { describe, expect, it } from 'vitest';
import { startSite } from './env-banner-harness';

const site = await startSite('staging');

describe('staging 环境的页面', () => {
  it('读者首页、归档、运维台 Health 与登录页都有 STAGING 横幅与 noindex', async () => {
    const pages = await site.pages();
    for (const [path, html] of Object.entries(pages)) {
      expect(html, `${path} 缺横幅`).toContain('STAGING');
      expect(html, `${path} 缺 noindex`).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex, nofollow"/);
    }
  });
});
