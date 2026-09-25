/**
 * 每期一份的 brief-v3 记录（R2 `observability/brief-v3/{workflowId}.json`，key 见 briefV3RecordKey）。
 * 写方：backend auto-brief-generation。读方：管理页、验收（accept.ts M3）、replay 比对。
 */
import type { BriefBlockV6Sentence, BriefTier } from './ai-worker';

/** 写出来的块。字段含义见写入处（auto-brief-generation.ts）的注释。 */
export interface BriefV3WrittenBlock {
  clusterId: number | null;
  storyIdx: number;
  title: string;
  v6Title: string;
  tier: BriefTier;
  articles: number;
  tierArticles: number;
  sources: number;
  score: number;
  ok: true;
  text: string;
  sentences: BriefBlockV6Sentence[];
  anchors: number;
  windows: number;
  windowFailures: number;
  citationsRepaired: number;
  writeRejects: string[];
  llmCalls: number;
  neurons: number;
}

/** 没写出来的块：不进正文，但留在记录里，绝不静默消失。 */
export interface BriefV3FailedBlock {
  storyIdx: number;
  title: string;
  ok: false;
  error: string;
}

export interface BriefV3Record {
  workflowId: string;
  createdAt: string;
  title: string;
  sections: number;
  /** 成功块按分层顺序在前，失败块在后 */
  blocks: Array<BriefV3WrittenBlock | BriefV3FailedBlock>;
}
