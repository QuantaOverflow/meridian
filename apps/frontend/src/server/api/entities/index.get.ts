import type { EntityIndex } from '@meridian/contracts';
import { entityHref } from '~/lib/entities';
import { readFromBackend } from '~/server/lib/backend';
import type { EntityIndexResponse } from '~/shared/types';

/** 实体列表页：全部有实体页的实体，块数多的在前。门槛与排序在 backend 的 /reader/entities，这里只加实体页的地址 */
export default defineEventHandler(async (): Promise<EntityIndexResponse> => {
  const index = await readFromBackend<EntityIndex>('/reader/entities');
  return { items: index.items.map(e => ({ name: e.name, href: entityHref(e.key), blocks: e.blocks })) };
});
