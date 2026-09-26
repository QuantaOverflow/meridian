import { fetchMock } from '../fetch-mock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { browserTriedFromError, getArticleFetchFirst, getArticleWithBrowser } from '../../src/lib/services/article-fetchers';

/**
 * 假的 Browser Run binding（env.BROWSER）：外部服务的边界在 binding 上，这里按 workers-types
 * 声明的 quickAction('content') 契约回 Response——成功是 { success: true, result, meta }，
 * 失败是 { success: false, errors } 加 4xx/5xx 状态。记下每次调用的参数，供断言请求选项。
 */
function fakeBrowser(reply: () => Response | Promise<Response>) {
  const calls: Array<{ action: string; options: any }> = [];
  return {
    calls,
    binding: {
      async quickAction(action: string, options: unknown) {
        calls.push({ action, options });
        return reply();
      },
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 形状同 workers-types 的 BrowserRunErrorResponse（code 可选）；状态码取它文档里列出的 429
const RATE_LIMITED = () => json(429, { success: false, errors: [{ message: 'Rate limit exceeded' }] });

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('getArticleWithBrowser', () => {
  // 2026-09 生产 40 天全挂：旧代码不看 status/success，直接校验 result，每条失败都记成看不懂的
  // 「Browser response validation failed ... received null」。报错必须带出 HTTP 状态与 API 的错误原文。
  it('Browser Run 返回错误时，报错带出 HTTP 状态与 API 的错误原文', async () => {
    const browser = fakeBrowser(RATE_LIMITED);
    await expect(getArticleWithBrowser({ BROWSER: browser.binding } as any, 'https://www.politico.com/')).rejects.toThrow(
      /429.*Rate limit exceeded/
    );
  });

  it('binding 调用本身抛错时，报错带出原因', async () => {
    const browser = fakeBrowser(() => {
      throw new Error('The RPC receiver does not implement the method "quickAction"');
    });
    await expect(getArticleWithBrowser({ BROWSER: browser.binding } as any, 'https://www.politico.com/')).rejects.toThrow(
      /does not implement the method "quickAction"/
    );
  });

  // 从 REST 迁到 binding 时不许丢任何一个请求选项（字段名与 REST /content 相同）
  it('走 content 动作，带齐现有全部请求选项', async () => {
    const browser = fakeBrowser(RATE_LIMITED);
    await getArticleWithBrowser({ BROWSER: browser.binding } as any, 'https://www.politico.com/').catch(() => {});
    expect(browser.calls).toHaveLength(1);
    const { action, options } = browser.calls[0];
    expect(action).toBe('content');
    expect(options.url).toBe('https://www.politico.com/');
    expect(typeof options.userAgent).toBe('string');
    expect(options.setExtraHTTPHeaders).toMatchObject({ Accept: expect.any(String), DNT: '1', 'Sec-Fetch-Mode': 'navigate' });
    expect(options.cookies).toEqual([]);
    expect(options.gotoOptions).toEqual({ waitUntil: 'networkidle0', timeout: 30000, referer: 'https://www.google.com/' });
    expect(options.viewport).toEqual({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false });
    expect(options.rejectResourceTypes).toEqual(['image', 'media', 'font', 'websocket']);
    expect(options.bestAttempt).toBe(true);
    expect(options.addScriptTag).toHaveLength(7);
    expect(options.waitForSelector).toEqual({ selector: 'article, .article, .content, .post, #article, main', timeout: 5000 });
  });
});

describe('getArticleFetchFirst', () => {
  const ARTICLE = 'https://www.example-news.com/2026/09/26/story';
  const BODY = 'Officials confirmed the agreement on Friday after weeks of negotiation. '.repeat(20);
  const HTML = `<html><head><title>Deal reached</title></head><body><article><h1>Deal reached</h1><p>${BODY}</p><p>${BODY}</p></article></body></html>`;

  function articleSite() {
    return fetchMock.get('https://www.example-news.com').intercept({ path: '/2026/09/26/story', method: 'GET' });
  }

  it('fetch 成功：不走浏览器，used_browser=false', async () => {
    const browser = fakeBrowser(RATE_LIMITED);
    articleSite().reply(200, HTML);
    const res = await getArticleFetchFirst({ BROWSER: browser.binding } as any, ARTICLE, async () => {});
    expect(res.used_browser).toBe(false);
    expect(res.html.title).toBe('Deal reached');
    expect(browser.calls).toHaveLength(0);
  });

  it('fetch 失败、浏览器成功：used_browser=true', async () => {
    const browser = fakeBrowser(() => json(200, { success: true, result: HTML, meta: { status: 200, title: 'Deal reached' } }));
    articleSite().replyWithError(new Error('connection reset by peer'));
    const res = await getArticleFetchFirst({ BROWSER: browser.binding } as any, ARTICLE, async () => {});
    expect(res.used_browser).toBe(true);
    expect(res.html.title).toBe('Deal reached');
  });

  // 两条路都失败时，workflow 只拿得到这条报错（step.do 重试耗尽后只剩报错消息），它原样落进 fail_reason。
  // 旧行为只剩浏览器那一半：fetch 为什么失败丢了，也看不出这篇试过浏览器（used_browser 只能留 NULL）。
  it('fetch 与浏览器都失败：报错里两边的失败原因都在', async () => {
    const browser = fakeBrowser(RATE_LIMITED);
    articleSite().replyWithError(new Error('connection reset by peer'));
    const err: Error = await getArticleFetchFirst({ BROWSER: browser.binding } as any, ARTICLE, async () => {}).then(
      () => { throw new Error('expected rejection'); },
      e => e
    );
    expect(err.message).toMatch(/429.*Rate limit exceeded/);
    expect(err.message).toMatch(/fetch/i);
    expect(err.message).toMatch(/connection reset by peer/);
    expect(browserTriedFromError(err.message)).toBe(true);
  });

  it('反向对照：不是两条路都失败的报错，不判为试过浏览器', () => {
    expect(browserTriedFromError('Browser Rendering API 401: 10000 Authentication error')).toBe(false);
    expect(browserTriedFromError('WorkflowInternalError: Attempt failed due to internal workflows error')).toBe(false);
  });
});
