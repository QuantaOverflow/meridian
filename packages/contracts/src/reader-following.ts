/**
 * Following 页的数据：backend `GET /reader/following` 的响应体，前端 `/api/following` 在它之上加展示字段。
 * 写方：backend lib/reader/following-blocks.ts。读方：frontend Following 页。
 * 关注项（见 GLOSSARY.md「关注项」）只记在读者的浏览器里，每次请求由前端带上来：`countries` 是逗号分隔的国家代码，
 * `threads` 是逗号分隔的线索号。返回命中任一关注项的块，只含已发布各期的块，最新的在前。
 */
import type { BriefBlock } from './brief-block';
import type { BlockCountries } from './placement';
import type { CountrySection } from './reader-country';
import type { SearchThread } from './reader-search';

/** 一次请求里每类关注项最多带几个；超过回 400 */
export const MAX_FOLLOWS_PER_KIND = 100;

/**
 * 一块命中了哪个关注项。关注一个国家 = 落点在该国的块（via: placement）+ 涉及该国的块（via: mention），
 * 后者在页面上标注「涉及」。
 */
export type FollowMatch = { kind: 'country'; code: string; via: CountrySection } | { kind: 'thread'; id: number };

/** 列在 Following 页上的一块：块本身、它对国家的归属、命中的关注项（至少一个；国家在前，线索在后） */
export interface FollowingBlock extends BriefBlock {
  countries: BlockCountries;
  matches: FollowMatch[];
}

export interface FollowingPage {
  /** 命中的总块数（与分页无关） */
  total: number;
  /** 按所属期的时间倒序，同一期内按正文顺序 */
  items: FollowingBlock[];
  /** 请求里的线索中现在有线索页的那些（标题会随最新进展变，页面以这里的为准）；没过线索门槛的不在其中，但它的块照常命中 */
  threads: SearchThread[];
}
