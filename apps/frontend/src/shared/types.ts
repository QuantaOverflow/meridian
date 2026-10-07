import type { BriefTier, CountrySection } from '@meridian/contracts';
import type { BriefSection } from '~/server/lib/briefContent';
import type { BriefSource } from '~/server/lib/backend';

/** 一期简报的完整读者视图，由 /api/briefs/:slug 返回 */
export interface BriefDetail {
  id: number;
  slug: string;
  /** 由模型产出的关键词串，不是一句标题 */
  title: string;
  createdAt: Date;
  /** "August 25, 2026" */
  dateLabel: string;
  /** 面向读者的散文摘要；历史期在回填前为 null */
  tldrProse: string | null;
  sections: BriefSection[];
  storyCount: number;
  readingMinutes: number;
  usedArticles: number;
  usedSources: number;
  sources: BriefSource[];
  sourceArticleCount: number;
}

/** 归档列表里的一期，由 /api/briefs 返回 */
export interface BriefSummary {
  id: number;
  slug: string;
  title: string;
  /** "Aug 25" */
  dateShortLabel: string;
  excerpt: string | null;
  storyCount: number;
  readingMinutes: number;
  /** 由 title 的关键词串切出来的主题标签 */
  topics: string[];
}

export interface BriefListResponse {
  items: BriefSummary[];
  /** 命中当前检索条件的期数 */
  matched: number;
  /** 全部期数，与检索条件无关，用于副标题 */
  total: number;
  /** 最早一期的日期，用于副标题「覆盖 X 至今」 */
  earliestDateLabel: string | null;
}

/** 列在国家页、搜索页上的一块的共同部分（server/lib/blockItem.ts 从 backend 的块算出） */
export interface BlockItem {
  /** brief_blocks.id */
  id: number;
  title: string;
  bodyHtml: string;
  tier: BriefTier;
  briefNumber: number;
  /** "August 25, 2026" */
  dateLabel: string;
  /** 阅读页上这一块的地址，如 `/briefs/8#story-1` */
  href: string;
}

/** 国家页上的一块，由 /api/countries/:code/blocks 返回 */
interface CountryBlockItem extends BlockItem {
  /** 落点国家的英文名；跨地区或没有国家的故事为 null */
  placedIn: string | null;
  /** 这一块还涉及的其他国家（英文名），不含本页的国家 */
  alsoInvolves: string[];
}

/** 国家页的一节：落点在该国的块（placement）或涉及该国的块（mention） */
export interface CountryBlocksResponse {
  country: string;
  name: string;
  section: CountrySection;
  /** 这一节的总块数，与分页无关 */
  total: number;
  items: CountryBlockItem[];
}

/** 搜索结果的一组：同一线索的块归在一起（没并进线索的块自成一组） */
interface SearchGroupItem {
  /** 所属线索；没有线索页的为 null */
  thread: { id: number; title: string; briefCount: number; href: string } | null;
  /** 这一组命中的总块数；blocks 只带最新的若干块时比它的长度大 */
  blockCount: number;
  /** 命中的块，最新的在前 */
  blocks: BlockItem[];
}

/** 搜索简报块的一页，由 /api/search 返回；分页按组数 */
export interface SearchResponse {
  query: string;
  /** 命中的组数 */
  total: number;
  /** 命中的总块数 */
  totalBlocks: number;
  items: SearchGroupItem[];
}

/** 事件追踪的线索状态。「暂无更新」不是「已平息」——系统只知道没有新报道并入 */
export type StoryThreadStatus = 'active' | 'dormant';

export interface StoryThreadSummary {
  id: number;
  title: string;
  status: StoryThreadStatus;
  /** 连续多天有新条目，或最新条目重要度高于历史均值 */
  escalating: boolean;
  summary: string;
  durationDays: number;
  /** 出现在几期简报里 */
  briefCount: number;
  entryCount: number;
  /** "Updated today" / "Updated 3 days ago" */
  updateLabel: string;
}

interface StoryThreadEntry {
  id: number;
  dateShortLabel: string;
  title: string;
  description: string;
  briefSlug: string;
  briefNumber: number;
  /** 当天识别出来但没进简报的候选，按存疑条目渲染 */
  disputed: boolean;
}

export interface StoryThreadDetail extends StoryThreadSummary {
  firstSeenLabel: string;
  lastSeenLabel: string;
  entries: StoryThreadEntry[];
}

export interface StoryThreadListResponse {
  threads: StoryThreadSummary[];
  counts: { active: number; dormant: number; all: number };
  /** 判「进行中」的天数阈值，索引页要把这个数字展示给读者 */
  activeWindowDays: number;
  /** 成为线索的最少期数，同样对读者可见 */
  minBriefs: number;
}
