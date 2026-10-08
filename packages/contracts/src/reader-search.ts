/**
 * 搜索的数据：backend `GET /reader/search` 的响应体，前端 `/api/search` 在它之上加展示字段。
 * 写方：backend lib/reader/search-blocks.ts。读方：frontend 搜索页。
 * Postgres 英文全文检索，只搜已发布各期的简报块标题与正文。结果按线索折叠：同一线索的块归成一组，分页按组数。
 */
import type { BriefBlock } from './brief-block';

/** 一组命中所属的线索（见 GLOSSARY.md「线索」）；只有过了线索门槛、有线索页的才给 */
export interface SearchThread {
  /** story_clusters.id → 线索页 `/stories/{id}` */
  id: number;
  title: string;
  /** 这条线索出现在几期简报里 */
  briefCount: number;
}

/** 命中的块归成的一组：同一线索的块一组；所属故事没并进任何线索的块自成一组 */
export interface SearchGroup {
  thread: SearchThread | null;
  /** 这一组命中的总块数；`blocks` 只带最新的若干块时比它的长度大 */
  blockCount: number;
  /** 命中的块，按所属期的时间倒序 */
  blocks: BriefBlock[];
}

export interface SearchPage {
  /** 去掉首尾空白后的查询串 */
  query: string;
  /** 命中的组数（分页的单位） */
  total: number;
  /** 命中的总块数 */
  totalBlocks: number;
  /** 按组内最高的相关度排，相同则最新的在前 */
  items: SearchGroup[];
}
