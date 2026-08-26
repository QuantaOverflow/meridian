import { loadBriefDetail } from '~/server/lib/briefDetail';
import type { BriefDetail } from '~/shared/types';

export default defineEventHandler(async (event): Promise<BriefDetail> => {
  const slug = getRouterParam(event, 'slug');
  if (slug === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' });
  }

  // slug 有两种形态：
  //   期号（如 `72`）—— 规范形态，一期一个，不会歧义
  //   日期（如 `august-25-2026`）—— 旧链接，保留兼容
  //
  // 为什么不能只用日期：库里 72 期分布在 28 天，其中 10 天有多期、涉及 54 期，
  // 单日最多 28 期（早期测试与重跑）。按日期查只能返回其中一期，归档里四分之三的
  // 「第 N 期」会点到别的期上去。
  let target: Parameters<typeof loadBriefDetail>[1];
  if (/^\d+$/.test(slug)) {
    target = { kind: 'id', id: Number(slug) };
  } else {
    const date = new Date(slug);
    if (isNaN(date.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid slug' });
    }
    target = { kind: 'date', date };
  }

  const brief = await loadBriefDetail(event, target);
  if (brief === null) {
    throw createError({ statusCode: 404, statusMessage: 'Report not found' });
  }

  return brief;
});
