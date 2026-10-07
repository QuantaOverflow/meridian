/**
 * 简报块对外的形状：读者端搜索、国家页、实体页、Following 列块时每一项的共同部分（各接口在它之上加自己的字段）。
 * 写方：backend 保存简报时写表 brief_blocks（lib/save-brief-report.ts），往期由 scripts/backfill-brief-blocks.ts 回填。
 * 读方：backend 的读者接口与前端。块只在所属那一期已发布时对外可见，由查询 join 判，这里不带「可见」字段。
 */
import type { BriefTier } from './ai-worker';

export interface BriefBlock {
  /** brief_blocks.id */
  id: number;
  /** 所属那一期：reports.id 与它的生成时刻（ISO） */
  brief: { id: number; createdAt: string };
  /** brief_stories.id；一个故事至多一块 */
  storyId: number;
  tier: BriefTier;
  /** 期内第几块（0 起，只数写出来的块）→ 阅读页锚点 `story-{position + 1}`；与地图接口的 blockIndex 同口径 */
  position: number;
  /** 与读者页上那一块的标题、正文一致（写作层起的标题，不是 brief_stories.title） */
  title: string;
  body: string;
}

/** 写入时的一块：id 与所属期由落库那一步给 */
export type BriefBlockDraft = Omit<BriefBlock, 'id' | 'brief'>;
