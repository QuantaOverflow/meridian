/**
 * 地图首页的数据：backend `GET /reader/briefs/:id/map` 的响应体，前端 `/api/briefs/:slug/map` 原样透传。
 * 写方：backend lib/reader（块 ↔ 故事对应、地点归一化、主题分配、线索关联、当期窗口统计都在那里，调用方看不见）。
 * 读方：frontend 地图首页。展示规则（落点阈值、连线、国家名与坐标、主题英文名）在前端，不在这里。
 */
import type { BriefTier } from './ai-worker';

/** 9 个主题。politics 只在别的主题都不沾时兜底 */
export type MapTopic = 'security' | 'tech' | 'economy' | 'justice' | 'society' | 'environment' | 'culture' | 'sports' | 'politics';

export interface BriefMapEvent {
  /** brief_stories.id */
  storyId: number;
  /** 正文里第几块（0 起，只数写出来的块）→ 阅读页锚点 `story-{blockIndex + 1}` */
  blockIndex: number;
  tier: BriefTier;
  /** 与正文块标题同源（brief-v3 记录的 blocks[].title），不是 brief_stories.title */
  title: string;
  articleCount: number;
  /** 成员文章按国家的占比，降序；country 是 ISO 3166-1 alpha-2，联合国为 `UN`。只写了地区的成员不进这里 */
  places: { country: string; share: number }[];
  /**
   * 成员文章里提到各国的比例（每篇的地点与关键实体里能归一成国家的各算一次，分母是全部成员），降序，至多 5 个。
   * 一事的报道几乎都填同一个地点，第二个国家只在关键实体里，所以连线看这里（规则在前端，见 ADR 0009）
   */
  mentions: { country: string; share: number }[];
  /** 至多两个，按命中多少降序 */
  topics: MapTopic[];
  /** 只有出现在 ≥2 期简报里的线索才给，否则 null */
  thread: { id: number; briefCount: number; durationDays: number } | null;
}

export interface BriefMapCountryCoverage {
  country: string;
  /** 当期窗口里落在这个国家的文章数 */
  count: number;
  /** 这个国家没进任何正文故事的文章 */
  others: { title: string; url: string; source: string }[];
  /** others 按主题逐篇计数（一篇可计入多个主题），取前 3，降序 */
  otherTopics: [MapTopic, number][];
}

export interface BriefMap {
  brief: { id: number; createdAt: string };
  /** 正文里的故事，按正文顺序。对不上故事的块不出现（backend 记日志）；没有 v3 记录时为空 */
  events: BriefMapEvent[];
  /** 按 run 的时间窗事后重查的当期文章，不保证等于当时的实际输入 */
  coverage: {
    total: number;
    /** 只写了地区或组织（Europe、Middle East、Global…）的篇数 */
    regional: number;
    /** 归一化表里没有的地点值（含空值）的篇数 */
    unmapped: number;
    /** 按 count 降序 */
    byCountry: BriefMapCountryCoverage[];
  };
}
