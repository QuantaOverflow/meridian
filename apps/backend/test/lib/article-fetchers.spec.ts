import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getArticleWithBrowser } from '../../src/lib/services/article-fetchers';

const ACCOUNT = 'c8317cfcb330d45b37b00ccd7e8a9936';

describe('getArticleWithBrowser', () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => fetchMock.assertNoPendingInterceptors());

  // 生产上 CLOUDFLARE_API_TOKEN 从没配过，请求带 `Bearer undefined`，Browser Rendering API 回 401。
  // 响应体是 2026-09-25 对生产同配置复现时抓到的原文。旧代码不看 status/success，直接校验 result，
  // 于是 40 天里每条失败都记成看不懂的「Browser response validation failed ... received null」。
  it('API 返回错误时，报错带出 HTTP 状态与 API 的错误原文', async () => {
    fetchMock
      .get('https://api.cloudflare.com')
      .intercept({ path: `/client/v4/accounts/${ACCOUNT}/browser-rendering/content`, method: 'POST' })
      .reply(401, {
        result: null,
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        messages: [],
      });

    const env = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: undefined } as any;
    await expect(getArticleWithBrowser(env, 'https://www.politico.com/')).rejects.toThrow(
      /401.*Authentication error/
    );
  });
});
