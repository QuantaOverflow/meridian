/**
 * 简报 v3 的分层与拼装（纯函数，零 LLM）。
 *
 * 分层（用户拍板）：按「独立源数 × 篇数」降序，前 4 条头条、接着 10 条要闻、其余简讯。
 * 用这个分而不是 story importance：importance 是 LLM 一行定义的主观分，源数 × 篇数是
 * 聚类后天然已知的客观量（同一件事被多少家独立媒体、多少篇报道）。
 *
 * 拼装：三节 markdown，条目沿用现有写法 `<u>**标题**</u>` ——前端
 * （apps/frontend/src/server/lib/briefContent.ts）按 `## ` 分节、按 `<u>` 分条，
 * 目录锚点靠 `<strong>`，少了星号该条在目录里会消失。
 */

import type { BriefTier } from '@meridian/contracts';

/** 篇幅档 = 简报块 v6 端点的 tier（同一个联合，定义在 @meridian/contracts）。 */
export type Tier = BriefTier;

/** 头条 4 / 要闻 10 / 其余简讯。故事不足时靠后的层为空，空节不渲染。 */
const TIER_SIZES: { lead: number; more: number } = { lead: 4, more: 10 };
const TIERS: Tier[] = ['lead', 'more', 'brief'];
const SECTION_HEADINGS: Record<Tier, string> = {
  lead: 'top stories',
  more: 'more news',
  brief: 'in brief',
};

export interface TierCandidate {
  /** 该簇的篇数与独立源数（源数 ≤ 篇数） */
  articles: number;
  sources: number;
}

/**
 * 分层顺序：分数降序，同分保持传入顺序（传入序已是选择层排好的）。
 *
 * `preserveOrder` 为真时**完全不重排**，直接按传入顺序切三档，score 仍算出来只进观测。
 * 接 LLM 排序之后走的是这条：选择层已经把 LLM 序（前 12）与机械序（其余）拼好了，
 * 这里再按 `篇数 × 源数` 重排一次会把它整个盖掉——那正是老链路两处排序口径不同的来源。
 */
export function assignTiers<T extends TierCandidate>(
  items: T[],
  opts?: { preserveOrder?: boolean }
): Array<T & { tier: Tier; score: number }> {
  const scored = items.map((x, i) => ({ ...x, score: x.articles * x.sources, order: i }));
  if (!opts?.preserveOrder) scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const nLead = Math.min(TIER_SIZES.lead, scored.length);
  const nMore = Math.min(TIER_SIZES.more, scored.length - nLead);
  return scored.map(({ order, ...rest }, i) => ({
    ...(rest as unknown as T),
    score: rest.score,
    tier: (i < nLead ? 'lead' : i < nLead + nMore ? 'more' : 'brief') as Tier,
  }));
}

export interface RenderBlock {
  title: string;
  text: string;
  tier: Tier;
}

/**
 * 三节 markdown。块按传入顺序渲染（= 分层顺序），空节不出现——留一个空标题比少一节更糟。
 * 标题小写是本简报的 house style。
 */
export function renderBriefV3(blocks: RenderBlock[]): { content: string; sections: number } {
  const parts: string[] = [];
  for (const tier of TIERS) {
    const inTier = blocks.filter(b => b.tier === tier && b.text.trim());
    if (!inTier.length) continue;
    const items = inTier.map(b => `<u>**${b.title.trim().toLowerCase()}**</u>\n${b.text.trim()}`);
    parts.push(`## ${SECTION_HEADINGS[tier]}\n\n${items.join('\n\n')}`);
  }
  return { content: parts.join('\n\n'), sections: parts.length };
}
