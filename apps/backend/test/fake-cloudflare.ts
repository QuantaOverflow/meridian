/**
 * 假的 Cloudflare GraphQL Analytics 服务，给运维台的测试用（被测代码在 src/lib/ops/cloudflare.ts）。
 * wrangler.test.jsonc 把 CF_API_BASE_URL 指到一个不存在的域名，这里替换 `globalThis.fetch`，只接那个域名的请求
 * （worker 与测试同一个 isolate，做法同 test/fetch-mock.ts），其余请求照常放行。
 *
 * 用法：`const cf = fakeCloudflare(env.CF_API_BASE_URL)`，每个测试里设 `cf.answer`：按查询里出现的数据集名回行，
 * 或回一个 `Response`（模拟 HTTP 错误），或抛错（模拟连不上）。`cf.requests` 记下每次请求供断言。
 */

export interface FakeCloudflareRequest {
  /** 这次查询读的数据集，如 `aiInferenceAdaptiveGroups` */
  dataset: string;
  query: string;
  variables: Record<string, string>;
  authorization: string | null;
}

/** 回数据集的行；或 `{ errors }` 模拟 GraphQL 层报错；或 `Response` 模拟 HTTP 层报错 */
export type FakeCloudflareAnswer = unknown[] | { errors: Array<{ message: string }> } | Response;

export interface FakeCloudflare {
  answer: (request: FakeCloudflareRequest) => FakeCloudflareAnswer;
  requests: FakeCloudflareRequest[];
  /** 清空请求记录，回答恢复成「所有数据集都没有行」 */
  reset(): void;
  /** 把 fetch 换回去 */
  restore(): void;
}

export function fakeCloudflare(baseUrl: string): FakeCloudflare {
  const endpoint = `${baseUrl}/graphql`;
  const realFetch = globalThis.fetch;
  const noRows = () => [];

  const fake: FakeCloudflare = {
    answer: noRows,
    requests: [],
    reset() {
      fake.answer = noRows;
      fake.requests.length = 0;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== endpoint) return realFetch(input, init);
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const { query, variables } = (await request.json()) as { query: string; variables: Record<string, string> };
    // 数据集 = accounts(...) { 之后的第一个字段名
    const dataset = query.match(/accounts\s*\([^)]*\)\s*\{\s*(\w+)/)?.[1] ?? '';
    const recorded = { dataset, query, variables, authorization: request.headers.get('authorization') };
    fake.requests.push(recorded);

    const answer = fake.answer(recorded);
    if (answer instanceof Response) return answer;
    if (!Array.isArray(answer)) return Response.json({ data: null, errors: answer.errors });
    return Response.json({ data: { viewer: { accounts: [{ [dataset]: answer }] } }, errors: null });
  };

  return fake;
}
