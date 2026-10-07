/**
 * 国家页的数据：backend `GET /reader/countries/:code/blocks` 的响应体，前端 `/api/countries/:code/blocks` 在它之上加展示字段。
 * 写方：backend lib/reader/country-blocks.ts。读方：frontend 国家页。
 * 国家页分两节，各自分页：落点在该国的块、涉及该国的块（见 GLOSSARY.md「落点」「涉及」）。只含已发布各期的块。
 */
import type { BriefBlock } from './brief-block';
import type { BlockCountries } from './placement';

/** placement = 落点在该国；mention = 涉及该国（落点不在该国） */
export type CountrySection = 'placement' | 'mention';

/** 列在国家页上的一块：块本身加它对国家的归属 */
export interface CountryBlock extends BriefBlock {
  countries: BlockCountries;
}

export interface CountryBlocksPage {
  /** ISO 3166-1 alpha-2 大写，联合国为 `UN` */
  country: string;
  section: CountrySection;
  /** 这一节的总块数（与分页无关） */
  total: number;
  /** 按所属期的时间倒序，同一期内按正文顺序 */
  items: CountryBlock[];
}
