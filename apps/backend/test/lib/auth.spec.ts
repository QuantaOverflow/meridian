/**
 * 挂载处的 token 门（app.ts 里 /admin、/do、/events、/observability、/reader 的中间件）。
 * 打 POST /admin/briefs/generate 带一个类型错的请求体：过了门会被 zValidator 回 400、
 * 不会真的启动 workflow；没过门回 401。
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function generate(auth?: string) {
  return SELF.fetch('http://backend/admin/briefs/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth === undefined ? {} : { Authorization: auth }) },
    body: JSON.stringify({ articleLimit: 'not-a-number' }),
  });
}

describe('token 门', () => {
  it('没带 Authorization：401', async () => {
    expect((await generate()).status).toBe(401);
  });

  it('token 错（与正确值等长）：401', async () => {
    const wrong = 'x'.repeat(String(env.API_TOKEN).length);
    expect((await generate(`Bearer ${wrong}`)).status).toBe(401);
  });

  it('token 错（长度不同）或少了 Bearer 前缀：401', async () => {
    expect((await generate('Bearer short')).status).toBe(401);
    expect((await generate(String(env.API_TOKEN))).status).toBe(401);
  });

  it('token 对：过门（被请求体校验挡下回 400，而不是 401）', async () => {
    expect((await generate(`Bearer ${env.API_TOKEN}`)).status).toBe(400);
  });
});
