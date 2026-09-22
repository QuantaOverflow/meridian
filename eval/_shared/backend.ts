// backend 访问的单一出口。/admin 与 /observability 都已加鉴权（app.ts 挂载处的
// hasValidAuthToken 中间件），所以所有 eval 脚本打 backend 必须带 API_TOKEN。
//
// 为什么集中到一处：此前 17 个脚本各写各的 fetch、无一带 token，/admin 加鉴权后
// (commit 22521fa) 打 admin 的那批已经静默 401 断了没人发现。token 逻辑只写这一处，
// 新脚本 import 即自动合规——合规成为默认，不靠人记得。
//
// 迁移最小化：只替换「发请求」这一步（fetch → backendFetch），每个脚本保留自己的
// .ok / .json() / .text() 处理，降低改错返回解析的风险。

export const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';

const API_TOKEN = process.env.API_TOKEN;

/**
 * 打 backend，自动注入 Bearer token。
 * @param path 以 / 开头的路径（不含 host），如 `/observability/runs/${wf}`
 * @param init  原样透传给 fetch，可带 method/body/额外 headers
 *
 * API_TOKEN 未设时不加 header——留给「打本地未鉴权 wrangler dev」的场景；
 * 打生产会得到 401，错误信息里能看出是缺 token（见调用方的 !ok 处理）。
 */
export function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers: authHeaders(init.headers) });
}

/**
 * 只返回带 token 的 Headers，给已有自己 fetch 包装器（收完整 url 的 fetchJSON/j）的
 * 旧脚本用——迁移时只需 `fetch(url, { headers: authHeaders() })`，不动 BACKEND_URL 与调用处。
 * admin POST 传 `authHeaders({ 'Content-Type': 'application/json' })` 合并已有头。
 * 新脚本直接用上面的 backendFetch。
 */
export function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (API_TOKEN) headers.set('Authorization', `Bearer ${API_TOKEN}`);
  return headers;
}
