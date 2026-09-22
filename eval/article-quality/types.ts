// ============================================================================
// 文章质量门 eval —— 共享类型
//
// 被评对象：articleAnalysis 这步对每篇 RSS 文章打的两个质量维度：
//   - content_quality:  OK | LOW_QUALITY | JUNK
//   - completeness:     COMPLETE | PARTIAL_USEFUL | PARTIAL_USELESS
//
// 这两个维度共同决定「质量门」是否把文章拦在聚类之前。门逻辑（真源在
// apps/backend/src/workflows/auto-brief-generation.ts 的 validateContentQuality）：
//   REJECT  当  content_quality ∈ {LOW_QUALITY, JUNK}  或  completeness == PARTIAL_USELESS
//   KEEP    其余
// （注意：门是分类阈值，不是连续分数 cutoff——「校准 cutoff」= 校准这条分类边界。）
// ============================================================================

export const CONTENT_QUALITY_CLASSES = ['OK', 'LOW_QUALITY', 'JUNK'] as const;
export type ContentQuality = (typeof CONTENT_QUALITY_CLASSES)[number];

export const COMPLETENESS_CLASSES = ['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS'] as const;
export type Completeness = (typeof COMPLETENESS_CLASSES)[number];

// 门的二元裁决（聚类前 KEEP / REJECT）
export type GateDecision = 'KEEP' | 'REJECT';

// articleAnalysis 输出里 eval 关心的部分（其余字段如 keywords/entities 不在本 eval 范围）
export interface QualityVerdict {
  content_quality: ContentQuality;
  completeness: Completeness;
}

// 一篇待评文章（worklist 候选 / 金标条目的公共部分）
export interface ArticleSample {
  id: string; // 稳定标识：article_id 或 url 哈希
  title: string;
  content: string;
  url?: string;
}

// 金标条目（人工标）：人对这篇文章在两个维度上的判定 + 由判定推导的门裁决
export interface GoldItem extends ArticleSample {
  gold_content_quality: ContentQuality;
  gold_completeness: Completeness;
  // 可选：标注者直接对门裁决的判定。缺省则由上面两维度按门逻辑推导（deriveGate）。
  gold_gate?: GateDecision;
  strata?: Record<string, string>;
  note?: string;
  split?: 'dev' | 'heldout';
}

// 门逻辑：与 auto-brief-generation.ts::validateContentQuality 保持一致（单一真源在 runtime，
// 这里复刻其判据用于把两维度折叠成二元裁决）。改 runtime 门逻辑时务必同步此函数。
export function deriveGate(v: QualityVerdict): GateDecision {
  if (v.content_quality === 'LOW_QUALITY' || v.content_quality === 'JUNK') return 'REJECT';
  if (v.completeness === 'PARTIAL_USELESS') return 'REJECT';
  return 'KEEP';
}
