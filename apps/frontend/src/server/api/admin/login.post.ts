import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const loginSchema = z.object({ username: z.string(), password: z.string() });

/**
 * 恒定时间比较：`!==` 在第一个不同的字符处就返回，响应时间会泄露猜对了几位。
 * 两边先取 SHA-256 定长，再 timingSafeEqual（不等长会直接抛错，定长也避免泄露长度）。
 * 用 node:crypto 而不是 crypto.subtle.timingSafeEqual：后者只有 Workers 运行时有，
 * 而前端测试跑在 Node 里；Pages 开了 nodejs_compat，两边都有 node:crypto。
 */
function sameSecret(provided: string, expected: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export default eventHandler(async event => {
  const config = useRuntimeConfig(event);

  const bodyResult = loginSchema.safeParse(await readBody(event));
  if (bodyResult.success === false) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  const { username, password } = bodyResult.data;
  // 管理员账号没配置时一律拒绝（与 backend 的 API_TOKEN 同理），不拿 undefined 去比
  if (!config.admin.username || !config.admin.password) {
    throw createError({ statusCode: 401, message: 'Wrong password' });
  }
  // 两项都比完再判，不因用户名错就提前返回
  const usernameOk = sameSecret(username, config.admin.username);
  const passwordOk = sameSecret(password, config.admin.password);
  if (!usernameOk || !passwordOk) {
    throw createError({ statusCode: 401, message: 'Wrong password' });
  }

  try {
    await setUserSession(event, { user: { login: 'admin' }, loggedInAt: Date.now() });
  } catch (error) {
    console.error('Failed to set user session', error);
    throw createError({ statusCode: 500, message: 'Failed to set user session' });
  }

  return setResponseStatus(event, 201);
});
