import type { H3Event } from 'h3';

/**
 * `/api/briefs/:slug*` 的 slug → 期号。slug 只认期号（如 `72`）：库里同一天常有多期，按日期定位会歧义。
 * 缺参数或不是纯数字 → 400。
 */
export function briefIdFromSlug(event: H3Event): number {
  const slug = getRouterParam(event, 'slug');
  if (slug === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' });
  }
  if (!/^\d+$/.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid slug' });
  }
  return Number(slug);
}
