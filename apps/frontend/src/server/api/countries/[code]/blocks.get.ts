import { z } from 'zod';
import type { CountryBlocksPage } from '@meridian/contracts';
import { countryName } from '~/lib/briefMap';
import { readFromBackend } from '~/server/lib/backend';
import { toBlockItem } from '~/server/lib/blockItem';
import type { CountryBlocksResponse } from '~/shared/types';

const querySchema = z.object({
  section: z.enum(['placement', 'mention']).default('placement'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * 国家页的一节（落点在该国 / 涉及该国）。查询与分页在 backend 的 /reader/countries/:code/blocks，
 * 这里只做展示：正文 markdown → HTML、英文日期、国家英文名、指向阅读页那一块的链接。
 */
export default defineEventHandler(async (event): Promise<CountryBlocksResponse> => {
  const code = getRouterParam(event, 'code') ?? '';
  if (!/^[A-Za-z]{2}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid country code' });
  }
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid query parameters' });
  }
  const { section, limit, offset } = parsed.data;

  const page = await readFromBackend<CountryBlocksPage>(
    `/reader/countries/${code.toUpperCase()}/blocks?section=${section}&limit=${limit}&offset=${offset}`,
    'Country not found'
  );

  return {
    country: page.country,
    name: countryName(page.country),
    section: page.section,
    total: page.total,
    items: page.items.map(block => ({
      ...toBlockItem(block),
      placedIn: block.countries.placement === null ? null : countryName(block.countries.placement),
      alsoInvolves: block.countries.mentions.filter(c => c !== page.country).map(countryName),
    })),
  };
});
