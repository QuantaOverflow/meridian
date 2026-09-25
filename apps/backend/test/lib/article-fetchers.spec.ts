import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { browserTriedFromError, getArticleFetchFirst, getArticleWithBrowser } from '../../src/lib/services/article-fetchers';

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

describe('getArticleFetchFirst', () => {
  const ARTICLE = 'https://www.example-news.com/2026/09/26/story';
  const BODY = 'Officials confirmed the agreement on Friday after weeks of negotiation. '.repeat(20);
  const HTML = `<html><head><title>Deal reached</title></head><body><article><h1>Deal reached</h1><p>${BODY}</p><p>${BODY}</p></article></body></html>`;
  const env = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: 'token' } as any;

  function browserApi() {
    return fetchMock
      .get('https://api.cloudflare.com')
      .intercept({ path: `/client/v4/accounts/${ACCOUNT}/browser-rendering/content`, method: 'POST' });
  }
  function articleSite() {
    return fetchMock.get('https://www.example-news.com').intercept({ path: '/2026/09/26/story', method: 'GET' });
  }

  it('fetch 成功：不走浏览器，used_browser=false', async () => {
    articleSite().reply(200, HTML);
    const res = await getArticleFetchFirst(env, ARTICLE, async () => {});
    expect(res.used_browser).toBe(false);
    expect(res.html.title).toBe('Deal reached');
  });

  it('fetch 失败、浏览器成功：used_browser=true', async () => {
    articleSite().replyWithError(new Error('connection reset by peer'));
    browserApi().reply(200, { success: true, result: HTML, errors: [], messages: [] });
    const res = await getArticleFetchFirst(env, ARTICLE, async () => {});
    expect(res.used_browser).toBe(true);
  });

  // 两条路都失败时，workflow 只拿得到这条报错（step.do 重试耗尽后只剩报错消息），它原样落进 fail_reason。
  // 旧行为只剩浏览器那一半：fetch 为什么失败丢了，也看不出这篇试过浏览器（used_browser 只能留 NULL）。
  it('fetch 与浏览器都失败：报错里两边的失败原因都在', async () => {
    articleSite().replyWithError(new Error('connection reset by peer'));
    browserApi().reply(401, { result: null, success: false, errors: [{ code: 10000, message: 'Authentication error' }], messages: [] });
    const err: Error = await getArticleFetchFirst(env, ARTICLE, async () => {}).then(
      () => { throw new Error('expected rejection'); },
      e => e
    );
    expect(err.message).toMatch(/401.*Authentication error/);
    expect(err.message).toMatch(/fetch/i);
    expect(err.message).toMatch(/connection reset by peer/);
    expect(browserTriedFromError(err.message)).toBe(true);
  });

  it('反向对照：不是两条路都失败的报错，不判为试过浏览器', () => {
    expect(browserTriedFromError('Browser Rendering API 401: 10000 Authentication error')).toBe(false);
    expect(browserTriedFromError('WorkflowInternalError: Attempt failed due to internal workflows error')).toBe(false);
  });
});
