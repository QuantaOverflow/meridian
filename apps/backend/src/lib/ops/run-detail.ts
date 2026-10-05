import type { Context } from 'hono';
import type { Env } from '../../index';

// 运维台 run-detail 端点：占位，实现见 .scratch/ops-console/issues 的 05 号票。响应类型在 @meridian/contracts 的 ops-console.ts
export async function opsRunDetail(c: Context<{ Bindings: Env }>): Promise<Response> {
  return c.json({ error: 'not implemented' }, 501);
}
