import type { BriefSection } from '~/server/lib/briefContent';
import type { BriefSource } from '~/server/lib/briefSources';

export type { BriefSection, BriefStory } from '~/server/lib/briefContent';
export type { BriefSource, BriefSourceArticle } from '~/server/lib/briefSources';

export interface ReportDate {
  month: string;
  day: number;
  year: number;
}

/** 一期简报的完整读者视图，由 /api/briefs/:slug 返回 */
export interface BriefDetail {
  id: number;
  slug: string;
  /** 由模型产出的关键词串，不是一句标题 */
  title: string;
  createdAt: Date;
  date: ReportDate;
  /** 「2026 年 8 月 25 日」 */
  dateCN: string;
  /** 面向读者的散文摘要；历史期在回填前为 null */
  tldrProse: string | null;
  sections: BriefSection[];
  storyCount: number;
  readingMinutes: number;
  modelAuthor: string | null;
  totalArticles: number;
  totalSources: number;
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
  createdAt: Date;
  date: ReportDate;
  /** 「8 月 25 日」 */
  dateShortCN: string;
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
  hasMore: boolean;
  /** 全部期数，与检索条件无关，用于副标题 */
  total: number;
  /** 最早一期的日期，用于副标题「覆盖 X 至今」 */
  earliestDateCN: string | null;
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
  /** 「今日更新」「3 天前更新」 */
  updateLabel: string;
}

export interface StoryThreadEntry {
  id: number;
  dateShortCN: string;
  title: string;
  description: string;
  briefSlug: string;
  briefNumber: number;
  /** 当天识别出来但没进简报的候选，按存疑条目渲染 */
  disputed: boolean;
}

export interface StoryThreadDetail extends StoryThreadSummary {
  firstSeenCN: string;
  lastSeenCN: string;
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
