import type { Context } from 'hono';
import type { OpsSources } from '@meridian/contracts';
import type { Env } from '../../index';
import { getDb } from '../database';
import { computeSourceStatuses, countByKind, SOURCE_THRESHOLDS } from './source-status';

/** 运维台 Sources 视图：判据与阈值在 source-status.ts，响应类型在 @meridian/contracts 的 ops-console.ts */
export async function opsSources(c: Context<{ Bindings: Env }>): Promise<Response> {
  const now = new Date();
  const sources = await computeSourceStatuses(getDb(c.env.HYPERDRIVE), now);
  const body: OpsSources = {
    generatedAt: now.toISOString(),
    counts: countByKind(sources),
    sources,
    thresholds: SOURCE_THRESHOLDS,
  };
  return c.json(body);
}
