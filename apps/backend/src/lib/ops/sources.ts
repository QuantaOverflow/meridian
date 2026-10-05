import type { Context } from 'hono';
import type { Env } from '../../index';

// 运维台 sources 端点：占位，实现见 .scratch/ops-console/issues 的 02 号票。响应类型在 @meridian/contracts 的 ops-console.ts
export async function opsSources(c: Context<{ Bindings: Env }>): Promise<Response> {
  return c.json({ error: 'not implemented' }, 501);
}
