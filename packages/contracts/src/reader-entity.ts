/**
 * 实体页的数据：backend `GET /reader/entities/blocks?name=…` 与 `GET /reader/block-entities?ids=…` 的响应体，
 * 前端 `/api/entities/blocks` 与各列块的接口在它之上加展示字段。
 * 写方：backend lib/reader/entity-blocks.ts。读方：frontend 实体页与块下的实体链接。
 * 实体（见 GLOSSARY.md「实体」）是文章分析给的人物、机构、地名的写法，只做大小写与首尾空白归一，不合并别名：
 * 同一个人的两种拼法是两个实体。能归成国家的写法不是实体（它走国家页），媒体名也不是。
 * 只有出现在足够多已发布简报块里的实体才有实体页（门槛在 backend）。
 */
import type { CountryBlock } from './reader-country';

export interface BlockEntity {
  /** 归一后的写法（小写、去首尾空白），实体页按它查 */
  key: string;
  /** 显示用的写法：原文里最常见的那种 */
  name: string;
}

/**
 * 实体页的一页。查的写法能归成国家时不开页（kind: 'country'），页面跳国家页；
 * 没过门槛的实体 backend 回 404。只含已发布各期的块。
 */
export type EntityBlocksPage =
  | {
      kind: 'entity';
      entity: BlockEntity;
      /** 这个实体的总块数（与分页无关） */
      total: number;
      /** 按所属期的时间倒序，同一期内按正文顺序 */
      items: CountryBlock[];
    }
  | { kind: 'country'; country: string };

/** 一次请求最多问几块的实体；超过回 400。取搜索一页最多带回的块数（50 组 × 每组 10 块） */
export const MAX_BLOCK_ENTITY_IDS = 500;

/** 一批块各自的相关实体：只列有实体页的（过了门槛的），没有的块不在其中 */
export interface BlockEntitiesList {
  items: { blockId: number; entities: BlockEntity[] }[];
}

/** 实体列表页（backend `GET /reader/entities`）：全部有实体页的实体，块数多的在前，一样多按写法 */
export interface EntityIndex {
  items: (BlockEntity & { /** 这个实体在已发布各期的块数 */ blocks: number })[];
}

/**
 * 一期里各块的相关实体（backend `GET /reader/briefs/:id/block-entities`），阅读页每块下的实体链接用。
 * position 是块在这一期正文里的顺序（从 0 起）；只列有实体页的实体，没有的块不在其中。未发布或不存在的期是空的。
 */
export interface BriefBlockEntities {
  items: { position: number; entities: BlockEntity[] }[];
}
