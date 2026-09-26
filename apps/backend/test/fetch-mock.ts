/**
 * 替代 vitest-pool-workers 0.13 起删掉的 `fetchMock`（`cloudflare:test`）。只实现本仓测试用到的那部分，语义照旧：
 * - 拦截器默认一次性：匹配一次就消耗掉；`.times(n)` 让它匹配 n 次（undici MockAgent 的行为）
 * - `disableNetConnect()` 之后，没有拦截器匹配的请求直接失败，不出网
 * - `assertNoPendingInterceptors()`：还有没被用掉的拦截器就报错
 *
 * 做法是替换 `globalThis.fetch`：`main` worker（含 DO）与测试跑在同一个 isolate，
 * 所以被测代码里的 fetch 也会走到这里（见 @cloudflare/vitest-pool-workers 的 `SELF` 注释）。
 */

type Reply = { status: number; body: unknown } | { error: Error };

interface Interceptor {
  origin: string;
  path: string;
  method: string;
  reply?: Reply;
  remaining: number;
}

const pending: Interceptor[] = [];
let realFetch: typeof fetch | undefined;
let netConnect = true;

function toResponse(reply: Extract<Reply, { status: number }>) {
  const body = reply.body === undefined || typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
  return new Response(body as string | undefined, { status: reply.status });
}

const mockedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const index = pending.findIndex(
    i => i.origin === url.origin && i.path === url.pathname + url.search && i.method === request.method.toUpperCase()
  );
  if (index === -1) {
    if (netConnect) return realFetch!(input, init);
    throw new TypeError(`fetchMock: 没有匹配的拦截器，且已禁止出网: ${request.method} ${request.url}`);
  }
  const interceptor = pending[index];
  if (--interceptor.remaining === 0) pending.splice(index, 1);
  const reply = interceptor.reply;
  if (!reply) throw new Error(`fetchMock: 拦截器没有设置回复: ${request.method} ${request.url}`);
  if ('error' in reply) throw reply.error;
  return toResponse(reply);
};

export const fetchMock = {
  activate() {
    if (realFetch) return;
    realFetch = globalThis.fetch;
    globalThis.fetch = mockedFetch;
  },
  disableNetConnect() {
    netConnect = false;
  },
  get(origin: string) {
    return {
      intercept({ path, method = 'GET' }: { path: string; method?: string }) {
        const interceptor: Interceptor = { origin: new URL(origin).origin, path, method: method.toUpperCase(), remaining: 1 };
        pending.push(interceptor);
        const scope = {
          times(n: number) {
            interceptor.remaining = n;
          },
        };
        return {
          reply(status: number, body?: unknown) {
            interceptor.reply = { status, body };
            return scope;
          },
          replyWithError(error: Error) {
            interceptor.reply = { error };
            return scope;
          },
        };
      },
    };
  },
  assertNoPendingInterceptors() {
    if (pending.length === 0) return;
    const list = pending.map(i => `${i.method} ${i.origin}${i.path}`).join('\n');
    throw new Error(`fetchMock: 还有 ${pending.length} 个拦截器没被用到:\n${list}`);
  },
};
